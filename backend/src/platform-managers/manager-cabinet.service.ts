import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { invalidateAuthUser } from '../common/auth-cache';
import { PlatformSettingsService } from '../settings/platform-settings.service';
import { AuditActor, AuditLogEntryRow, AuditService } from '../tenants/audit.service';
import { SubscriptionStatus, TenantsService } from '../tenants/tenants.service';
import { CreateManagerTenantDto, ManagerExtendDto } from './dto/manager-cabinet.dto';
import { emptyManagerStats, ManagerFinanceService } from './manager-finance.service';
import { isPhoneUniqueViolation, normalizeLoginPhone, phoneTakenError } from './manager-phone';
import { CabinetActor } from './manager-scope';
import type { ManagerLedger, ManagerSummary, TenantView } from './types';

/** Пробный период по умолчанию, дней; упирается в потолок менеджера, если тот меньше. */
const DEFAULT_TRIAL_DAYS = 14;

const AUDIT_LIMIT_DEFAULT = 50;
const AUDIT_LIMIT_MAX = 200;

const SUBSCRIPTION_STATUSES: readonly string[] = ['active', 'expired', 'suspended'];

/** `?status=` списка клиентов: пусто — все; мусор — 400, а не «молча все» (менеджер увидел бы не тот срез). */
function parseStatus(raw: unknown): SubscriptionStatus | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'string' && SUBSCRIPTION_STATUSES.includes(raw)) return raw as SubscriptionStatus;
  throw new BadRequestException({ message: 'Неизвестный статус подписки' });
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof raw === 'number' ? Math.trunc(raw) : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Кабинет менеджера платформы (`/manager/*`): клиенты, деньги, действия над клиентами.
 *
 * ГРАНИЦА ВИДИМОСТИ. Каждый метод получает `CabinetActor` из `cabinetActor(user)` и
 * передаёт `actor.scope` в TenantsService (или сам добавляет `manager_id = $N` в свой
 * запрос к `tenants`). Менеджер работает ТОЛЬКО со своими клиентами; чужой клиент для
 * него неотличим от несуществующего — 404. Суперадмин на этих маршрутах не ограничен
 * (как и в `/tenants`), но долю владельца не получает: платные продления суперадмина в
 * кабинете считаются оплатой владельцу напрямую.
 *
 * Все запросы идут через admin-пул: `/manager/*` в TenantContextInterceptor не получает
 * тенантного контекста (`users` и `subscription_payments` под FORCE RLS, менеджер живёт
 * без тенанта).
 *
 * Всё, что делает менеджер, пишется в admin_audit_log с ним самим как актором.
 */
@Injectable()
export class ManagerCabinetService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private tenants: TenantsService,
    private audit: AuditService,
    private finance: ManagerFinanceService,
    private settings: PlatformSettingsService,
  ) {}

  private async auditActorOf(actor: CabinetActor): Promise<AuditActor> {
    return { userId: actor.userId, name: await this.audit.resolveActorName(actor.userId) };
  }

  /** GET /manager/summary — счётчики клиентов, деньги месяца, долг владельцу, доля и потолок бесплатных дней. */
  async summary(actor: CabinetActor): Promise<ManagerSummary> {
    const maxFreeDays = await this.settings.getManagerMaxFreeDays();
    if (!actor.isManager) {
      // Суперадмин заглянул в кабинет: «своего» портфеля и доли у него нет — клиенты
      // всей платформы (так же, как отдаёт список /manager/tenants), деньги нулевые.
      const counters = await this.finance.platformTenantCounters();
      return this.finance.buildSummary({ tenants: counters, money: emptyManagerStats().money }, 0, maxFreeDays);
    }
    const [stats, ownerSharePercent] = await Promise.all([
      this.finance.statsFor([actor.userId]),
      this.finance.ownerSharePercentOf(actor.userId),
    ]);
    return this.finance.buildSummary(stats.get(actor.userId) ?? emptyManagerStats(), ownerSharePercent, maxFreeDays);
  }

  /** GET /manager/tenants?status= — клиенты менеджера. */
  async listTenants(actor: CabinetActor, status?: string): Promise<TenantView[]> {
    return this.tenants.getAll({ ...actor.scope, status: parseStatus(status) });
  }

  /** GET /manager/tenants/:id — карточка клиента в форме списка; чужой — 404. */
  async getTenant(actor: CabinetActor, id: string): Promise<TenantView> {
    const rows = await this.tenants.getAll({ ...actor.scope, id });
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });
    return rows[0];
  }

  /** GET /manager/tenants/:id/cabinet — кабинет клиента (подписка + метрики активности); чужой — 404. */
  async getCabinet(actor: CabinetActor, id: string) {
    return this.tenants.getCabinet(id, actor.scope);
  }

  async tenantAuditLog(actor: CabinetActor, id: string, limit?: string, offset?: string) {
    return this.audit.listForTenant(id, actor.scope.managerId ?? null, limit, offset);
  }

  /**
   * POST /manager/tenants — завести автосервис: тенант + владелец (директор) + пробный
   * период, ОДНОЙ транзакцией (тот же путь, что у одобрения заявки на регистрацию).
   * Клиент закрепляется за создателем-менеджером. Пробный период: не передан —
   * min(14, потолок), больше потолка — 400. Телефон владельца занят — 409 PHONE_TAKEN
   * и полный откат (ни тенанта, ни склада, ни поставщика).
   */
  async createTenant(actor: CabinetActor, dto: CreateManagerTenantDto): Promise<TenantView> {
    const maxFreeDays = await this.settings.getManagerMaxFreeDays();
    const trialDays = dto.trialDays ?? Math.min(DEFAULT_TRIAL_DAYS, maxFreeDays);
    if (trialDays > maxFreeDays) {
      throw new BadRequestException({ message: `Пробный период — не больше ${maxFreeDays} дн.` });
    }

    const companyName = String(dto.name ?? '').trim();
    if (companyName === '') throw new BadRequestException({ message: 'Укажите название автосервиса' });
    const ownerName = String(dto.director?.name ?? '').trim();
    if (ownerName === '') throw new BadRequestException({ message: 'Укажите имя владельца автосервиса' });
    const ownerPhone = normalizeLoginPhone(dto.director?.phone);

    const { rows: planRows } = await this.pool.query(
      `SELECT id, name, monthly_price, max_users FROM plans WHERE id = $1`,
      [dto.planId],
    );
    if (planRows.length === 0) throw new BadRequestException({ message: 'Тариф не найден' });
    const plan = planRows[0];

    // Понятный 409 в 99 % случаев; гонку двух одновременных запросов ловит 23505 ниже.
    const { rows: taken } = await this.pool.query(`SELECT 1 FROM users WHERE phone = $1 LIMIT 1`, [ownerPhone]);
    if (taken.length > 0) throw phoneTakenError();

    const ownerPasswordHash = await bcrypt.hash(dto.director.password, 10);
    const managerId = actor.isManager ? actor.userId : null;
    const auditActor = await this.auditActorOf(actor);

    let tenantId: string;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const created = await this.tenants.createWithOwnerAndTrialTx(client, {
        companyName,
        ownerName,
        ownerPhone,
        ownerPasswordHash,
        trialDays,
        createdBy: actor.userId,
        extra: {
          maxUsers: plan.max_users ?? null,
          phone: dto.phone?.trim() || null,
          address: dto.address?.trim() || null,
          planId: plan.id,
          planName: plan.name,
          monthlyPrice: parseFloat(plan.monthly_price) || 0,
          subscriptionNote: dto.note?.trim() || null,
          managerId,
          trialNote: 'Пробный период (менеджер платформы)',
        },
      });
      tenantId = created.tenant.id;
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* соединение уже мертво — release ниже его выбросит */
      }
      if (isPhoneUniqueViolation(err)) throw phoneTakenError();
      throw err;
    } finally {
      client.release();
    }

    await this.audit.log(auditActor, 'tenant_create', {
      targetType: 'tenant',
      targetId: tenantId,
      targetName: companyName,
      detail: { managerId, planId: plan.id, trialDays },
    });
    return this.getTenant(actor, tenantId);
  }

  /**
   * POST /manager/tenants/:id/extend. `type` обязателен.
   *   • free — `days` обязателен и ≤ потолка бесплатных дней; `until` и `amount` запрещены;
   *     доли владельца нет никогда;
   *   • paid — `amount > 0` (проверяет TenantsService); доля владельца записывается снимком
   *     на менеджера-актора. Флага `creditManager` в теле нет: менеджер не может «не
   *     заплатить» свою долю.
   */
  async extend(actor: CabinetActor, id: string, dto: ManagerExtendDto): Promise<TenantView> {
    if (dto.type === 'free') {
      if (dto.until !== undefined) {
        throw new BadRequestException({ message: 'Бесплатное продление задаётся числом дней, а не датой' });
      }
      if (dto.amount !== undefined && dto.amount > 0) {
        throw new BadRequestException({ message: 'Для бесплатного продления сумма не указывается' });
      }
      if (dto.days === undefined) {
        throw new BadRequestException({ message: 'Укажите количество дней бесплатного продления' });
      }
      const maxFreeDays = await this.settings.getManagerMaxFreeDays();
      if (dto.days > maxFreeDays) {
        throw new BadRequestException({ message: `Бесплатно можно продлить не больше чем на ${maxFreeDays} дн.` });
      }
    }

    const auditActor = await this.auditActorOf(actor);
    await this.tenants.extend(
      id,
      {
        type: dto.type,
        days: dto.days,
        amount: dto.type === 'paid' ? dto.amount : undefined,
        until: dto.type === 'paid' ? dto.until : undefined,
        note: dto.note,
      },
      auditActor,
      // Доля владельца — только за платные продления менеджера; суперадмин через кабинет
      // (и любой free) доли не создаёт.
      { credit: actor.isManager && dto.type === 'paid' ? { managerId: actor.userId } : undefined, scope: actor.scope },
    );
    return this.getTenant(actor, id);
  }

  /** POST /manager/tenants/:id/assign-plan */
  async assignPlan(actor: CabinetActor, id: string, planId: string): Promise<TenantView> {
    await this.tenants.assignPlan(id, planId, await this.auditActorOf(actor), actor.scope);
    return this.getTenant(actor, id);
  }

  /** POST /manager/tenants/:id/suspend */
  async suspend(actor: CabinetActor, id: string, reason?: string): Promise<TenantView> {
    await this.tenants.suspend(id, reason, await this.auditActorOf(actor), actor.scope);
    return this.getTenant(actor, id);
  }

  /** POST /manager/tenants/:id/unsuspend */
  async unsuspend(actor: CabinetActor, id: string, reason?: string): Promise<TenantView> {
    await this.tenants.unsuspend(id, await this.auditActorOf(actor), actor.scope, reason);
    return this.getTenant(actor, id);
  }

  /**
   * POST /manager/tenants/:id/impersonate — вход под владельцем своего клиента. Токен —
   * ОБЫЧНЫЙ токен директора (тот же, что выдаёт вход суперадмина), на 30 минут: прав
   * выше владельца автосервиса он не даёт, а чужой клиент — 404 ещё до выпуска токена.
   */
  async impersonate(actor: CabinetActor, id: string) {
    return this.tenants.impersonate(id, await this.auditActorOf(actor), actor.scope);
  }

  /**
   * POST /manager/tenants/:id/reset-owner-password — сброс пароля владельца СВОЕГО
   * клиента (владелец потерял доступ). Меняется пароль самого старого активного
   * директора (тот же «владелец», что и в impersonate); его прежние сессии обрываются.
   * Пароль в журнал не попадает.
   */
  async resetOwnerPassword(actor: CabinetActor, id: string, password: string): Promise<{ ok: true }> {
    const { rows: tenantRows } = await this.pool.query(
      `SELECT id, name FROM tenants WHERE id = $1::uuid AND ($2::uuid IS NULL OR manager_id = $2::uuid)`,
      [id, actor.scope.managerId ?? null],
    );
    if (tenantRows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    const { rows: owners } = await this.pool.query(
      `SELECT id, full_name
         FROM users
        WHERE tenant_id = $1
          AND role = 'director'
          AND is_active = true
          AND dismissed_at IS NULL
          AND purged_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1`,
      [id],
    );
    if (owners.length === 0) throw new NotFoundException({ message: 'У тенанта нет активного владельца' });
    const owner = owners[0];

    const hash = await bcrypt.hash(password, 10);
    // Граница сессий (165): токены владельца, выданные до сброса, перестают действовать.
    await this.pool.query(
      `UPDATE users SET password = $1, sessions_valid_from = now(), updated_at = now() WHERE id = $2`,
      [hash, owner.id],
    );
    invalidateAuthUser(owner.id);

    await this.audit.log(await this.auditActorOf(actor), 'owner_password_reset', {
      targetType: 'user',
      targetId: owner.id,
      targetName: owner.full_name,
      detail: { tenantId: id, tenantName: tenantRows[0].name },
    });
    return { ok: true };
  }

  /** GET /manager/ledger?months= — платежи и расчёты ЭТОГО актора; баланс — за всё время. */
  async ledger(actor: CabinetActor, months: unknown): Promise<ManagerLedger> {
    return this.finance.ledger(actor.userId, months);
  }

  /** GET /manager/audit-log?limit=&offset= — только записи, где актор — он сам. */
  async auditLog(actor: CabinetActor, limit: unknown, offset: unknown): Promise<AuditLogEntryRow[]> {
    return this.audit.listByActor(
      actor.userId,
      clampInt(limit, AUDIT_LIMIT_DEFAULT, 1, AUDIT_LIMIT_MAX),
      clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER),
    );
  }
}
