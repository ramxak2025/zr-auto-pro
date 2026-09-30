import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { TenantsService } from '../tenants/tenants.service';
import { DEFAULT_OWNER_SHARE_PERCENT } from './owner-share';
import type {
  ManagerLedger,
  ManagerMoney,
  ManagerSettlement,
  ManagerStats,
  ManagerSummary,
  ManagerTenantCounters,
} from './types';

/** Окно лент ledger, месяцев: по умолчанию 12, сервер держит 1..36 (как getMrrTrends). */
export const LEDGER_DEFAULT_MONTHS = 12;
const LEDGER_MIN_MONTHS = 1;
const LEDGER_MAX_MONTHS = 36;
/** Страховка размера ответа: лента платежей одного менеджера за 36 месяцев не должна быть безразмерной. */
const LEDGER_ROW_LIMIT = 2000;

/** NUMERIC / агрегат из pg (приходит строкой) → рубли с точностью до копейки. */
export function toMoney(value: unknown): number {
  const n = parseFloat(String(value ?? '0'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** a − b в копейках: 0.1 + 0.2-подобных хвостов в балансе быть не должно. */
export function subtractMoney(a: number, b: number): number {
  return Math.round(a * 100 - b * 100) / 100;
}

export function clampLedgerMonths(raw: unknown): number {
  const parsed = typeof raw === 'number' ? Math.trunc(raw) : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return LEDGER_DEFAULT_MONTHS;
  return Math.min(Math.max(parsed, LEDGER_MIN_MONTHS), LEDGER_MAX_MONTHS);
}

// Статус подписки в SQL — то же правило, что computeSubscriptionStatusOf в
// TenantsService (его же использует фильтр `?status=` списка клиентов):
//   suspended — suspended_at IS NOT NULL ИЛИ легаси is_active = false;
//   expired   — не приостановлен и subscription_end в прошлом;
//   active    — не приостановлен и (срока нет ИЛИ он не истёк).
// `IS FALSE` вместо `= false`: NULL не должен молча превращаться в «приостановлен».
const SUSPENDED_SQL = `(t.suspended_at IS NOT NULL OR t.is_active IS FALSE)`;

/** Агрегаты по клиентам; используются и с GROUP BY manager_id, и по всей платформе. */
const TENANT_COUNTERS_SQL = `
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE ${SUSPENDED_SQL})::int AS suspended,
  COUNT(*) FILTER (
    WHERE NOT ${SUSPENDED_SQL} AND t.subscription_end IS NOT NULL AND t.subscription_end < now()
  )::int AS expired,
  COUNT(*) FILTER (
    WHERE NOT ${SUSPENDED_SQL} AND (t.subscription_end IS NULL OR t.subscription_end >= now())
  )::int AS active,
  COUNT(*) FILTER (
    WHERE NOT ${SUSPENDED_SQL}
      AND t.subscription_end IS NOT NULL
      AND t.subscription_end >= now()
      AND t.subscription_end <= now() + interval '7 days'
  )::int AS expiring_in_7d`;

function emptyCounters(): ManagerTenantCounters {
  return { total: 0, active: 0, expired: 0, suspended: 0, expiringIn7d: 0 };
}

function emptyMoney(): ManagerMoney {
  return { paidThisMonth: 0, ownerShareThisMonth: 0, paidTotal: 0, ownerShareTotal: 0, settledTotal: 0, balance: 0 };
}

/** Менеджер без клиентов, платежей и расчётов: нули, а не «нет данных». */
export function emptyManagerStats(): ManagerStats {
  return { tenants: emptyCounters(), money: emptyMoney() };
}

function mapCounters(row: Record<string, unknown> | undefined): ManagerTenantCounters {
  if (!row) return emptyCounters();
  return {
    total: Number(row.total) || 0,
    active: Number(row.active) || 0,
    expired: Number(row.expired) || 0,
    suspended: Number(row.suspended) || 0,
    expiringIn7d: Number(row.expiring_in_7d) || 0,
  };
}

/**
 * Деньги и счётчики менеджеров платформы (173). Один источник для трёх потребителей:
 * список менеджеров и карточка менеджера у суперадмина, сводка/лента в кабинете самого
 * менеджера. Всё, что отдаёт «сколько менеджер должен», считается ЗДЕСЬ и только здесь —
 * два разных подсчёта долга рано или поздно разойдутся.
 *
 * Модель: платёж (`subscription_payments`, is_free = false) хранит СНИМОК доли
 * владельца (`owner_share_amount`) на момент оплаты; расчёты — `manager_settlements`.
 * Баланс = Σ owner_share_amount − Σ расчётов; > 0 — менеджер должен владельцу.
 * Считаем по `sp.manager_id` (кто провёл платёж), а не по `tenants.manager_id` (чей
 * клиент сейчас): передача клиента не переписывает историю долга.
 *
 * Все таблицы читаются через admin-пул (subscription_payments — под FORCE RLS):
 * маршруты /admin/managers/* и /manager/* маршрутизирует туда TenantContextInterceptor.
 */
@Injectable()
export class ManagerFinanceService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private tenants: TenantsService,
  ) {}

  /**
   * Счётчики клиентов и деньги для списка менеджеров — ровно ТРИ запроса на весь
   * список, независимо от числа менеджеров (без N+1). Менеджера без клиентов и
   * платежей в результате нет строк — карта содержит для него нули.
   */
  async statsFor(managerIds: string[]): Promise<Map<string, ManagerStats>> {
    const stats = new Map<string, ManagerStats>();
    if (managerIds.length === 0) return stats;
    for (const id of managerIds) stats.set(id, emptyManagerStats());

    const [tenantRes, paymentRes, settlementRes] = await Promise.all([
      this.pool.query(
        `SELECT t.manager_id, ${TENANT_COUNTERS_SQL}
           FROM tenants t
          WHERE t.manager_id = ANY($1::uuid[])
          GROUP BY t.manager_id`,
        [managerIds],
      ),
      this.pool.query(
        `SELECT sp.manager_id,
                COALESCE(SUM(sp.amount) FILTER (WHERE sp.created_at >= date_trunc('month', now())), 0) AS paid_month,
                COALESCE(SUM(sp.owner_share_amount) FILTER (WHERE sp.created_at >= date_trunc('month', now())), 0) AS share_month,
                COALESCE(SUM(sp.amount), 0) AS paid_total,
                COALESCE(SUM(sp.owner_share_amount), 0) AS share_total
           FROM subscription_payments sp
          WHERE sp.manager_id = ANY($1::uuid[])
            AND sp.is_free = false
          GROUP BY sp.manager_id`,
        [managerIds],
      ),
      this.pool.query(
        `SELECT ms.manager_id, COALESCE(SUM(ms.amount), 0) AS settled_total
           FROM manager_settlements ms
          WHERE ms.manager_id = ANY($1::uuid[])
          GROUP BY ms.manager_id`,
        [managerIds],
      ),
    ]);

    for (const row of tenantRes.rows) {
      const entry = stats.get(row.manager_id);
      if (entry) entry.tenants = mapCounters(row);
    }
    for (const row of paymentRes.rows) {
      const entry = stats.get(row.manager_id);
      if (!entry) continue;
      entry.money.paidThisMonth = toMoney(row.paid_month);
      entry.money.ownerShareThisMonth = toMoney(row.share_month);
      entry.money.paidTotal = toMoney(row.paid_total);
      entry.money.ownerShareTotal = toMoney(row.share_total);
    }
    for (const row of settlementRes.rows) {
      const entry = stats.get(row.manager_id);
      if (entry) entry.money.settledTotal = toMoney(row.settled_total);
    }
    for (const entry of stats.values()) {
      entry.money.balance = subtractMoney(entry.money.ownerShareTotal, entry.money.settledTotal);
    }
    return stats;
  }

  /**
   * Счётчики клиентов по ВСЕЙ платформе. Нужны единственному потребителю: суперадмину,
   * который открыл /manager/summary (ему кабинет отдаёт всех клиентов, как и список
   * /manager/tenants). У менеджера этот метод не вызывается — он ходит через statsFor
   * со своим id; отдельное имя вместо параметра «без фильтра» — чтобы забытый аргумент
   * не расширил менеджеру выборку до всех клиентов.
   */
  async platformTenantCounters(): Promise<ManagerTenantCounters> {
    const { rows } = await this.pool.query(`SELECT ${TENANT_COUNTERS_SQL} FROM tenants t`);
    return mapCounters(rows[0]);
  }

  /** Долг менеджера за всё время: Σ доли владельца − Σ расчётов. Окно `months` его не трогает. */
  async balanceOf(managerId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT
         COALESCE((SELECT SUM(sp.owner_share_amount)
                     FROM subscription_payments sp
                    WHERE sp.manager_id = $1 AND sp.is_free = false), 0) AS share_total,
         COALESCE((SELECT SUM(ms.amount)
                     FROM manager_settlements ms
                    WHERE ms.manager_id = $1), 0) AS settled_total`,
      [managerId],
    );
    return subtractMoney(toMoney(rows[0]?.share_total), toMoney(rows[0]?.settled_total));
  }

  /** Текущая доля владельца менеджера, % (NULL у легаси-строки → 60, как при начислении). */
  async ownerSharePercentOf(managerId: string): Promise<number> {
    const { rows } = await this.pool.query(`SELECT owner_share_percent FROM users WHERE id = $1 AND role = 'manager'`, [
      managerId,
    ]);
    const raw = rows[0]?.owner_share_percent;
    if (raw === null || raw === undefined) return DEFAULT_OWNER_SHARE_PERCENT;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : DEFAULT_OWNER_SHARE_PERCENT;
  }

  /** Сводка (`ManagerSummary`) из счётчиков/денег + текущей доли и потолка бесплатного продления. */
  buildSummary(stats: ManagerStats, ownerSharePercent: number, maxFreeDays: number): ManagerSummary {
    const { money } = stats;
    return {
      tenants: stats.tenants,
      paidThisMonth: money.paidThisMonth,
      ownerShareThisMonth: money.ownerShareThisMonth,
      myShareThisMonth: subtractMoney(money.paidThisMonth, money.ownerShareThisMonth),
      paidTotal: money.paidTotal,
      ownerShareTotal: money.ownerShareTotal,
      settledTotal: money.settledTotal,
      balance: money.balance,
      ownerSharePercent,
      maxFreeDays,
    };
  }

  /**
   * Ленты менеджера: платные оплаты ЭТОГО менеджера (со снимком доли и названием
   * автосервиса) и его расчёты с владельцем, новые сверху, окно — последние `months`
   * календарных месяцев включая текущий. `balance` — ВСЕГДА за всё время.
   */
  async ledger(managerId: string, monthsRaw: unknown): Promise<ManagerLedger> {
    const months = clampLedgerMonths(monthsRaw);
    const [paymentRes, settlementRes, balance] = await Promise.all([
      this.pool.query(
        `SELECT sp.*, t.name AS tenant_name
           FROM subscription_payments sp
           JOIN tenants t ON t.id = sp.tenant_id
          WHERE sp.manager_id = $1
            AND sp.is_free = false
            AND sp.created_at >= date_trunc('month', now()) - (($2::int - 1) * interval '1 month')
          ORDER BY sp.created_at DESC, sp.id DESC
          LIMIT ${LEDGER_ROW_LIMIT}`,
        [managerId, months],
      ),
      this.pool.query(
        `SELECT ${ManagerFinanceService.SETTLEMENT_COLUMNS}
           FROM manager_settlements ms
          WHERE ms.manager_id = $1
            AND ms.settled_on >= (date_trunc('month', now()) - (($2::int - 1) * interval '1 month'))::date
          ORDER BY ms.settled_on DESC, ms.created_at DESC, ms.id DESC
          LIMIT ${LEDGER_ROW_LIMIT}`,
        [managerId, months],
      ),
      this.balanceOf(managerId),
    ]);
    return {
      payments: paymentRes.rows.map((row) => ({
        ...this.tenants.mapSubscriptionPayment(row),
        tenantName: row.tenant_name as string,
      })),
      settlements: settlementRes.rows.map((row) => ManagerFinanceService.mapSettlement(row)),
      balance,
    };
  }

  /**
   * Колонки расчёта. `settled_on` — DATE: node-pg отдаёт его объектом Date в поясе
   * процесса (и «сегодня» легко превращается во «вчера»), поэтому, как везде в
   * проекте, дату отдаём строкой 'YYYY-MM-DD' прямо из SQL.
   */
  static readonly SETTLEMENT_COLUMNS = `ms.id, ms.manager_id, ms.amount, ms.note,
       to_char(ms.settled_on, 'YYYY-MM-DD') AS settled_on, ms.created_by, ms.created_at`;

  static mapSettlement(row: any): ManagerSettlement {
    return {
      id: row.id,
      managerId: row.manager_id,
      amount: toMoney(row.amount),
      note: row.note ?? null,
      settledOn: row.settled_on,
      createdBy: row.created_by ?? null,
      createdAt: row.created_at,
    };
  }
}
