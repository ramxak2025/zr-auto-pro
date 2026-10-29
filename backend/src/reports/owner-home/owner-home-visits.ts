import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { strictDay } from './owner-home-dates';
import type { OwnerHomeRapidReturnRow } from './owner-home.types';

export interface VisitContext {
  tenant: string;
  point: string | null;
  tz: string;
  shared: boolean;
  from: string;
  to: string;
  start: string;
  until: string;
}

/** Candidate window first; history reads only its cars and clients, never all clients in JS. */
export function visitQuery(c: VisitContext) {
  const params: unknown[] = [c.tenant, c.start, c.until, c.tz, c.point, c.from, c.shared];
  const cte = `WITH candidate_cars AS MATERIALIZED (
    SELECT DISTINCT ch.car_id FROM checks ch
    JOIN clients cl ON cl.id=ch.client_id AND cl.tenant_id=ch.tenant_id AND NOT cl.is_retail
    WHERE ch.tenant_id=$1 AND ch.is_deferred=false AND ch.deleted_at IS NULL AND ch.car_id IS NOT NULL
      AND ch.date >= $2::timestamptz AND ch.date < $3::timestamptz
      AND ($5::uuid IS NULL OR ch.point_id=$5)
  ), history_checks AS MATERIALIZED (
    SELECT ch.id,ch.number,ch.car_id,ch.client_id,ch.point_id,ch.date,ch.created_at,
      (ch.date AT TIME ZONE $4::text)::date AS day
    FROM candidate_cars cc JOIN checks ch ON ch.car_id=cc.car_id AND ch.tenant_id=$1
    JOIN clients cl ON cl.id=ch.client_id AND cl.tenant_id=ch.tenant_id AND NOT cl.is_retail
    JOIN cars ca ON ca.id=ch.car_id AND ca.tenant_id=ch.tenant_id
    WHERE ch.is_deferred=false AND ch.deleted_at IS NULL
      AND ch.date >= ($6::date - 30)::timestamp AT TIME ZONE $4::text AND ch.date < $3::timestamptz
  ), vehicle_days AS MATERIALIZED (
    SELECT DISTINCT ON(car_id,day) * FROM history_checks
    ORDER BY car_id,day,date,created_at,id
  ), sequenced AS (
    SELECT *, LAG(day) OVER(PARTITION BY car_id ORDER BY day) AS previous_day FROM vehicle_days
  ), scoped_visits AS MATERIALIZED (
    SELECT * FROM sequenced WHERE day >= $6::date AND ($5::uuid IS NULL OR point_id=$5)
  ), active_clients AS (
    SELECT client_id, MAX(day) AS last_day,COUNT(*) AS visit_count,COUNT(DISTINCT car_id) AS vehicle_count
    FROM scoped_visits GROUP BY client_id
  ), client_cohorts AS MATERIALIZED (
    SELECT ac.*,cl.full_name AS client_name,(first.date AT TIME ZONE $4::text)::date AS first_day,
      (($7::boolean OR $5::uuid IS NULL OR cl.point_id IS NULL OR cl.point_id=$5)) AS can_open_history
    FROM active_clients ac JOIN clients cl ON cl.id=ac.client_id AND cl.tenant_id=$1
    JOIN LATERAL (
      SELECT ch.date FROM checks ch JOIN cars ca ON ca.id=ch.car_id AND ca.tenant_id=ch.tenant_id
      WHERE ch.tenant_id=$1 AND ch.client_id=ac.client_id AND ch.is_deferred=false
        AND ch.deleted_at IS NULL AND ch.car_id IS NOT NULL AND ch.date < $3::timestamptz
      ORDER BY ch.date LIMIT 1
    ) first ON true
  ), rapid_visits AS MATERIALIZED (
    SELECT * FROM scoped_visits WHERE day-previous_day BETWEEN 1 AND 30
  ), rapid_cars AS MATERIALIZED (
    SELECT DISTINCT ON(car_id) *,COUNT(*) OVER(PARTITION BY car_id) AS return_count
    FROM rapid_visits ORDER BY car_id,day DESC
  )`;
  return { cte, params };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Cursor = { version: 1; scope: string; day: string; id: string };
const scope = (c: VisitContext, kind: string) => JSON.stringify([c.tenant, c.point, c.from, c.to, kind]);

export function pagination(c: VisitContext, kind: string, query: Record<string, unknown>) {
  const raw = query.limit ?? 20;
  if (!['string', 'number'].includes(typeof raw) || !/^\d+$/.test(String(raw)))
    throw new BadRequestException('Некорректный размер страницы');
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BadRequestException('Размер страницы: от 1 до 50');
  let cursor: Cursor | null = null;
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== 'string' || !/^[\w-]{1,1024}$/.test(query.cursor)) throw new Error('encoding');
      const value: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (!value || typeof value !== 'object') throw new Error('shape');
      const candidate = value as Record<string, unknown>;
      if (
        candidate.version !== 1 ||
        candidate.scope !== scope(c, kind) ||
        typeof candidate.id !== 'string' ||
        !UUID.test(candidate.id)
      )
        throw new Error('scope');
      const day = strictDay(candidate.day);
      if (day < c.from || day > c.to) throw new Error('day');
      cursor = { version: 1, scope: scope(c, kind), day, id: candidate.id };
    } catch {
      throw new BadRequestException('Курсор не соответствует выбранному периоду');
    }
  }
  return {
    limit,
    day: cursor?.day ?? null,
    id: cursor?.id ?? null,
    encode: (day: string, id: string) =>
      Buffer.from(JSON.stringify({ version: 1, scope: scope(c, kind), day, id })).toString('base64url'),
  };
}

interface VisitDetails {
  car_id: string;
  kind: 'current' | 'previous';
  check_count: string;
  restricted: boolean;
  checks: Array<{ id: string; number: number }>;
  works: string[];
  work_count: string;
}

/** Two previews per selected car in one bounded SQL batch. Other-point details never leave SQL. */
export async function rapidDetails(
  client: PoolClient,
  c: VisitContext,
  rows: OwnerHomeRapidReturnRow[],
): Promise<void> {
  if (!rows.length) return;
  const keys = rows.flatMap((r) => [
    { car_id: r.carId, day: r.latestVisitDate, kind: 'current' },
    { car_id: r.carId, day: r.previousVisitDate, kind: 'previous' },
  ]);
  const result = await client.query<VisitDetails>(
    `WITH keys AS (
    SELECT * FROM jsonb_to_recordset($2::jsonb) AS k(car_id uuid, day date, kind text)
  ), matched AS MATERIALIZED (
    SELECT k.car_id,k.kind,ch.id,ch.number,ch.date,ch.created_at,($4::uuid IS NULL OR ch.point_id IS NOT DISTINCT FROM $4::uuid) AS visible
    FROM keys k JOIN checks ch ON ch.tenant_id=$1 AND ch.car_id=k.car_id
      AND ch.date >= k.day::timestamp AT TIME ZONE $3::text
      AND ch.date < (k.day+1)::timestamp AT TIME ZONE $3::text AND ch.date < $5::timestamptz
      AND ch.is_deferred=false AND ch.deleted_at IS NULL
    JOIN clients cl ON cl.id=ch.client_id AND cl.tenant_id=ch.tenant_id AND NOT cl.is_retail
  ), ranked AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY car_id,kind,visible ORDER BY date,created_at,id) AS rn FROM matched
  ), work_names AS (
    SELECT DISTINCT m.car_id,m.kind,sl.name FROM matched m JOIN check_service_lines sl ON sl.check_id=m.id
    WHERE m.visible AND sl.quantity>0
  ), ranked_works AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY car_id,kind ORDER BY name) AS rn FROM work_names
  ), work_groups AS (
    SELECT car_id,kind,COUNT(*) AS work_count,COALESCE(jsonb_agg(name ORDER BY name) FILTER(WHERE rn<=5),'[]') AS works
    FROM ranked_works GROUP BY car_id,kind
  ) SELECT r.car_id,r.kind,COUNT(*) FILTER(WHERE r.visible) AS check_count,BOOL_OR(NOT r.visible) AS restricted,
      COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'number',r.number) ORDER BY r.date,r.created_at,r.id)
        FILTER(WHERE r.visible AND r.rn<=3),'[]') AS checks,
      COALESCE(w.works,'[]') AS works,COALESCE(w.work_count,0) AS work_count
    FROM ranked r LEFT JOIN work_groups w USING(car_id,kind)
    GROUP BY r.car_id,r.kind,w.works,w.work_count`,
    [c.tenant, JSON.stringify(keys), c.tz, c.point, c.until],
  );
  for (const row of rows) {
    const current = result.rows.find((r) => r.car_id === row.carId && r.kind === 'current');
    const previous = result.rows.find((r) => r.car_id === row.carId && r.kind === 'previous');
    row.currentChecks = current?.checks ?? [];
    row.currentCheckCount = Number(current?.check_count ?? 0);
    row.previousChecks = previous?.checks ?? [];
    row.previousCheckCount = Number(previous?.check_count ?? 0);
    row.previousWorks = previous?.works ?? [];
    row.previousWorkCount = Number(previous?.work_count ?? 0);
    row.previousDetailsRestricted = previous?.restricted === true;
  }
}
