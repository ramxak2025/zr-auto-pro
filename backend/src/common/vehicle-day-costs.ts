import { Pool } from 'pg';
import { pointFilterSql } from './point-scope';

export interface VehicleDayCost {
  day: string;
  pointId: string | null;
  amount: number;
}

/**
 * One visit = tenant + car + company calendar day, regardless of sale amount,
 * warranty or refunds. Deduplicate the ENTIRE tenant first; only then select the
 * report's point. An earlier visit at another branch must never be charged again.
 * Historical rates ignore the parent's current active/archive state. Rows with
 * the same name are independent costs. No ledger or cash mutation is involved.
 */
export async function vehicleDayCosts(
  pool: Pool,
  ctx: { tenantId: string; dateFrom: string; dateTo: string; tz: string; pointId: string | null; asOf?: string },
): Promise<VehicleDayCost[]> {
  const params: unknown[] = [ctx.tenantId, ctx.dateFrom, ctx.dateTo, ctx.tz];
  const point = pointFilterSql('v', ctx.pointId, params);
  let asOf = '';
  if (ctx.asOf) {
    params.push(ctx.asOf);
    asOf = ` AND ch.date <= $${params.length}::timestamptz`;
  }
  const { rows } = await pool.query<{ day: string; point_id: string | null; amount: string }>(
    `WITH visits AS (
       SELECT DISTINCT ON (ch.car_id, (ch.date AT TIME ZONE $4::text)::date)
              ch.car_id, ch.point_id, (ch.date AT TIME ZONE $4::text)::date AS day
         FROM checks ch
        WHERE ch.tenant_id = $1 AND ch.is_deferred = false AND ch.deleted_at IS NULL
          AND ch.client_id IS NOT NULL AND ch.car_id IS NOT NULL
          AND ch.date >= $2::date::timestamp AT TIME ZONE $4::text
          AND ch.date < ($3::date + 1)::timestamp AT TIME ZONE $4::text${asOf}
        ORDER BY ch.car_id, (ch.date AT TIME ZONE $4::text)::date, ch.date, ch.created_at, ch.id
     )
     SELECT to_char(v.day, 'YYYY-MM-DD') AS day, v.point_id, SUM(h.amount) AS amount
       FROM visits v
       JOIN fixed_costs fc ON fc.tenant_id = $1 AND fc.mode = 'per_vehicle_day'
                          AND fc.point_id IS NOT DISTINCT FROM v.point_id
       JOIN LATERAL (
         SELECT fh.amount, fh.active, fh.archived FROM fixed_cost_vehicle_history fh
          WHERE fh.tenant_id = $1 AND fh.fixed_cost_id = fc.id AND fh.effective_from <= v.day
          ORDER BY fh.effective_from DESC, fh.revision DESC LIMIT 1
       ) h ON h.active AND NOT h.archived
      WHERE true${point}
      GROUP BY v.day, v.point_id ORDER BY v.day, v.point_id`,
    params,
  );
  return rows.map((r) => ({ day: r.day, pointId: r.point_id, amount: Number(r.amount) }));
}

/** Sum NUMERIC(14,2) day buckets in integer kopecks, then convert once. */
export function sumVehicleDayCosts(rows: readonly Pick<VehicleDayCost, 'amount'>[]): number {
  return rows.reduce((kopecks, row) => kopecks + Math.round(row.amount * 100), 0) / 100;
}
