import { Injectable, Inject, InternalServerErrorException, ForbiddenException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { userHasPermission } from '../common/guards/permissions.guard';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { PushService } from '../push/push.service';
import { getTenantTimezone, zonedDateKey, zonedTimeKey } from '../common/timezone';
import { actorPointId, pointFilterSql } from '../common/point-scope';
import { assignedToPointSql } from '../users/user-points-sql';

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger('ShiftsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private push: PushService,
  ) {}

  /**
   * Per-tenant master toggle for the «Смены» subsystem (migration 070,
   * tenants.shifts_enabled). Reads the flag straight from the tenant row by
   * tenantID; throws 403 when the feature is OFF. Default is false, so any
   * tenant that has not explicitly enabled shifts is blocked — matching the
   * additive/opt-in contract. Called from the controller before open/close/getMy.
   */
  private async ensureShiftsEnabled(tenantID: string) {
    const { rows } = await this.pool.query(`SELECT shifts_enabled FROM tenants WHERE id = $1`, [tenantID]);
    if (rows.length === 0 || rows[0].shifts_enabled !== true) {
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

  /**
   * Лента смен команды. 161 — фильтр по филиалу: смена принадлежит той точке,
   * на которой её ОТКРЫЛИ (shifts.point_id), поэтому лента филиала показывает
   * ровно тех, кто работал здесь. Без филиала (у тенанта их нет /
   * одноточечный тенант) запрос остаётся прежним.
   */
  async getAll(tenantID: string, actor?: JwtPayload) {
    const params: unknown[] = [tenantID];
    const pointFilter = pointFilterSql('s', actorPointId(actor), params);
    const { rows } = await this.pool.query(
      `SELECT s.*, u.full_name as user_full_name, u.role as user_role, u.avatar as user_avatar
       FROM shifts s JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id = $1${pointFilter}
       ORDER BY s.opened_at DESC LIMIT 100`,
      params,
    );
    return rows.map(this.mapShift);
  }

  async getMy(userID: string, tenantID: string) {
    await this.ensureShiftsEnabled(tenantID);
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
    await this.ensureShiftsEnabled(tenantID);
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

      // Auto-close old open shifts for this user
      await client.query(
        `UPDATE shifts SET closed_at = now(), is_auto_closed = true
         WHERE user_id = $1 AND tenant_id = $2 AND closed_at IS NULL`,
        [userID, tenantID],
      );

      // Create new shift. Бизнес-дата «сегодня» — календарный день В ПОЯСЕ
      // ТЕНАНТА, как в shift-auto-close: чистая UTC-дата (toISOString) относила
      // смену, открытую после местной полуночи, на вчера, а фиксированный
      // московский сдвиг делал то же самое с любым тенантом восточнее Москвы.
      const today = zonedDateKey(new Date(), tz);
      const { rows } = await client.query(
        `INSERT INTO shifts (user_id, date, tenant_id, point_id) VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userID, today, tenantID, pointId],
      );
      const shift = rows[0];

      // Update schedule entry with lateness info
      const { rows: schedRows } = await client.query(
        `SELECT id, shift_start FROM schedule_entries
         WHERE user_id = $1 AND date = $2 AND tenant_id = $3`,
        [userID, today, tenantID],
      );

      let late: { minutes: number; status: string } | null = null;
      if (schedRows.length > 0 && schedRows[0].shift_start) {
        const schedEntry = schedRows[0];
        const now = new Date();
        const [h, m] = schedEntry.shift_start.split(':').map(Number);
        // Плановое начало — московское настенное время бизнес-даты `today`
        // (не серверная локаль: контейнер живёт в UTC, и `new Date(y,m,d,h,m)`
        // давал момент, смещённый на 3 часа от реального планового старта).
        const scheduled = new Date(`${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`);
        const lateMinutes = Math.round((now.getTime() - scheduled.getTime()) / 60000);

        let lateStatus = 'on_time';
        if (lateMinutes > 0) {
          lateStatus = lateMinutes < 60 ? 'late_minor' : 'late_major';
        }
        late = { minutes: Math.max(lateMinutes, 0), status: lateStatus };

        await client.query(
          `UPDATE schedule_entries SET actual_arrival = now(), late_minutes = $1, late_status = $2
           WHERE id = $3`,
          [Math.max(lateMinutes, 0), lateStatus, schedEntry.id],
        );
      }

      await client.query('COMMIT');

      // Return with user info
      const { rows: fullRows } = await this.pool.query(
        `SELECT s.*, u.full_name as user_full_name, u.role as user_role, u.avatar as user_avatar
         FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
        [shift.id],
      );
      void this.fireAttendancePush(tenantID, userID, fullRows[0].user_full_name, 'arrived', late, pointId);
      return this.mapShift(fullRows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Shift open error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  async close(id: string, tenantID: string, actor: JwtPayload) {
    await this.ensureShiftsEnabled(tenantID);
    // Чужую смену закрывает только держатель 'schedule_manage' (матрица роли
    // АВТОРИТЕТНА: owner-class и системный «Админ» — true, кастомные роли — по
    // ячейке schedule.manage); все остальные — только СВОЮ (self-scope в WHERE).
    const canCloseAny = userHasPermission(actor, 'schedule_manage');
    const ownerCheck = canCloseAny ? '' : ` AND user_id = $3`;
    const params = canCloseAny ? [id, tenantID] : [id, tenantID, actor.userID];
    const { rows } = await this.pool.query(
      `UPDATE shifts SET closed_at = now() WHERE id = $1 AND tenant_id = $2${ownerCheck}
       RETURNING *`,
      params,
    );
    if (rows.length === 0) return { message: 'Смена не найдена' };

    const { rows: fullRows } = await this.pool.query(
      `SELECT s.*, u.full_name as user_full_name, u.role as user_role, u.avatar as user_avatar
       FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
      [id],
    );
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
