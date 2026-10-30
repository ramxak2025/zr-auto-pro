import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../database.module';
import { normalizeTimezone } from '../../common/timezone';
import { profitWindows, visitRange } from './owner-home-dates';
import { profitSnapshots, profitResponse } from './owner-home-finance';
import { timelineSnapshot } from './owner-home-timeline';
import { VisitContext, pagination, rapidDetails, visitQuery } from './owner-home-visits';
import type {
  OwnerHomeProfit,
  OwnerHomeTimeline,
  OwnerHomeVisits,
  OwnerHomeClientPage,
  OwnerHomeRapidReturnPage,
  OwnerHomeClientRow,
  OwnerHomeRapidReturnRow,
} from './owner-home.types';

interface Context {
  client: PoolClient;
  tz: string;
  shared: boolean;
  now: Date;
}

@Injectable()
export class OwnerHomeService {
  private readonly logger = new Logger(OwnerHomeService.name);
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async snapshot<T>(tenant: string, action: (context: Context) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const meta = (
        await client.query<{ timezone: string; points_shared_clients: boolean }>(
          'SELECT timezone,points_shared_clients FROM tenants WHERE id=$1',
          [tenant],
        )
      ).rows[0];
      if (!meta) throw new NotFoundException('Автосервис не найден');
      const result = await action({
        client,
        tz: normalizeTimezone(meta.timezone),
        shared: meta.points_shared_clients !== false,
        now: new Date(),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => this.logger.warn('Owner-home snapshot rollback failed'));
      throw error;
    } finally {
      client.release();
    }
  }

  profit(tenant: string, point: string | null, asOf?: unknown): Promise<OwnerHomeProfit> {
    return this.snapshot(tenant, async ({ client, tz, now }) => {
      const w = profitWindows(asOf, tz, now);
      const values = await profitSnapshots(client, tenant, point, tz, w.current, w.previous);
      return profitResponse(point, tz, now, w, values);
    });
  }

  timeline(tenant: string, point: string | null, query: Record<string, unknown>): Promise<OwnerHomeTimeline> {
    return this.snapshot(tenant, ({ client, tz, now }) => timelineSnapshot(client, tenant, point, tz, now, query));
  }

  private visitContext(tenant: string, point: string | null, query: Record<string, unknown>, c: Context): VisitContext {
    return { tenant, point, tz: c.tz, shared: c.shared, ...visitRange(query.from, query.to, c.tz, c.now) };
  }

  visits(tenant: string, point: string | null, query: Record<string, unknown>): Promise<OwnerHomeVisits> {
    return this.snapshot(tenant, async (context) => {
      const c = this.visitContext(tenant, point, query, context);
      const q = visitQuery(c);
      const r = (
        await context.client.query<Record<string, string>>(
          `${q.cte}
        SELECT (SELECT COUNT(*) FROM client_cohorts) AS clients,
          (SELECT COUNT(*) FROM client_cohorts WHERE first_day >= $6::date) AS new_clients,
          (SELECT COUNT(*) FROM client_cohorts WHERE first_day < $6::date) AS returning_clients,
          (SELECT COUNT(*) FROM scoped_visits) AS visits,
          (SELECT COUNT(DISTINCT car_id) FROM scoped_visits) AS vehicles,
          (SELECT COUNT(*) FROM rapid_cars) AS rapid_cars,
          (SELECT COUNT(*) FROM rapid_visits) AS rapid_visits`,
          q.params,
        )
      ).rows[0];
      return {
        period: { from: c.from, to: c.to },
        timezone: c.tz,
        pointId: point,
        generatedAt: context.now.toISOString(),
        basis: 'first_recorded_service_visit',
        historyScope: 'tenant',
        servedClients: Number(r.clients),
        newClients: Number(r.new_clients),
        returningClients: Number(r.returning_clients),
        visitCount: Number(r.visits),
        vehicleCount: Number(r.vehicles),
        rapidReturnVehicleCount: Number(r.rapid_cars),
        rapidReturnVisitCount: Number(r.rapid_visits),
        rapidReturnWindowDays: 30,
        rapidReturnRule: 'any_same_vehicle_visit',
      };
    });
  }

  clients(tenant: string, point: string | null, query: Record<string, unknown>): Promise<OwnerHomeClientPage> {
    if (query.cohort !== 'new' && query.cohort !== 'returning')
      throw new BadRequestException('Укажите группу клиентов');
    const cohort = query.cohort;
    return this.snapshot(tenant, async (context) => {
      const c = this.visitContext(tenant, point, query, context),
        q = visitQuery(c),
        p = pagination(c, `clients:${cohort}`, query);
      const r = (
        await context.client.query<{ total: string; items: OwnerHomeClientRow[] }>(
          `${q.cte}, selected AS MATERIALIZED (
        SELECT * FROM client_cohorts WHERE first_day ${cohort === 'new' ? '>=' : '<'} $6::date
      ), page AS (
        SELECT client_id AS "clientId",client_name AS "clientName",to_char(first_day,'YYYY-MM-DD') AS "firstVisitDate",
          to_char(last_day,'YYYY-MM-DD') AS "lastVisitDate",visit_count::int AS "visitCount",vehicle_count::int AS "vehicleCount",
          can_open_history AS "canOpenClientHistory"
        FROM selected WHERE ($8::date IS NULL OR (last_day,client_id)<($8::date,$9::uuid))
        ORDER BY last_day DESC,client_id DESC LIMIT $10
      ) SELECT (SELECT COUNT(*) FROM selected) AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY "lastVisitDate" DESC,"clientId" DESC) FROM page),'[]') AS items`,
          [...q.params, p.day, p.id, p.limit + 1],
        )
      ).rows[0];
      const more = r.items.length > p.limit,
        items = r.items.slice(0, p.limit),
        last = items[items.length - 1];
      return {
        items,
        total: Number(r.total),
        nextCursor: more && last ? p.encode(last.lastVisitDate, last.clientId) : null,
      };
    });
  }

  rapidReturns(
    tenant: string,
    point: string | null,
    query: Record<string, unknown>,
  ): Promise<OwnerHomeRapidReturnPage> {
    return this.snapshot(tenant, async (context) => {
      const c = this.visitContext(tenant, point, query, context),
        q = visitQuery(c),
        p = pagination(c, 'rapid', query);
      const r = (
        await context.client.query<{ total: string; items: OwnerHomeRapidReturnRow[] }>(
          `${q.cte}, page AS (
        SELECT rc.car_id AS "carId",ca.plate_number AS "plateNumber",ca.make_model AS "makeModel",
          rc.client_id AS "clientId",cl.full_name AS "clientName",to_char(rc.day,'YYYY-MM-DD') AS "latestVisitDate",
          to_char(rc.previous_day,'YYYY-MM-DD') AS "previousVisitDate",(rc.day-rc.previous_day) AS "gapDays",
          rc.return_count::int AS "returnVisitCount",
          ($7::boolean OR $5::uuid IS NULL OR ca.client_id IS NULL OR (oc.id IS NOT NULL AND (oc.point_id IS NULL OR oc.point_id=$5))) AS "canOpenCarHistory"
        FROM rapid_cars rc JOIN cars ca ON ca.id=rc.car_id AND ca.tenant_id=$1
        JOIN clients cl ON cl.id=rc.client_id AND cl.tenant_id=$1
        LEFT JOIN clients oc ON oc.id=ca.client_id AND oc.tenant_id=$1
        WHERE ($8::date IS NULL OR (rc.day,rc.car_id)<($8::date,$9::uuid))
        ORDER BY rc.day DESC,rc.car_id DESC LIMIT $10
      ) SELECT (SELECT COUNT(*) FROM rapid_cars) AS total,
        COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY "latestVisitDate" DESC,"carId" DESC) FROM page),'[]') AS items`,
          [...q.params, p.day, p.id, p.limit + 1],
        )
      ).rows[0];
      const more = r.items.length > p.limit,
        items = r.items.slice(0, p.limit),
        last = items[items.length - 1];
      await rapidDetails(context.client, c, items);
      return {
        items,
        total: Number(r.total),
        nextCursor: more && last ? p.encode(last.latestVisitDate, last.carId) : null,
      };
    });
  }
}
