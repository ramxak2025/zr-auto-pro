import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { NO_TENANT_ID } from '../common/auth-cache';
import { getTenantTimezone } from '../common/timezone';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId, assertRowPointForWrite, pointFilterSql } from '../common/point-scope';
import { assignedToPointSql } from '../users/user-points-sql';
import { staleShiftSql } from '../shifts/shift-auto-close.sql';
import {
  AttendanceEntry,
  AttendanceFields,
  ScheduleMutation,
  attendanceClock,
  isWorkingStatus,
  lockAttendanceUser,
  manualAttendance,
} from '../shifts/attendance';
import { WorkModeRow, WorkModeMutation, mapWorkMode, workModeFields } from './work-mode';

// Valid statuses for the schedule_settings.shift_statuses array.
// Anything outside this set is ignored on write so a manipulated DTO can't
// poison the column. UI keys → emoji + label:
//   worked  ✅ Смена
//   dayoff  😴 Выходной
//   sick    🤒 Больничный
//   short   ⏰ <1ч
//   long    🚨 >1ч
//   absent  ❌ Прогул
const ALLOWED_SHIFT_STATUSES = new Set(['worked', 'dayoff', 'sick', 'short', 'long', 'absent']);
const DEFAULT_SHIFT_STATUSES = ['worked', 'short'];

// `schedule_entries.date` is a `DATE NOT NULL` column; the listing compares it
// against caller-supplied `dateFrom`/`dateTo` text params which Postgres casts
// to date. A malformed value ("", locale string, ISO-with-time) yields
// "invalid input syntax for type date" → a deterministic 500 that no client
// retry can recover from. Validate before the query touches the cast.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s) || s.startsWith('0000-')) return false;
  const ts = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(ts) && new Date(ts).toISOString().slice(0, 10) === s;
}

@Injectable()
export class ScheduleService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Return the per-tenant schedule settings; auto-create a default row if
   * the tenant has never opened the screen. Cached only in transit (a
   * cheap SELECT) — no in-memory cache because the FE itself caches the
   * settings query.
   */
  async getSettings(tenantID: string) {
    // Tenant-less caller (superadmin, nil-UUID sentinel): return defaults WITHOUT
    // seeding — an INSERT with the sentinel tenant_id FK-violates and 500s
    // /schedule/today (which resolves settings). Same spirit as jwt.strategy's
    // NO_TENANT_ID handling and the warehouses lazy-seed guard.
    if (tenantID === NO_TENANT_ID) return { shiftStatuses: DEFAULT_SHIFT_STATUSES };

    const { rows } = await this.pool.query('SELECT shift_statuses FROM schedule_settings WHERE tenant_id=$1 LIMIT 1', [
      tenantID,
    ]);
    if (rows.length === 0) {
      await this.pool.query(
        `INSERT INTO schedule_settings (tenant_id, shift_statuses)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantID, JSON.stringify(DEFAULT_SHIFT_STATUSES)],
      );
      return { shiftStatuses: DEFAULT_SHIFT_STATUSES };
    }
    const raw = rows[0].shift_statuses;
    const arr: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const statuses = Array.isArray(arr)
      ? arr.filter((s): s is string => typeof s === 'string' && ALLOWED_SHIFT_STATUSES.has(s))
      : DEFAULT_SHIFT_STATUSES;
    return { shiftStatuses: statuses };
  }

  /**
   * Replace the per-tenant shift statuses. Unknown values are silently
   * dropped; empty array means "nothing counts as a shift" — caller's
   * responsibility, not ours.
   */
  async updateSettings(tenantID: string, dto: { shiftStatuses?: string[] }) {
    const incoming = Array.isArray(dto?.shiftStatuses) ? dto.shiftStatuses : [];
    const cleaned: string[] = [];
    for (const s of incoming) {
      if (typeof s === 'string' && ALLOWED_SHIFT_STATUSES.has(s) && !cleaned.includes(s)) {
        cleaned.push(s);
      }
    }
    await this.pool.query(
      `INSERT INTO schedule_settings (tenant_id, shift_statuses, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE SET shift_statuses = EXCLUDED.shift_statuses, updated_at = now()`,
      [tenantID, JSON.stringify(cleaned)],
    );
    return { shiftStatuses: cleaned };
  }

  /**
   * Map a `schedule_settings.shift_statuses` array into a SQL fragment that
   * filters schedule_entries to count only the statuses that the tenant has
   * marked as "real shift". Returns `{ sql, params }` where sql is a
   * complete condition that can be ANDed into an existing WHERE.
   *
   * Returns `null` when the tenant counts nothing as a shift — in that case
   * the caller can decide whether to short-circuit or apply a never-matches
   * filter. Today every screen treats null as "always-false".
   */
  async buildShiftFilter(tenantID: string): Promise<{ sql: string; params: string[] } | null> {
    const { shiftStatuses } = await this.getSettings(tenantID);
    if (shiftStatuses.length === 0) return null;
    const clauses: string[] = [];
    const params: string[] = [];
    // Status → SQL predicate over schedule_entries rows.
    for (const s of shiftStatuses) {
      switch (s) {
        case 'worked':
          // worked = the user actually showed up (actual_arrival set) and
          // wasn't tagged as late_major (which is "long" bucket below).
          // Страж против «застрявшего» actual_arrival: день, переключённый в
          // выходной/больничный/прогул, сменой НЕ считается, даже если старый
          // клиент не прислал actualArrival: null при переключении статуса
          // (частичный PATCH оставляет факт прихода в строке). Корень жалобы
          // «в расписании 5 смен, в зарплате 10».
          // Больничный/прогул матчим ТОЧНЫМ лейблом quick-action ('Больничный'
          // /'Прогул'), а не подстрокой: свободный note реально отработанного
          // дня («оформили больничный клиенту») не должен выкидывать смену.
          clauses.push(
            `(actual_arrival IS NOT NULL AND COALESCE(late_status, '') <> 'late_major'
              AND is_day_off = false
              AND COALESCE(note, '') NOT IN ('Больничный', 'Прогул'))`,
          );
          break;
        case 'dayoff':
          clauses.push(`(is_day_off = true)`);
          break;
        case 'sick':
          // Reuse late_status='sick'. If a tenant never used it the bucket
          // is just empty — non-failing.
          clauses.push(`(late_status = 'sick')`);
          break;
        case 'short':
          clauses.push(`(late_status = 'late_minor')`);
          break;
        case 'long':
          clauses.push(`(late_status = 'late_major')`);
          break;
        case 'absent':
          // An unmarked planned day is not an absence.
          clauses.push(`(note = 'Прогул')`);
          break;
      }
    }
    return clauses.length > 0 ? { sql: `(${clauses.join(' OR ')})`, params } : null;
  }

  private mapEntry(row: any) {
    const entry: any = {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      date: row.date,
      shiftStart: row.shift_start,
      shiftEnd: row.shift_end,
      isDayOff: row.is_day_off,
      actualArrival: row.actual_arrival,
      lateMinutes: row.late_minutes || 0,
      lateStatus: row.late_status,
      note: row.note,
      isManualOverride: row.is_manual_override,
      // 167 — филиал дня графика (null только у тенантов без филиалов).
      pointId: row.point_id ?? null,
    };
    if (row.user_full_name) {
      entry.user = {
        id: row.user_id,
        fullName: row.user_full_name,
        role: row.user_role,
        isActive: row.user_is_active !== false,
      };
    }
    return entry;
  }

  /**
   * Сетка графика за месяц.
   *
   * 167 — У ДНЯ ГРАФИКА ЕСТЬ СВОЙ ФИЛИАЛ (schedule_entries.point_id), и сетка
   * филиала — это строки ЭТОГО филиала, строгим равенством, как у всех
   * денежных таблиц (common/point-scope.pointFilterSql). Раньше (161) филиал
   * выражался только составом команды (user_points), а сотрудник без
   * назначений по безопасному дефолту 156 виден везде — и у тенанта, который
   * людей по филиалам не расставил, оба автосервиса показывали ОДИН И ТОТ ЖЕ
   * график: отметка «пришёл», поставленная в филиале, появлялась и в основном
   * сервисе. Владелец: «это отдельные автосервисы».
   *
   * Кто попадает в СТРОКИ сетки (состав), по-прежнему решает клиент списком
   * сотрудников `?scope=point` (user_points, дефолт 156 сохранён); здесь
   * решается только, ЧЬИ ДНИ показывать.
   */
  async getAll(tenantID: string, query: any, actor?: JwtPayload) {
    const dateFrom = query?.dateFrom;
    const dateTo = query?.dateTo;

    // Missing OR malformed range → empty list (never a 500). The grid screen
    // always sends a valid month range; an invalid one means "nothing to show".
    if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
      return [];
    }

    const params: unknown[] = [tenantID, dateFrom, dateTo];
    const pointFilter = pointFilterSql('se', actorPointId(actor), params);
    const { rows } = await this.pool.query(
      `SELECT se.*, u.full_name as user_full_name, u.role as user_role, u.is_active as user_is_active
       FROM schedule_entries se
       JOIN users u ON u.id = se.user_id
       WHERE se.tenant_id = $1 AND se.date >= $2 AND se.date <= $3${pointFilter}
       ORDER BY u.full_name, se.date
       LIMIT 5000`,
      params,
    );
    return rows.map(this.mapEntry);
  }

  /**
   * «Кто сейчас на работе». ЕДИНСТВЕННОЕ место, где считается этот факт, —
   * его же переиспользует карточка филиала (points.summaryForTenant считает то
   * же самое из shifts). 161 — состав режется назначениями (user_points):
   * в карточке филиала А нельзя показывать людей филиала Б.
   *
   * 167 — день графика и открытая смена берутся ТОЛЬКО ЭТОГО филиала
   * (schedule_entries.point_id / shifts.point_id). Мастер, стоящий сегодня в
   * графике филиала Б и открывший смену там, в филиале А показывается как
   * «без графика, не на смене» — он здесь и правда не работает.
   */
  async getToday(tenantID: string, actor?: JwtPayload) {
    // Пояс тенанта — один раз на запрос, для обоих запросов ниже.
    const tz = await getTenantTimezone(this.pool, tenantID);

    // Safety net: if the background sweep didn't run, close stale open shifts
    // (date earlier than "today" в поясе тенанта) before we render today's
    // status. Idempotent and cheap — only updates rows that actually need
    // closing.
    const stale = staleShiftSql('$2');
    await this.pool.query(
      `UPDATE shifts SET closed_at = ${stale.closedAt}, is_auto_closed = true
       WHERE tenant_id = $1 AND closed_at IS NULL
         AND ${stale.predicate}`,
      [tenantID, tz],
    );

    // «Сегодня» считает Postgres в ПОЯСЕ ТЕНАНТА, а не в локали контейнера и не
    // по фиксированному московскому сдвигу: иначе у автосервиса восточнее
    // Москвы утренние смены каждый день не совпадали бы с графиком.
    const pointId = actorPointId(actor);
    const todayParams: unknown[] = [tenantID, tz];
    const teamFilter = assignedToPointSql('u', '$1', pointId, todayParams);
    // Фрагменты вида ` AND se.point_id = $n` встают ВНУТРЬ условий LEFT JOIN:
    // чужой день/смена просто не присоединяются, а сотрудник в строке остаётся.
    const entryPointFilter = pointFilterSql('se', pointId, todayParams);
    const shiftPointFilter = pointFilterSql('s', pointId, todayParams);
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (u.id) u.id as user_id, u.full_name, u.role, u.avatar,
              se.is_day_off, se.shift_start, se.shift_end,
              se.actual_arrival, se.late_minutes, se.late_status, se.note,
              CASE WHEN s.id IS NOT NULL AND s.closed_at IS NULL THEN true ELSE false END as is_working,
              CASE WHEN se.id IS NOT NULL THEN true ELSE false END as has_schedule
       FROM users u
       LEFT JOIN schedule_entries se
              ON se.user_id = u.id
             AND se.date = (now() AT TIME ZONE $2::text)::date
             AND se.tenant_id = $1${entryPointFilter}
       LEFT JOIN shifts s
              ON s.user_id = u.id
             AND s.date = (now() AT TIME ZONE $2::text)::date
             AND s.tenant_id = $1
             AND s.closed_at IS NULL${shiftPointFilter}
       WHERE u.tenant_id = $1 AND u.is_active = true AND u.role IN ('master', 'admin')
         AND u.dismissed_at IS NULL AND u.purged_at IS NULL
         AND COALESCE(u.hidden_from_schedule, false) = false
         AND COALESCE(u.hidden_everywhere, false) = false${teamFilter}
       ORDER BY u.id, u.full_name`,
      todayParams,
    );

    return rows.map((r) => ({
      userId: r.user_id,
      fullName: r.full_name,
      role: r.role,
      isDayOff: r.is_day_off || false,
      shiftStart: r.shift_start,
      shiftEnd: r.shift_end,
      actualArrival: r.actual_arrival,
      lateMinutes: r.late_minutes || 0,
      lateStatus: r.late_status,
      note: r.note || null,
      isWorking: r.is_working,
      hasSchedule: r.has_schedule,
    }));
  }

  /**
   * Attendance stats for the calling user. `dateFrom` / `dateTo` (YYYY-MM-DD)
   * are OPTIONAL and additive — when absent the range falls back to the
   * current month, byte-for-byte the historical behaviour.
   */
  async getMyStats(tenantID: string, userID: string, dateFrom?: string, dateTo?: string) {
    const now = new Date();
    const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const monthStart = isDate(dateFrom)
      ? dateFrom
      : new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const monthEnd = isDate(dateTo)
      ? dateTo
      : new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const { rows } = await this.pool.query(
      `SELECT
         COUNT(*) as total_scheduled,
         -- «Рабочих дней» = ТО ЖЕ worked-определение, что у зарплаты
         -- (buildShiftFilter 'worked'): факт прихода, НЕ late_major, не
         -- выходной/больничный/прогул (точный лейбл quick-action, не подстрока)
         -- и только прошедшие дни (бизнес-«сегодня» — в поясе тенанта).
         COUNT(CASE WHEN actual_arrival IS NOT NULL
                     AND COALESCE(late_status, '') <> 'late_major'
                     AND is_day_off = false
                     AND COALESCE(note, '') NOT IN ('Больничный', 'Прогул')
                     AND date <= (now() AT TIME ZONE $5::text)::date
                THEN 1 END) as total_worked,
         COUNT(CASE WHEN late_status IN ('late_minor','late_major') THEN 1 END) as total_late,
         COUNT(CASE WHEN late_status = 'late_minor' THEN 1 END) as total_late_minor,
         COUNT(CASE WHEN late_status = 'late_major' THEN 1 END) as total_late_major,
         COUNT(CASE WHEN late_status = 'on_time' THEN 1 END) as total_on_time,
         COUNT(CASE WHEN is_day_off = true THEN 1 END) as total_days_off,
         COALESCE(AVG(CASE WHEN late_minutes > 0 THEN late_minutes END), 0) as avg_late_minutes
       FROM schedule_entries
       WHERE user_id = $1 AND tenant_id = $2 AND date >= $3 AND date <= $4`,
      [userID, tenantID, monthStart, monthEnd, await getTenantTimezone(this.pool, tenantID)],
    );

    const r = rows[0];
    return {
      totalScheduled: parseInt(r.total_scheduled) || 0,
      totalWorked: parseInt(r.total_worked) || 0,
      totalLate: parseInt(r.total_late) || 0,
      totalLateMinor: parseInt(r.total_late_minor) || 0,
      totalLateMajor: parseInt(r.total_late_major) || 0,
      totalOnTime: parseInt(r.total_on_time) || 0,
      totalDaysOff: parseInt(r.total_days_off) || 0,
      avgLateMinutes: Math.round(parseFloat(r.avg_late_minutes) || 0),
    };
  }

  /** Both callers hold the employee lock and write the calendar in this transaction. */
  private async ensureShiftOpen(
    client: PoolClient,
    tenantID: string,
    userID: string,
    date: string,
    lateStatus: unknown,
    pointId: string | null,
    clock: Awaited<ReturnType<typeof attendanceClock>>,
    timezone: string,
  ) {
    if (!isWorkingStatus(lateStatus) || date !== clock.today) return;
    const stale = staleShiftSql('$3', '$4');
    // A manual transfer closes the previous point's active event, preserving its history.
    await client.query(
      `UPDATE shifts SET closed_at = CASE WHEN ${stale.predicate} THEN ${stale.closedAt} ELSE $4::timestamptz END,
         is_auto_closed = true
       WHERE user_id=$1 AND tenant_id=$2 AND closed_at IS NULL
         AND (${stale.predicate} OR point_id IS DISTINCT FROM $5::uuid)`,
      [userID, tenantID, timezone, clock.instant, pointId],
    );
    const { rows: existing } = await client.query(
      `SELECT id FROM shifts WHERE user_id=$1 AND date=$2 AND tenant_id=$3
         AND point_id IS NOT DISTINCT FROM $4::uuid AND closed_at IS NULL LIMIT 1`,
      [userID, date, tenantID, pointId],
    );
    if (existing.length > 0) return;
    await client.query(
      `INSERT INTO shifts (user_id, date, tenant_id, opened_at, point_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userID, date, tenantID, clock.instant, pointId],
    );
  }

  private async firstArrival(client: PoolClient, tenantID: string, userID: string, date: string) {
    const { rows } = await client.query<{ opened_at: Date }>(
      'SELECT opened_at FROM shifts WHERE tenant_id=$1 AND user_id=$2 AND date=$3 ORDER BY opened_at, id LIMIT 1',
      [tenantID, userID, date],
    );
    return rows[0]?.opened_at ?? null;
  }

  private entryValues(fields: AttendanceFields): unknown[] {
    return [
      fields.shift_start,
      fields.shift_end,
      fields.is_day_off,
      fields.note,
      fields.late_status,
      fields.late_minutes,
      fields.actual_arrival,
      fields.is_manual_override,
    ];
  }

  /** 167: an explicit create may transfer the calendar day to the session point. */
  async create(tenantID: string, dto: ScheduleMutation & { userId: string; date: string }, actor?: JwtPayload) {
    if (!dto.userId || !isIsoDate(dto.date)) throw new BadRequestException({ message: 'Укажите сотрудника и дату' });
    const pointId = actorPointId(actor);
    const timezone = await getTenantTimezone(this.pool, tenantID);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockAttendanceUser(client, tenantID, dto.userId);
      const clock = await attendanceClock(client, timezone);
      const { rows: previous } = await client.query<AttendanceEntry>(
        'SELECT *, date::text AS date FROM schedule_entries WHERE tenant_id=$1 AND user_id=$2 AND date=$3 FOR UPDATE',
        [tenantID, dto.userId, dto.date],
      );
      const firstArrival = await this.firstArrival(client, tenantID, dto.userId, dto.date);
      const fields = manualAttendance(dto, previous[0], dto.date, clock, timezone, firstArrival);
      // Omitted fields come from the locked row, so plan-only upserts cannot erase an arrival.
      const { rows } = await client.query<AttendanceEntry>(
        `INSERT INTO schedule_entries (user_id, date, shift_start, shift_end, is_day_off, note,
           late_status, late_minutes, actual_arrival, is_manual_override, tenant_id, point_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (tenant_id, user_id, date) DO UPDATE SET
           shift_start=EXCLUDED.shift_start, shift_end=EXCLUDED.shift_end, is_day_off=EXCLUDED.is_day_off,
           note=EXCLUDED.note, late_status=EXCLUDED.late_status, late_minutes=EXCLUDED.late_minutes,
           actual_arrival=EXCLUDED.actual_arrival, is_manual_override=EXCLUDED.is_manual_override,
           point_id=EXCLUDED.point_id
         RETURNING *, date::text AS date`,
        [dto.userId, dto.date, ...this.entryValues(fields), tenantID, pointId],
      );
      await this.ensureShiftOpen(
        client,
        tenantID,
        dto.userId,
        dto.date,
        dto.lateStatus,
        rows[0].point_id ?? null,
        clock,
        timezone,
      );
      await client.query('COMMIT');
      return this.mapEntry(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Update is point-scoped before and after the employee lock; transfers can race this request. */
  async update(id: string, tenantID: string, dto: ScheduleMutation, actor?: JwtPayload) {
    const pointId = actorPointId(actor);
    const timezone = await getTenantTimezone(this.pool, tenantID);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await assertRowPointForWrite(client, 'schedule_entries', id, tenantID, pointId, 'Запись не найдена');
      const { rows: identity } = await client.query<AttendanceEntry>(
        'SELECT user_id FROM schedule_entries WHERE id=$1 AND tenant_id=$2',
        [id, tenantID],
      );
      if (!identity[0]) throw new NotFoundException({ message: 'Запись не найдена' });
      await lockAttendanceUser(client, tenantID, identity[0].user_id);
      const clock = await attendanceClock(client, timezone);
      const params: unknown[] = [id, tenantID];
      const pointFilter = pointFilterSql(null, pointId, params);
      const { rows: previous } = await client.query<AttendanceEntry>(
        `SELECT *, date::text AS date FROM schedule_entries WHERE id=$1 AND tenant_id=$2${pointFilter} FOR UPDATE`,
        params,
      );
      if (!previous[0]) throw new NotFoundException({ message: 'Запись не найдена' });
      const prior = previous[0];
      const firstArrival = await this.firstArrival(client, tenantID, prior.user_id, prior.date);
      const fields = manualAttendance(dto, prior, prior.date, clock, timezone, firstArrival);
      const { rows } = await client.query<AttendanceEntry>(
        `UPDATE schedule_entries SET shift_start=$1, shift_end=$2, is_day_off=$3, note=$4,
           late_status=$5, late_minutes=$6, actual_arrival=$7, is_manual_override=$8
         WHERE id=$9 AND tenant_id=$10 RETURNING *, date::text AS date`,
        [...this.entryValues(fields), id, tenantID],
      );
      await this.ensureShiftOpen(
        client,
        tenantID,
        prior.user_id,
        prior.date,
        dto.lateStatus,
        rows[0].point_id ?? null,
        clock,
        timezone,
      );
      await client.query('COMMIT');
      return this.mapEntry(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Удаление — тем же гейтом филиала, что правка: чужой день не трогаем. */
  async remove(id: string, tenantID: string, actor?: JwtPayload) {
    const params: unknown[] = [id, tenantID];
    const pointFilter = pointFilterSql(null, actorPointId(actor), params);
    await this.pool.query(`DELETE FROM schedule_entries WHERE id=$1 AND tenant_id=$2${pointFilter}`, params);
    return { message: 'Удалено' };
  }

  // Work modes

  async getWorkModes(tenantID: string) {
    const { rows } = await this.pool.query<WorkModeRow>('SELECT * FROM work_modes WHERE tenant_id=$1 ORDER BY name', [
      tenantID,
    ]);
    return rows.map(mapWorkMode);
  }

  async createWorkMode(tenantID: string, dto: WorkModeMutation) {
    const fields = workModeFields(dto);
    const { rows } = await this.pool.query<WorkModeRow>(
      `INSERT INTO work_modes (name, type, work_days, off_days, week_days, shift_start, shift_end, day_times, tenant_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9) RETURNING *`,
      [
        fields.name,
        fields.type,
        fields.work_days,
        fields.off_days,
        JSON.stringify(fields.week_days),
        fields.shift_start,
        fields.shift_end,
        JSON.stringify(fields.day_times),
        tenantID,
      ],
    );
    return mapWorkMode(rows[0]);
  }

  /** Generated future plans may move point (167); explicit calendar choices are preserved. */
  async applyWorkMode(
    tenantID: string,
    dto: { workModeId: string; userId?: string; dateFrom: string; dateTo: string },
    actor?: JwtPayload,
  ) {
    const { workModeId, userId, dateFrom, dateTo } = dto;
    if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateFrom > dateTo) {
      throw new BadRequestException({ message: 'Укажите верный диапазон дат' });
    }
    const pointId = actorPointId(actor);
    const timezone = await getTenantTimezone(this.pool, tenantID);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: modes } = await client.query<WorkModeRow>('SELECT * FROM work_modes WHERE id=$1 AND tenant_id=$2', [
        workModeId,
        tenantID,
      ]);
      if (!modes[0]) throw new NotFoundException({ message: 'Режим работы не найден' });
      const wm = modes[0];
      const teamParams: unknown[] = [tenantID];
      const teamFilter = assignedToPointSql('u', '$1', pointId, teamParams);
      let userSql = `SELECT u.id FROM users u WHERE u.tenant_id=$1 AND u.is_active=true
        AND u.role IN ('master', 'admin') AND u.dismissed_at IS NULL AND u.purged_at IS NULL${teamFilter}`;
      if (userId) {
        // Preserve explicit single-person application within the tenant (167).
        userSql = 'SELECT u.id FROM users u WHERE u.tenant_id=$1 AND u.id=$2';
        teamParams.splice(1, teamParams.length - 1, userId);
      }
      const { rows: users } = await client.query<{ id: string }>(`${userSql} ORDER BY u.id`, teamParams);
      // Consistent lock order avoids overlapping group applications deadlocking each other.
      for (const user of users) await lockAttendanceUser(client, tenantID, user.id);
      const clock = await attendanceClock(client, timezone);
      let created = 0;
      for (const user of users) {
        const { rows: people } = await client.query<{ days_off: number[] }>(
          'SELECT days_off FROM users WHERE id=$1 AND tenant_id=$2',
          [user.id, tenantID],
        );
        const daysOff = people[0]?.days_off ?? [];
        for (
          let instant = Date.parse(`${dateFrom}T00:00:00Z`);
          instant <= Date.parse(`${dateTo}T00:00:00Z`);
          instant += 86_400_000
        ) {
          const cursor = new Date(instant);
          const date = cursor.toISOString().slice(0, 10);
          if (date <= clock.today) continue;
          // Calendar dates are not instants in the server timezone. All persisted weekday arrays are Sunday0.
          const weekday = cursor.getUTCDay();
          const working = (!wm.week_days?.length || wm.week_days.includes(weekday)) && !daysOff.includes(weekday);
          const times = wm.day_times?.[weekday as keyof typeof wm.day_times];
          const result = await client.query(
            `INSERT INTO schedule_entries (user_id, date, shift_start, shift_end, is_day_off, tenant_id, point_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (tenant_id, user_id, date) DO UPDATE SET
               shift_start=EXCLUDED.shift_start, shift_end=EXCLUDED.shift_end,
               is_day_off=EXCLUDED.is_day_off, point_id=EXCLUDED.point_id
             WHERE COALESCE(schedule_entries.is_manual_override, false)=false
               AND schedule_entries.actual_arrival IS NULL AND schedule_entries.late_status IS NULL
               AND COALESCE(schedule_entries.late_minutes, 0)=0
               AND COALESCE(schedule_entries.note, '') NOT IN ('Прогул', 'Больничный')`,
            [
              user.id,
              date,
              working ? (times?.shiftStart ?? wm.shift_start) : null,
              working ? (times?.shiftEnd ?? wm.shift_end) : null,
              !working,
              tenantID,
              pointId,
            ],
          );
          created += result.rowCount ?? 0;
        }
      }
      await client.query('COMMIT');
      return { created };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateWorkMode(id: string, tenantID: string, dto: WorkModeMutation) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: previous } = await client.query<WorkModeRow>(
        'SELECT * FROM work_modes WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [id, tenantID],
      );
      if (!previous[0]) throw new NotFoundException({ message: 'Режим не найден' });
      const fields = workModeFields(dto, previous[0]);
      const { rows } = await client.query<WorkModeRow>(
        `UPDATE work_modes SET name=$1, type=$2, work_days=$3, off_days=$4, week_days=$5::jsonb,
           shift_start=$6, shift_end=$7, day_times=$8::jsonb WHERE id=$9 AND tenant_id=$10 RETURNING *`,
        [
          fields.name,
          fields.type,
          fields.work_days,
          fields.off_days,
          JSON.stringify(fields.week_days),
          fields.shift_start,
          fields.shift_end,
          JSON.stringify(fields.day_times),
          id,
          tenantID,
        ],
      );
      await client.query('COMMIT');
      return mapWorkMode(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
