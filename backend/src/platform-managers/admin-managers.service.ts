import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { invalidateAuthUser } from '../common/auth-cache';
import { DEFAULT_TIMEZONE } from '../common/timezone';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { AuditActor, AuditService } from '../tenants/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import { CreateManagerDto, CreateSettlementDto, UpdateManagerDto } from './dto/admin-managers.dto';
import { emptyManagerStats, ManagerFinanceService, toMoney } from './manager-finance.service';
import { isPhoneUniqueViolation, normalizeLoginPhone, phoneTakenError } from './manager-phone';
import { DEFAULT_OWNER_SHARE_PERCENT } from './owner-share';
import type { ManagerLedger, ManagerSettlement, ManagerStats, PlatformManager, PlatformManagerDetail } from './types';

/** Колонки менеджера для списка/карточки: пароль и служебные поля наружу не берём. */
const MANAGER_COLUMNS = `id, full_name, phone, is_active, owner_share_percent, owner_notes, created_at`;

/** Ответ переноса клиента (`TransferTenantManagerResponse` из shared). */
export interface TransferTenantManagerResult {
  ok: true;
  tenantId: string;
  managerId: string | null;
  managerName: string | null;
}

/** Пустая/пробельная заметка — это «нет заметки»: хранится NULL, а не пустая строка. */
function normalizeNote(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 'YYYY-MM-DD' → реальная календарная дата. Регулярка DTO пропускает `2026-02-31`,
 * а Postgres на такую строку упал бы 22007 (500) — проверяем круговым преобразованием.
 */
function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC трактует годы 0..99 как 1900..1999 — для них круг не сойдётся, и это верно: такие даты нам не нужны.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Менеджеры платформы глазами СУПЕРАДМИНА: заведение/правка, деньги (доля владельца,
 * расчёты) и перенос клиентов между менеджерами. Только суперадмин доходит сюда
 * (`@Roles('superadmin')` на контроллерах) — сервис не повторяет проверку роли, но
 * каждый запрос фильтрует `role = 'manager'`: по id директора/мастера ничего не найти
 * и не изменить.
 *
 * Все запросы идут через admin-пул (маршрут суперадмина без тенантного контекста):
 * `users` под FORCE RLS, менеджер живёт без тенанта.
 */
@Injectable()
export class AdminManagersService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private tenants: TenantsService,
    private audit: AuditService,
    private finance: ManagerFinanceService,
    private settings: PlatformSettingsService,
  ) {}

  private mapManager(row: any, stats: ManagerStats | undefined): PlatformManager {
    const rawPercent = row.owner_share_percent;
    const parsedPercent = rawPercent === null || rawPercent === undefined ? NaN : parseFloat(rawPercent);
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      isActive: row.is_active === true,
      ownerSharePercent: Number.isFinite(parsedPercent) ? parsedPercent : DEFAULT_OWNER_SHARE_PERCENT,
      note: row.owner_notes ?? null,
      tenantsCount: stats?.tenants.total ?? 0,
      activeTenantsCount: stats?.tenants.active ?? 0,
      paidThisMonth: stats?.money.paidThisMonth ?? 0,
      ownerShareThisMonth: stats?.money.ownerShareThisMonth ?? 0,
      balance: stats?.money.balance ?? 0,
      createdAt: row.created_at,
    };
  }

  private async findManagerRow(id: string): Promise<any> {
    const { rows } = await this.pool.query(`SELECT ${MANAGER_COLUMNS} FROM users WHERE id = $1 AND role = 'manager'`, [
      id,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Менеджер не найден' });
    return rows[0];
  }

  /** Телефон — логин и уникален среди ВСЕХ пользователей платформы; `excludeUserId` — сам менеджер при правке. */
  private async assertPhoneFree(phone: string, excludeUserId?: string): Promise<void> {
    const { rows } = excludeUserId
      ? await this.pool.query(`SELECT 1 FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`, [phone, excludeUserId])
      : await this.pool.query(`SELECT 1 FROM users WHERE phone = $1 LIMIT 1`, [phone]);
    if (rows.length > 0) throw phoneTakenError();
  }

  /** GET /admin/managers — все менеджеры со счётчиками и деньгами (три запроса на весь список). */
  async list(): Promise<PlatformManager[]> {
    const { rows } = await this.pool.query(
      `SELECT ${MANAGER_COLUMNS} FROM users WHERE role = 'manager' ORDER BY created_at DESC, id DESC`,
    );
    const stats = await this.finance.statsFor(rows.map((row) => row.id as string));
    return rows.map((row) => this.mapManager(row, stats.get(row.id)));
  }

  /** GET /admin/managers/:id — карточка: профиль, сводка как в кабинете менеджера и все его клиенты. */
  async get(id: string): Promise<PlatformManagerDetail> {
    const row = await this.findManagerRow(id);
    const [stats, maxFreeDays, tenants] = await Promise.all([
      this.finance.statsFor([id]),
      this.settings.getManagerMaxFreeDays(),
      this.tenants.getAll({ managerId: id }),
    ]);
    const managerStats = stats.get(id) ?? emptyManagerStats();
    const manager = this.mapManager(row, managerStats);
    return {
      ...manager,
      summary: this.finance.buildSummary(managerStats, manager.ownerSharePercent, maxFreeDays),
      tenants,
    };
  }

  /** POST /admin/managers — новый менеджер (роль manager, без тенанта, без филиала). */
  async create(dto: CreateManagerDto, actor: AuditActor): Promise<PlatformManager> {
    const fullName = String(dto.fullName ?? '').trim();
    if (fullName === '') throw new BadRequestException({ message: 'Укажите имя менеджера' });
    const phone = normalizeLoginPhone(dto.phone);
    const ownerSharePercent = dto.ownerSharePercent ?? DEFAULT_OWNER_SHARE_PERCENT;
    const note = normalizeNote(dto.note);

    // Понятный 409 в 99 % случаев; гонку двух одновременных запросов ловит 23505 ниже.
    await this.assertPhoneFree(phone);
    const hash = await bcrypt.hash(dto.password, 10);

    let row: any;
    try {
      const res = await this.pool.query(
        `INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, owner_share_percent, owner_notes)
         VALUES ($1, $2, $3, 'manager', true, NULL, $4, $5)
         RETURNING ${MANAGER_COLUMNS}`,
        [phone, hash, fullName, ownerSharePercent, note],
      );
      row = res.rows[0];
    } catch (err) {
      if (isPhoneUniqueViolation(err)) throw phoneTakenError();
      throw err;
    }

    // Пароль в журнал не пишем — только доля.
    await this.audit.log(actor, 'manager_create', {
      targetType: 'user',
      targetId: row.id,
      targetName: row.full_name,
      detail: { ownerSharePercent },
    });
    return this.mapManager(row, undefined);
  }

  /**
   * PATCH /admin/managers/:id — частичная правка. Доля владельца действует на БУДУЩИЕ
   * платежи (у проведённых она — снимок). Смена пароля обрывает прежние сессии
   * менеджера (`sessions_valid_from`), отключение — тоже (кэш авторизации сбрасывается
   * сразу, а не через TTL). Пустое тело — 400; правка без фактических изменений — no-op
   * без записи в журнал.
   */
  async update(id: string, dto: UpdateManagerDto, actor: AuditActor): Promise<PlatformManager> {
    const current = await this.findManagerRow(id);

    const provided = [dto.fullName, dto.phone, dto.password, dto.ownerSharePercent, dto.isActive, dto.note];
    if (provided.every((value) => value === undefined)) {
      throw new BadRequestException({ message: 'Не переданы поля для изменения' });
    }

    const sets: string[] = [];
    const params: unknown[] = [id];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    const changes: Record<string, unknown> = {};
    let sessionsAffected = false;

    if (dto.fullName !== undefined) {
      const fullName = dto.fullName.trim();
      if (fullName === '') throw new BadRequestException({ message: 'Укажите имя менеджера' });
      if (fullName !== current.full_name) {
        push('full_name', fullName);
        changes.fullName = { from: current.full_name, to: fullName };
      }
    }

    if (dto.phone !== undefined) {
      const phone = normalizeLoginPhone(dto.phone);
      if (phone !== current.phone) {
        await this.assertPhoneFree(phone, id);
        push('phone', phone);
        // Сами номера в журнал не пишем: он append-only, а телефон — персональные данные.
        changes.phoneChanged = true;
      }
    }

    if (dto.password !== undefined) {
      const hash = await bcrypt.hash(dto.password, 10);
      push('password', hash);
      // Граница сессий (165): токены, выданные ДО смены пароля, перестают действовать.
      sets.push('sessions_valid_from = now()');
      changes.passwordChanged = true;
      sessionsAffected = true;
    }

    if (dto.ownerSharePercent !== undefined) {
      const currentPercent = parseFloat(current.owner_share_percent);
      const from = Number.isFinite(currentPercent) ? currentPercent : DEFAULT_OWNER_SHARE_PERCENT;
      if (from !== dto.ownerSharePercent) {
        push('owner_share_percent', dto.ownerSharePercent);
        changes.ownerSharePercent = { from, to: dto.ownerSharePercent };
      }
    }

    if (dto.isActive !== undefined && dto.isActive !== (current.is_active === true)) {
      push('is_active', dto.isActive);
      changes.isActive = { from: current.is_active === true, to: dto.isActive };
      sessionsAffected = true;
    }

    if (dto.note !== undefined) {
      const note = normalizeNote(dto.note);
      if (note !== (current.owner_notes ?? null)) {
        push('owner_notes', note);
        changes.noteChanged = true;
      }
    }

    if (sets.length === 0) {
      const stats = await this.finance.statsFor([id]);
      return this.mapManager(current, stats.get(id));
    }

    let row: any;
    try {
      const res = await this.pool.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $1 AND role = 'manager'
          RETURNING ${MANAGER_COLUMNS}`,
        params,
      );
      row = res.rows[0];
    } catch (err) {
      if (isPhoneUniqueViolation(err)) throw phoneTakenError();
      throw err;
    }
    if (!row) throw new NotFoundException({ message: 'Менеджер не найден' });

    // Кэш авторизации живёт 30 с: без явного сброса отключённый менеджер или старый
    // пароль оставались бы рабочими до истечения TTL.
    if (sessionsAffected) invalidateAuthUser(id);

    await this.audit.log(actor, 'manager_update', {
      targetType: 'user',
      targetId: row.id,
      targetName: row.full_name,
      detail: changes,
    });

    const stats = await this.finance.statsFor([id]);
    return this.mapManager(row, stats.get(id));
  }

  /** GET /admin/managers/:id/ledger?months= — платежи и расчёты менеджера; баланс — за всё время. */
  async ledger(id: string, months: unknown): Promise<ManagerLedger> {
    await this.findManagerRow(id);
    return this.finance.ledger(id, months);
  }

  /**
   * POST /admin/managers/:id/settlements — расчёт: менеджер отдал владельцу деньги
   * (amount > 0) либо владелец вернул/скорректировал (amount < 0, тогда обязательна
   * причина). Баланс уменьшается на сумму расчёта.
   */
  async addSettlement(managerId: string, dto: CreateSettlementDto, actor: AuditActor): Promise<ManagerSettlement> {
    const manager = await this.findManagerRow(managerId);

    const amount = toMoney(dto.amount);
    if (amount === 0) throw new BadRequestException({ message: 'Сумма расчёта не может быть равна нулю' });
    const note = normalizeNote(dto.note);
    if (amount < 0 && note === null) {
      throw new BadRequestException({ message: 'Для отрицательной суммы укажите причину' });
    }
    const settledOn = dto.settledOn ?? null;
    if (settledOn !== null && !isRealCalendarDate(settledOn)) {
      throw new BadRequestException({ message: 'Укажите существующую дату расчёта в формате ГГГГ-ММ-ДД' });
    }

    const { rows } = await this.pool.query(
      `INSERT INTO manager_settlements AS ms (manager_id, amount, note, settled_on, created_by)
       VALUES ($1, $2, $3, COALESCE($4::date, (now() AT TIME ZONE $5)::date), $6)
       RETURNING ${ManagerFinanceService.SETTLEMENT_COLUMNS}`,
      [managerId, amount, note, settledOn, DEFAULT_TIMEZONE, actor.userId],
    );
    const settlement = ManagerFinanceService.mapSettlement(rows[0]);

    await this.audit.log(actor, 'manager_settlement', {
      targetType: 'user',
      targetId: managerId,
      targetName: manager.full_name,
      detail: {
        operation: 'create',
        settlementId: settlement.id,
        amount: settlement.amount,
        settledOn: settlement.settledOn,
        note: settlement.note,
        balanceAfter: await this.finance.balanceOf(managerId),
      },
    });
    return settlement;
  }

  /**
   * DELETE /admin/managers/:id/settlements/:sid — отмена ошибочного расчёта. Строка
   * удаляется физически (баланс пересчитывается сам), поэтому след остаётся ТОЛЬКО в
   * журнале действий: пишем туда всю удалённую запись. Доступно лишь суперадмину.
   */
  async removeSettlement(managerId: string, settlementId: string, actor: AuditActor): Promise<{ ok: true }> {
    const manager = await this.findManagerRow(managerId);

    const { rows } = await this.pool.query(
      `DELETE FROM manager_settlements AS ms
        WHERE ms.id = $1 AND ms.manager_id = $2
       RETURNING ${ManagerFinanceService.SETTLEMENT_COLUMNS}`,
      [settlementId, managerId],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Расчёт не найден' });
    const removed = ManagerFinanceService.mapSettlement(rows[0]);

    await this.audit.log(actor, 'manager_settlement', {
      targetType: 'user',
      targetId: managerId,
      targetName: manager.full_name,
      detail: {
        operation: 'remove',
        settlementId: removed.id,
        amount: removed.amount,
        settledOn: removed.settledOn,
        note: removed.note,
        balanceAfter: await this.finance.balanceOf(managerId),
      },
    });
    return { ok: true };
  }

  /**
   * PATCH /admin/tenants/:tenantId/manager — закрепить клиента за менеджером или снять
   * (`managerId: null`). История платежей остаётся у прежнего менеджера: долг считается
   * по `subscription_payments.manager_id` (снимок), а не по текущему владельцу клиента.
   * Новым менеджером может быть только активный `manager`.
   */
  async transferTenant(
    tenantId: string,
    managerId: string | null,
    actor: AuditActor,
  ): Promise<TransferTenantManagerResult> {
    let target: { id: string; full_name: string } | null = null;
    if (managerId !== null) {
      const { rows } = await this.pool.query(
        `SELECT id, full_name FROM users WHERE id = $1 AND role = 'manager' AND is_active = true`,
        [managerId],
      );
      if (rows.length === 0) throw new BadRequestException({ message: 'Менеджер не найден или отключён' });
      target = rows[0];
    }

    // Одним оператором: строка тенанта блокируется, прежний менеджер читается из НЕЁ ЖЕ
    // (а не отдельным SELECT до UPDATE), поэтому «from» в журнале всегда честный. Тот же
    // менеджер — ноль строк (IS DISTINCT FROM): ни записи, ни лишнего updated_at.
    const { rows: moved } = await this.pool.query(
      `UPDATE tenants t
          SET manager_id = $2::uuid, updated_at = now()
         FROM (SELECT id, manager_id FROM tenants WHERE id = $1::uuid FOR UPDATE) old
        WHERE t.id = old.id
          AND t.manager_id IS DISTINCT FROM $2::uuid
       RETURNING t.id, t.name, old.manager_id AS previous_manager_id`,
      [tenantId, managerId],
    );

    if (moved.length === 0) {
      const { rows: existing } = await this.pool.query(`SELECT id FROM tenants WHERE id = $1::uuid`, [tenantId]);
      if (existing.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });
      // Клиент уже закреплён за этим менеджером — переносить нечего.
      return { ok: true, tenantId, managerId, managerName: target?.full_name ?? null };
    }

    const previousManagerId: string | null = moved[0].previous_manager_id ?? null;
    let previousManagerName: string | null = null;
    if (previousManagerId) {
      const { rows } = await this.pool.query(`SELECT full_name FROM users WHERE id = $1`, [previousManagerId]);
      previousManagerName = rows[0]?.full_name ?? null;
    }

    await this.audit.log(actor, 'tenant_transfer_manager', {
      targetType: 'tenant',
      targetId: tenantId,
      targetName: moved[0].name,
      detail: {
        from: previousManagerId,
        to: managerId,
        fromName: previousManagerName,
        toName: target?.full_name ?? null,
      },
    });
    return { ok: true, tenantId, managerId, managerName: target?.full_name ?? null };
  }
}
