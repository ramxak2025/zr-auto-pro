import {
  Injectable,
  Inject,
  InternalServerErrorException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { userHasPermission } from '../common/guards/permissions.guard';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { PushService } from '../push/push.service';
import { getTenantTimezone, zonedTimeKey } from '../common/timezone';
import { actorPointId, pointFilterSql } from '../common/point-scope';
import { assignedToPointSql } from '../users/user-points-sql';
import { staleShiftSql } from './shift-auto-close.sql';
import {
  AttendanceEntry,
  attendanceClock,
  classifyArrival,
  hasRecordedAttendance,
  lockAttendanceUser,
  plannedStart,
} from './attendance';

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger('ShiftsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private push: PushService,
  ) {}

  /**
   * Employees may open or close their own shifts only in manual mode.
   */
  private async ensureSelfAttendanceManual(tenantID: string) {
    const { rows } = await this.pool.query(`SELECT attendance_mode FROM tenants WHERE id = $1`, [tenantID]);
    if (rows.length === 0 || rows[0].attendance_mode !== 'manual') {
      throw new ForbiddenException({ message: 'Самостоятельная отметка доступна только в ручном режиме' });
    }
  }

  private async ensureAttendanceEnabled(tenantID: string) {
    const { rows } = await this.pool.query(`SELECT attendance_mode FROM tenants WHERE id = $1`, [tenantID]);
    if (rows.length === 0 || rows[0].attendance_mode === 'admin') {
      throw new ForbiddenException({ message: 'Учёт смен отключён для вашей компании' });
    }
  }

  private mapShift(row: any) {
    const shift: any = {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      date: row.date,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      isAutoClosed: row.is_auto_closed,
      note: row.note,
      // 161 — филиал, В КОТОРОМ смена была ОТКРЫТА. Переключение точки в
      // середине дня смену не переносит: человек физически отработал здесь.
      pointId: row.point_id ?? null,
    };
    if (row.user_full_name) {
      shift.user = {
        id: row.user_id,
        fullName: row.user_full_name,
        role: row.user_role,
        avatar: row.user_avatar,
      };
    }
    return shift;
  }

  /** Request-time recovery keeps the caller's tenant, point or self scope. */
  private async closeStaleForScope(tenantID: string, scope: { pointId?: string | null; userID?: string }) {
    const tz = await getTenantTimezone(this.pool, tenantID);
    const params: unknown[] = [tenantID, tz];
    const stale = staleShiftSql('$2');
    const pointFilter = pointFilterSql('s', scope.pointId ?? null, params);
    const userFilter = scope.userID ? ` AND s.user_id = $${params.push(scope.userID)}` : '';
    await this.pool.query(
      `UPDATE shifts s SET closed_at = ${stale.closedAt}, is_auto_closed = true
       WHERE s.tenant_id = $1 AND s.closed_at IS NULL
         AND ${stale.predicate}${pointFilter}${userFilter}`,
      params,
    );
  }

  /**
   * Лента смен команды. 161 — фильтр по филиалу: смена принадлежит той точке,
   * на которой её ОТКРЫЛИ (shifts.point_id), поэтому лента филиала показывает
   * ровно тех, кто работал здесь. Без филиала (у тенанта их нет /
   * одноточечный тенант) запрос остаётся прежним.
   */
  async getAll(tenantID: string, actor?: JwtPayload, date?: unknown) {
    // Reject malformed, repeated and impossible dates before any SQL/write.
    // PostgreSQL's date parser must not turn bad client input into a 500.
    if (date !== undefined) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new BadRequestException({ message: 'Дата должна быть в формате ГГГГ-ММ-ДД' });
      }
      const parsed = Date.parse(`${date}T00:00:00Z`);
      if (date.startsWith('0000-') || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
        throw new BadRequestException({ message: 'Укажите существующую дату' });
      }
    }
    await this.closeStaleForScope(tenantID, { pointId: actorPointId(actor) });
    const params: unknown[] = [tenantID];
    const pointFilter = pointFilterSql('s', actorPointId(actor), params);
    const dateFilter = date === undefined ? '' : ` AND s.date = $${params.push(date)}::date`;
    const { rows } = await this.pool.query(
      `SELECT s.*, ${date === undefined ? '' : 's.date::text AS date, '}
              u.full_name as user_full_name, u.role as user_role, u.avatar as user_avatar
       FROM shifts s JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1${pointFilter}${dateFilter}
       ORDER BY s.opened_at DESC, s.id DESC${date === undefined ? ' LIMIT 100' : ''}`,
      params,
    );
    return rows.map(this.mapShift);
  }

  async getMy(userID: string, tenantID: string) {
    await this.ensureAttendanceEnabled(tenantID);
    await this.closeStaleForScope(tenantID, { userID });
    const { rows } = await this.pool.query(
      `SELECT s.*, u.full_name as user_full_name, u.role as user_role, u.avatar as user_avatar
       FROM shifts s JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1 AND s.tenant_id = $2
       ORDER BY s.opened_at DESC LIMIT 30`,
      [userID, tenantID],
    );
    return rows.map(this.mapShift);
  }

  /**
   * Открыть СВОЮ смену. 161 — смена штампуется филиалом В МОМЕНТ ОТКРЫТИЯ
   * (решение владельца): переключивший филиал в середине дня остаётся в смене
   * того филиала, где её открыл — иначе отработанный день молча переехал бы в
   * чужую статистику и в чужой расчёт «ЗП за день».
   */
  async open(userID: string, tenantID: string, actor?: JwtPayload) {
    await this.ensureSelfAttendanceManual(tenantID);
    // Смена штампуется ФИЛИАЛОМ СЕССИИ (163). Прежде филиал резолвился на
    // месте, потому что в режиме «все филиалы» смена рождалась с point_id =
    // NULL: филиальные срезы фильтруют строгим равенством, и такая смена не
    // попадала ни в ленту смен филиала, ни в счётчик «мастеров на работе» на
    // карточке «Филиалы» — человек на работе, а филиал показывает ноль.
    // Режима больше нет, филиал выбран при входе.
    const pointId = actorPointId(actor);
    // Пояс тенанта — ДО транзакции: вторая коннекция из пула под уже открытой
    // транзакцией на исчерпанном пуле даёт взаимную блокировку.
    const tz = await getTenantTimezone(this.pool, tenantID);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockAttendanceUser(client, tenantID, userID);
      const clock = await attendanceClock(client, tz);
      const today = clock.today;
      const { rows: scheduleRows } = await client.query<AttendanceEntry>(
        `SELECT *, date::text AS date FROM schedule_entries
         WHERE user_id=$1 AND date=$2 AND tenant_id=$3 FOR UPDATE`,
        [userID, today, tenantID],
      );
      const entry = scheduleRows[0];
      if (entry && (entry.point_id ?? null) !== pointId) {
        throw new ConflictException({
          message: 'На этот день график назначен в другом филиале. Обратитесь к руководителю.',
        });
      }

      const stale = staleShiftSql('$3', '$4');
      await client.query(
        `UPDATE shifts SET closed_at = ${stale.closedAt}, is_auto_closed = true
         WHERE user_id=$1 AND tenant_id=$2 AND closed_at IS NULL AND ${stale.predicate}`,
        [userID, tenantID, tz, clock.instant],
      );
      const { rows: active } = await client.query(
        `SELECT s.*, u.full_name AS user_full_name, u.role AS user_role, u.avatar AS user_avatar
         FROM shifts s JOIN users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id
         WHERE s.user_id=$1 AND s.tenant_id=$2 AND s.date=$3 AND s.closed_at IS NULL
         ORDER BY s.opened_at, s.id`,
        [userID, tenantID, today],
      );
      // Legacy shifts may have no calendar row. The active event itself also
      // prevents automatic transfer, including when another same-point event exists.
      if (active.some((shift) => (shift.point_id ?? null) !== pointId)) {
        throw new ConflictException({ message: 'Смена уже открыта в другом филиале. Обратитесь к руководителю.' });
      }
      const isNewShift = active.length === 0;
      let shift = active[0];
      if (isNewShift) {
        // One authoritative instant, captured after the lock, governs both the
        // date and opening time. Earlier days retain their midnight close.
        await client.query(
          `UPDATE shifts SET closed_at = CASE WHEN ${stale.predicate}
              THEN ${stale.closedAt} ELSE $4::timestamptz END, is_auto_closed = true
           WHERE user_id=$1 AND tenant_id=$2 AND closed_at IS NULL`,
          [userID, tenantID, tz, clock.instant],
        );
        const { rows } = await client.query(
          `INSERT INTO shifts (user_id, date, tenant_id, point_id, opened_at) VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userID, today, tenantID, pointId, clock.instant],
        );
        shift = rows[0];
      }
      // Reusing an active event still repairs missing attendance. Anchor it to
      // the first opening, never to the later retry's clock, and preserve marks.
      const { rows: firstRows } = await client.query<{ opened_at: Date }>(
        `SELECT opened_at FROM shifts WHERE user_id=$1 AND tenant_id=$2 AND date=$3
           AND point_id IS NOT DISTINCT FROM $4::uuid ORDER BY opened_at, id LIMIT 1`,
        [userID, tenantID, today, pointId],
      );
      const firstArrival = firstRows[0].opened_at;
      let late: { minutes: number; status: string } | null = null;
      if (!entry || !hasRecordedAttendance(entry)) {
        const arrival = classifyArrival(firstArrival, tz, entry?.shift_start);
        late = { minutes: arrival.lateMinutes, status: arrival.lateStatus };
        await client.query(
          `INSERT INTO schedule_entries
             (user_id, date, tenant_id, point_id, shift_start, shift_end, actual_arrival, late_minutes, late_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (tenant_id, user_id, date) DO UPDATE SET
             actual_arrival=EXCLUDED.actual_arrival, late_minutes=EXCLUDED.late_minutes,
             late_status=EXCLUDED.late_status, shift_start=EXCLUDED.shift_start`,
          [
            userID,
            today,
            tenantID,
            pointId,
            plannedStart(entry?.shift_start),
            entry?.shift_end || '18:00',
            firstArrival,
            arrival.lateMinutes,
            arrival.lateStatus,
          ],
        );
      }
      const { rows: fullRows } = await client.query(
        `SELECT s.*, u.full_name as user_full_name, u.role as user_role, u.avatar as user_avatar
         FROM shifts s JOIN users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id WHERE s.id=$1 AND s.tenant_id=$2`,
        [shift.id, tenantID],
      );
      await client.query('COMMIT');
      if (isNewShift) {
        void this.fireAttendancePush(tenantID, userID, fullRows[0].user_full_name, 'arrived', late, pointId);
      }
      return this.mapShift(fullRows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof HttpException) throw err;
      this.logger.error(`Shift open error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  async close(id: string, tenantID: string, actor: JwtPayload) {
    const { rows: targetRows } = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM shifts WHERE id=$1 AND tenant_id=$2 AND closed_at IS NULL',
      [id, tenantID],
    );
    if (!targetRows[0]) return { message: 'Смена не найдена' };
    const canCloseAny = userHasPermission(actor, 'schedule_manage');
    if (targetRows[0].user_id === actor.userID) await this.ensureSelfAttendanceManual(tenantID);
    else if (!canCloseAny) throw new ForbiddenException({ message: 'Нет права закрывать чужие смены' });
    // Чужую смену закрывает только держатель 'schedule_manage' (матрица роли
    // АВТОРИТЕТНА: owner-class и системный «Админ» — true, кастомные роли — по
    // ячейке schedule.manage); все остальные — только СВОЮ (self-scope в WHERE).
    const ownerCheck = canCloseAny ? '' : ` AND user_id = $3`;
    const params: unknown[] = canCloseAny ? [id, tenantID] : [id, tenantID, actor.userID];
    const tzParam = `$${params.push(await getTenantTimezone(this.pool, tenantID))}` as const;
    const stale = staleShiftSql(tzParam);
    const { rows } = await this.pool.query(
      `UPDATE shifts SET closed_at = CASE WHEN ${stale.predicate}
           THEN ${stale.closedAt} ELSE now() END,
         is_auto_closed = CASE WHEN ${stale.predicate} THEN true ELSE is_auto_closed END
       WHERE id = $1 AND tenant_id = $2${ownerCheck} AND closed_at IS NULL
       RETURNING *`,
      params,
    );
    if (rows.length === 0) return { message: 'Смена не найдена' };

    const { rows: fullRows } = await this.pool.query(
      `SELECT s.*, u.full_name as user_full_name, u.role as user_role, u.avatar as user_avatar
       FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
      [id],
    );
    // A late manual request only recovers the midnight closure, not a real
    // departure now. Already-closed rows are never overwritten by a retry.
    if (!rows[0].is_auto_closed) {
      void this.fireAttendancePush(
        tenantID,
        fullRows[0].user_id,
        fullRows[0].user_full_name,
        'left',
        null,
        // Филиал берём У СМЕНЫ, а не у актора: закрыть смену может админ из
        // другого филиала, и адресаты пуша обязаны определяться местом работы
        // сотрудника, а не тем, кто нажал кнопку.
        fullRows[0].point_id ?? null,
        actor.userID,
      );
    }
    return this.mapShift(fullRows[0]);
  }

  /**
   * 'shift_attendance' — владельцу (director) и админам тенанта: «пришёл на
   * работу» (с опозданием из графика, если есть) / «ушёл с работы».
   * Best-effort после коммита — по паттерну пушей кассовой смены (155).
   * Сам сотрудник и актор (если чужую смену закрыл админ) пуш не получают.
   * Авто-закрытие крон-джобой пуш не шлёт — это не реальный уход.
   *
   * 161 — АДРЕСАТЫ РЕЖУТСЯ ФИЛИАЛОМ СМЕНЫ. Раньше «Иванов пришёл в 09:05»
   * улетал каждому директору и админу тенанта: в сети из пяти автосервисов
   * администратор точки А получал бы полсотни чужих уведомлений в день и
   * выключил бы пуши целиком — вместе с теми, что ему нужны. Оставляем тех,
   * кто реально отвечает за этот филиал: назначенных на него плюс тех, у кого
   * назначений нет вовсе (безопасный дефолт 156 — владелец обычно именно
   * такой и обязан видеть всё).
   */
  /** NFC calls this only after its transaction commits; replay/no-op never calls it. */
  notifyNfcAttendance(
    tenantID: string,
    userID: string,
    fullName: string,
    kind: 'arrived' | 'left',
    late: { minutes: number; status: string } | null,
    pointId: string | null,
  ): Promise<void> {
    return this.fireAttendancePush(tenantID, userID, fullName, kind, late, pointId);
  }

  private async fireAttendancePush(
    tenantID: string,
    shiftUserID: string,
    fullName: string,
    kind: 'arrived' | 'left',
    late: { minutes: number; status: string } | null,
    pointId: string | null = null,
    actorID: string = shiftUserID,
  ): Promise<void> {
    try {
      const params: unknown[] = [tenantID, shiftUserID, actorID];
      const pointFilter = assignedToPointSql('u', '$1', pointId, params);
      const { rows } = await this.pool.query(
        `SELECT u.id FROM users u
          WHERE u.tenant_id = $1 AND u.role IN ('director', 'admin')
            AND u.is_active = true AND u.dismissed_at IS NULL AND u.purged_at IS NULL
            AND u.id <> $2 AND u.id <> $3${pointFilter}`,
        params,
      );
      if (rows.length === 0) return;
      // Время в тексте — МЕСТНОЕ настенное время автосервиса, как бизнес-дата
      // смен: владелец читает пуш «открыл смену в 09:05» своими часами.
      const hhmm = zonedTimeKey(new Date(), await getTenantTimezone(this.pool, tenantID));
      const title = kind === 'arrived' ? 'Пришёл на работу' : 'Ушёл с работы';
      let body = kind === 'arrived' ? `${fullName} открыл(а) смену в ${hhmm}` : `${fullName} закрыл(а) смену в ${hhmm}`;
      if (kind === 'arrived' && late && late.status !== 'on_time') {
        body +=
          late.status === 'late_major'
            ? `. Опоздание ${late.minutes} мин (больше часа)`
            : `. Опоздание ${late.minutes} мин`;
      }
      await Promise.all(
        rows.map((r: { id: string }) =>
          this.push.sendToUserInTenant(r.id, tenantID, 'shift_attendance', title, body, { type: 'shift_attendance' }),
        ),
      );
    } catch (err) {
      this.logger.error(`shift_attendance push failed: ${err}`);
    }
  }
}
