import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { userHasPermission } from '../common/guards/permissions.guard';
import { actorPointId, pointFilterSql, warehousePointFilterSql } from '../common/point-scope';
import { getTenantTimezone, zonedDateKey } from '../common/timezone';
import { bookingActor, bookingOwner } from '../bookings/booking-reservations';

type AttentionId = 'bookings' | 'deferred' | 'purchase-orders' | 'low-stock' | 'installments';
@Injectable()
export class DashboardService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Each source has its destination's scope. Denied sources execute no query;
   * source failures stay errors, never a misleading zero. No shared actor cache. */
  async attention(actor: JwtPayload) {
    const pointId = actorPointId(actor);
    const timezone = await getTenantTimezone(this.pool, actor.tenantID);
    const date = zonedDateKey(new Date(), timezone);
    const buckets: { id: AttentionId; count: number | null; error?: true }[] = [];
    const count = async (id: AttentionId, permission: string, read: () => Promise<number>) => {
      if (!userHasPermission(actor, permission)) return;
      try {
        buckets.push({ id, count: await read() });
      } catch {
        buckets.push({ id, count: null, error: true });
      }
    };
    const queryCount = async (sql: string, values: unknown[]) =>
      Number((await this.pool.query(sql, values)).rows[0].count);
    await Promise.all([
      count('bookings', 'bookings_access', async () => {
        const fresh = await bookingActor(this.pool, actor);
        return queryCount(
          `SELECT COUNT(*) AS count FROM public_booking_requests r
          LEFT JOIN bookings b ON b.public_request_id = r.id AND b.tenant_id = r.tenant_id
          WHERE r.tenant_id = $1 AND r.point_id IS NOT DISTINCT FROM $2::uuid
            AND ($3::boolean OR r.resource_id = $4)
            AND CASE WHEN b.status = 'cancelled' THEN 'cancelled' ELSE r.status END = 'pending'`,
          [actor.tenantID, pointId, bookingOwner(fresh), actor.userID],
        );
      }),
      count('deferred', 'checks_view', () => {
        const params: unknown[] = [actor.tenantID];
        let scope = pointFilterSql('ch', pointId, params);
        if (!userHasPermission(actor, 'checks_view_all')) {
          params.push(actor.userID);
          scope += ` AND ch.master_id = $${params.length}`;
        }
        return queryCount(
          `SELECT COUNT(*) AS count FROM checks ch WHERE ch.tenant_id = $1
          AND ch.is_deferred = true AND ch.deleted_at IS NULL${scope}`,
          params,
        );
      }),
      count('purchase-orders', 'suppliers_access', () => {
        const params: unknown[] = [actor.tenantID];
        const scope = pointFilterSql('po', pointId, params);
        return queryCount(
          `SELECT COUNT(*) AS count FROM purchase_orders po
          WHERE po.tenant_id = $1 AND po.status = 'ordered'${scope}`,
          params,
        );
      }),
      count('low-stock', 'warehouse_access', () => {
        const params: unknown[] = [actor.tenantID];
        const scope = warehousePointFilterSql('p', pointId, params);
        return queryCount(
          `SELECT COUNT(*) AS count FROM products p WHERE p.tenant_id = $1
          AND p.deleted_at IS NULL AND p.min_stock > 0 AND p.stock <= p.min_stock${scope}`,
          params,
        );
      }),
      count('installments', 'debts_manage', () => {
        const params: unknown[] = [actor.tenantID, date];
        let scope = '';
        if (pointId) {
          params.push(pointId);
          scope = ` AND EXISTS (SELECT 1 FROM checks pc WHERE pc.id = p.check_id
            AND pc.tenant_id = p.tenant_id AND pc.point_id = $3)`;
        }
        return queryCount(
          `SELECT COUNT(*) AS count FROM installment_plans p WHERE p.tenant_id = $1
          AND p.status = 'open' AND p.next_payment_date < $2::date${scope}`,
          params,
        );
      }),
    ]);
    const order: AttentionId[] = ['bookings', 'deferred', 'purchase-orders', 'low-stock', 'installments'];
    buckets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { date, timezone, pointId, buckets };
  }
}
