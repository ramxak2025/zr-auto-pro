import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { isTenantLess } from '../common/auth-cache';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { MarketingService } from '../marketing/marketing.service';
import { PayInstallmentDto } from './dto/pay-installment.dto';
import { UpdateInstallmentDto } from './dto/update-installment.dto';
import { UpdateInstallmentReminderSettingsDto } from './dto/update-reminder-settings.dto';

/** Parse a NUMERIC/text money value to a JS number (NULL/garbage → 0). */
function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals — money is stored NUMERIC(14,2); avoids float drift. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Coerce an arbitrary value to a 'YYYY-MM-DD' date string, or null when it is
 * missing / unparseable. Used everywhere a `next_payment_date` flows in from a
 * request so a bad value can never blow up the DATE column (and, when called
 * inside the check-create transaction, can never roll back the sale).
 */
function toDateOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const DEFAULT_REMINDER_TEMPLATE =
  'Здравствуйте, {clientName}! Напоминаем: по рассрочке оплата {date} на сумму {amount} ₽. Спасибо!';

/**
 * Рассрочка (installments) — заменяет ручную «Дебиторку» (debts/, 081) как
 * основной поток продаж в долг.
 *
 * Модель: один `installment_plans` ряд на чек (total / down_payment / paid /
 * remaining / next_payment_date / status), плюс `installment_payments` ledger
 * частичных оплат. paid = down_payment + Σ платежей; remaining = total − paid
 * (никогда не отрицательный). status 'open' пока remaining > 0, иначе 'closed'.
 *
 * OWNS только три свои таблицы. READS clients (имя/телефон) и users (имя автора)
 * read-only. План СОЗДАЁТСЯ из ChecksService.create внутри ЕГО транзакции через
 * {@link createPlanForCheckTx} (атомарно с чеком) — здесь же живут все
 * последующие операции (оплата/перенос/погашение) и список/виджет/напоминания.
 *
 * Всё tenant-scoped: каждый запрос фильтруется по tenantID из JWT.
 */
@Injectable()
export class InstallmentsService {
  private readonly logger = new Logger('InstallmentsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private marketing: MarketingService,
  ) {}

  // ─── Row mapping ───────────────────────────────────────────────────────
  private mapPlan(r: any) {
    return {
      id: r.id as string,
      tenantId: r.tenant_id as string,
      checkId: r.check_id ?? null,
      checkNumber: r.check_number ?? null,
      clientId: r.client_id as string,
      clientName: r.client_name ?? null,
      clientPhone: r.client_phone ?? null,
      total: num(r.total),
      downPayment: num(r.down_payment),
      paid: num(r.paid),
      remaining: num(r.remaining),
      nextPaymentDate: r.next_payment_date ?? null,
      status: r.status as 'open' | 'closed',
      overdue: r.overdue === true,
      dueInDays: r.due_in_days === null || r.due_in_days === undefined ? null : parseInt(r.due_in_days, 10),
      comment: r.comment ?? null,
      createdBy: r.created_by ?? null,
      createdByName: r.created_by_name ?? null,
      createdAt: r.created_at as string,
      closedAt: r.closed_at ?? null,
    };
  }

  private mapPayment(r: any) {
    return {
      id: r.id as string,
      tenantId: r.tenant_id as string,
      planId: r.plan_id as string,
      amount: num(r.amount),
      // Строки до миграции 119 не имели колонки → считаются налом (решение
      // владельца: погашения почти всегда наличными).
      paymentMethod: (r.payment_method === 'card' ? 'card' : 'cash') as 'cash' | 'card',
      comment: r.comment ?? null,
      createdBy: r.created_by ?? null,
      createdByName: r.created_by_name ?? null,
      paidAt: r.paid_at as string,
    };
  }

  // Shared SELECT projection: plan + denormalised client / check / author +
  // computed overdue / due_in_days (Moscow date, consistent with shift cron).
  private static readonly PLAN_SELECT = `
    SELECT p.*,
           cl.full_name AS client_name, cl.phone AS client_phone,
           ch.number AS check_number,
           u.full_name AS created_by_name,
           (p.status = 'open' AND p.next_payment_date IS NOT NULL
              AND p.next_payment_date < (now() AT TIME ZONE 'Europe/Moscow')::date) AS overdue,
           (p.next_payment_date - (now() AT TIME ZONE 'Europe/Moscow')::date) AS due_in_days
      FROM installment_plans p
      LEFT JOIN clients cl ON cl.id = p.client_id AND cl.tenant_id = p.tenant_id
      LEFT JOIN checks ch ON ch.id = p.check_id AND ch.tenant_id = p.tenant_id
      LEFT JOIN users u ON u.id = p.created_by AND u.tenant_id = p.tenant_id`;

  /** Re-read a single plan (full projection), tenant-scoped. 404 when missing. */
  private async getPlanOrThrow(tenantID: string, planId: string) {
    const { rows } = await this.pool.query(`${InstallmentsService.PLAN_SELECT} WHERE p.id = $1 AND p.tenant_id = $2`, [
      planId,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Рассрочка не найдена' });
    return this.mapPlan(rows[0]);
  }

  // ─── Create (called from ChecksService.create, inside its transaction) ──

  /**
   * Create the installment PLAN for a just-inserted check, INSIDE the caller's
   * already-open transaction (mirrors WarrantyService.createFromCheckLines). The
   * check is a real (non-deferred) sale: revenue counts in full; only `remaining`
   * is owed.
   *
   *   paid      = down_payment (clamped to total)
   *   remaining = max(0, total − down_payment)
   *   status    = remaining <= 0 ? 'closed' : 'open'
   *
   * Tenant-scoped; the FK to the check is satisfied because the check row was
   * inserted earlier in the same transaction. Never throws on a bad date — it is
   * sanitised to NULL so a malformed value can't roll back the sale.
   */
  async createPlanForCheckTx(
    client: PoolClient,
    tenantID: string,
    userID: string | null,
    params: {
      checkId: string;
      clientId: string;
      total: number;
      downPayment: number;
      nextPaymentDate?: unknown;
      comment?: unknown;
    },
  ): Promise<void> {
    const total = round2(Math.max(0, num(params.total)));
    const downPayment = round2(Math.min(Math.max(0, num(params.downPayment)), total));
    const remaining = round2(Math.max(0, total - downPayment));
    const status = remaining <= 0 ? 'closed' : 'open';
    const closedAt = remaining <= 0 ? new Date().toISOString() : null;
    const nextDate = toDateOrNull(params.nextPaymentDate);
    const comment = typeof params.comment === 'string' && params.comment.trim() ? params.comment.trim() : null;

    await client.query(
      `INSERT INTO installment_plans
         (tenant_id, check_id, client_id, total, down_payment, paid, remaining,
          next_payment_date, status, comment, created_by, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        tenantID,
        params.checkId,
        params.clientId,
        total,
        downPayment,
        downPayment, // paid starts at the down payment
        remaining,
        nextDate,
        status,
        comment,
        userID,
        closedAt,
      ],
    );
  }

  /**
   * Does an installment plan already exist for this check? Runs on the caller's
   * transaction connection (PoolClient) so the check sits INSIDE the same
   * BEGIN/row-lock as the caller's decision. Reused by ChecksService when it
   * edits a CLOSED check (#61): a check sold in rassrochka carries a debt ledger
   * (installment_plans + installment_payments) that can't be cleanly re-derived
   * from the edited totals, so the edit is refused when this returns true — the
   * owner manages the rassrochka separately. Tenant-scoped; uses
   * idx_installment_plans_check.
   */
  async hasPlanForCheckTx(client: PoolClient, tenantID: string, checkId: string): Promise<boolean> {
    const { rows } = await client.query(
      `SELECT 1 FROM installment_plans WHERE tenant_id = $1 AND check_id = $2 LIMIT 1`,
      [tenantID, checkId],
    );
    return rows.length > 0;
  }

  // ─── Operations ─────────────────────────────────────────────────────────

  /**
   * Record a partial payment against a plan. Transactional + FOR UPDATE so two
   * concurrent payments can't double-spend the remaining. The recorded amount
   * is CAPPED at the remaining debt read under the lock (money-audit M1) — the
   * payments ledger can never exceed the plan total. Reduces remaining,
   * optionally moves the next date; when remaining hits 0 the plan closes.
   */
  async pay(user: JwtPayload, planId: string, dto: PayInstallmentDto) {
    const amount = round2(num(dto.amount));
    if (amount <= 0) throw new BadRequestException({ message: 'Сумма платежа должна быть положительной' });
    // Способ оплаты (119): дефолт 'cash' — старые клиенты поле не шлют, а
    // погашения в автосервисе почти всегда наличными (решение владельца).
    const method: 'cash' | 'card' = dto.method === 'card' ? 'card' : 'cash';

    const dbClient = await this.pool.connect();
    try {
      await dbClient.query('BEGIN');
      const { rows } = await dbClient.query(
        `SELECT id, total, paid, status FROM installment_plans WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [planId, user.tenantID],
      );
      if (rows.length === 0) {
        await dbClient.query('ROLLBACK');
        throw new NotFoundException({ message: 'Рассрочка не найдена' });
      }
      const plan = rows[0];
      if (plan.status === 'closed') {
        await dbClient.query('ROLLBACK');
        throw new BadRequestException({ message: 'Рассрочка уже закрыта' });
      }

      const total = num(plan.total);
      const alreadyPaid = num(plan.paid);
      // Кап по ОСТАТКУ ДОЛГА, посчитанному под FOR UPDATE (money-audit M1):
      // ledger платежей не может превысить total — иначе излишек раздувал бы
      // installmentPaid/Cash в «Движении денег» и today_cash принявшего.
      // Заодно закрывает TOCTOU в payoff(): его remaining читается БЕЗ лока,
      // но здесь всё равно клампится к актуальному остатку.
      const remainingBefore = round2(Math.max(0, total - alreadyPaid));
      const applied = round2(Math.min(amount, remainingBefore));
      const nextDate = dto.nextPaymentDate !== undefined ? toDateOrNull(dto.nextPaymentDate) : undefined;

      if (applied <= 0) {
        // Долга уже нет, но план ещё open (рассинхрон/гонка) — платёж не
        // записываем, просто закрываем план (зеркало ветки payoff «нечего
        // платить»).
        await dbClient.query(
          `UPDATE installment_plans
              SET remaining = 0, status = 'closed', closed_at = COALESCE(closed_at, now())
            WHERE id = $1 AND tenant_id = $2`,
          [planId, user.tenantID],
        );
        await dbClient.query('COMMIT');
      } else {
        const newPaid = round2(alreadyPaid + applied);
        const newRemaining = round2(Math.max(0, total - newPaid));
        const newStatus = newRemaining <= 0 ? 'closed' : 'open';

        await dbClient.query(
          `INSERT INTO installment_payments (tenant_id, plan_id, amount, payment_method, comment, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [user.tenantID, planId, applied, method, dto.comment?.trim() || null, user.userID],
        );

        await dbClient.query(
          `UPDATE installment_plans
              SET paid = $1,
                  remaining = $2,
                  status = $3,
                  closed_at = CASE WHEN $3 = 'closed' THEN COALESCE(closed_at, now()) ELSE NULL END,
                  next_payment_date = CASE WHEN $5 THEN $4 ELSE next_payment_date END
            WHERE id = $6 AND tenant_id = $7`,
          [newPaid, newRemaining, newStatus, nextDate ?? null, nextDate !== undefined, planId, user.tenantID],
        );

        await dbClient.query('COMMIT');
      }
    } catch (err) {
      try {
        await dbClient.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw err;
    } finally {
      dbClient.release();
    }

    return this.getPlanOrThrow(user.tenantID, planId);
  }

  /**
   * Pay off the whole remaining at once (close the plan). The pre-read below is
   * NOT locked (best-effort UX checks); the authoritative amount is re-clamped
   * to the live remaining inside pay()'s FOR UPDATE transaction, so a
   * concurrent partial payment can't drive paid above total (M1 TOCTOU).
   */
  async payoff(user: JwtPayload, planId: string, method?: 'cash' | 'card') {
    const { rows } = await this.pool.query(
      `SELECT remaining, status FROM installment_plans WHERE id = $1 AND tenant_id = $2`,
      [planId, user.tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Рассрочка не найдена' });
    if (rows[0].status === 'closed') throw new BadRequestException({ message: 'Рассрочка уже закрыта' });
    const remaining = round2(num(rows[0].remaining));
    if (remaining <= 0) {
      // Nothing owed but still open → just close it.
      await this.pool.query(
        `UPDATE installment_plans SET remaining = 0, status = 'closed', closed_at = COALESCE(closed_at, now())
          WHERE id = $1 AND tenant_id = $2`,
        [planId, user.tenantID],
      );
      return this.getPlanOrThrow(user.tenantID, planId);
    }
    // method пробрасывается в pay() — там же дефолт 'cash' (119).
    return this.pay(user, planId, { amount: remaining, comment: 'Погашение остатка', method });
  }

  /** Reschedule the next payment date and/or edit the comment. */
  async update(user: JwtPayload, planId: string, dto: UpdateInstallmentDto) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.nextPaymentDate !== undefined) {
      sets.push(`next_payment_date = $${idx++}`);
      vals.push(toDateOrNull(dto.nextPaymentDate));
    }
    if (dto.comment !== undefined) {
      sets.push(`comment = $${idx++}`);
      vals.push(dto.comment?.trim() || null);
    }

    if (sets.length === 0) return this.getPlanOrThrow(user.tenantID, planId);

    vals.push(planId, user.tenantID);
    const { rows } = await this.pool.query(
      `UPDATE installment_plans SET ${sets.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx} RETURNING id`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Рассрочка не найдена' });
    return this.getPlanOrThrow(user.tenantID, planId);
  }

  // ─── Reads ────────────────────────────────────────────────────────────

  /**
   * List plans for the «Рассрочка» screen (renamed from «Должники»). Default =
   * open plans, overdue first, then by soonest next date, then newest. Filter:
   *   ?status=open|closed|overdue|all  (default 'open')
   */
  async list(tenantID: string, query: { status?: string }) {
    const status = (query?.status || 'open').toLowerCase();
    let where = 'p.tenant_id = $1';
    if (status === 'open') {
      where += ` AND p.status = 'open'`;
    } else if (status === 'closed') {
      where += ` AND p.status = 'closed'`;
    } else if (status === 'overdue') {
      where += ` AND p.status = 'open' AND p.next_payment_date IS NOT NULL
                 AND p.next_payment_date < (now() AT TIME ZONE 'Europe/Moscow')::date`;
    }
    // 'all' → no extra filter.

    const { rows } = await this.pool.query(
      `${InstallmentsService.PLAN_SELECT}
        WHERE ${where}
        ORDER BY (p.status = 'closed') ASC,
                 overdue DESC,
                 p.next_payment_date ASC NULLS LAST,
                 p.created_at DESC`,
      [tenantID],
    );
    return rows.map((r) => this.mapPlan(r));
  }

  /**
   * One client's plans + flat payment ledger — for the client card section.
   * Tenant-scoped on both queries.
   */
  async clientLedger(tenantID: string, clientId: string) {
    const { rows: clientRows } = await this.pool.query(
      `SELECT full_name, phone FROM clients WHERE id = $1 AND tenant_id = $2`,
      [clientId, tenantID],
    );
    if (clientRows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });

    const { rows: planRows } = await this.pool.query(
      `${InstallmentsService.PLAN_SELECT}
        WHERE p.tenant_id = $1 AND p.client_id = $2
        ORDER BY (p.status = 'closed') ASC, p.created_at DESC`,
      [tenantID, clientId],
    );

    const { rows: payRows } = await this.pool.query(
      `SELECT ip.*, u.full_name AS created_by_name
         FROM installment_payments ip
         JOIN installment_plans p ON p.id = ip.plan_id AND p.tenant_id = ip.tenant_id
         LEFT JOIN users u ON u.id = ip.created_by AND u.tenant_id = ip.tenant_id
        WHERE ip.tenant_id = $1 AND p.client_id = $2
        ORDER BY ip.paid_at DESC`,
      [tenantID, clientId],
    );

    const plans = planRows.map((r) => this.mapPlan(r));
    const totalRemaining = round2(plans.reduce((acc, p) => acc + (p.status === 'open' ? p.remaining : 0), 0));

    return {
      clientId,
      clientName: clientRows[0].full_name as string,
      clientPhone: (clientRows[0].phone as string) ?? null,
      totalRemaining,
      plans,
      payments: payRows.map((r) => this.mapPayment(r)),
    };
  }

  /**
   * Главная widget (owner/admin): plans due within the next N days plus all
   * overdue plans. Returns the items + summary counts so the dashboard can show
   * «Рассрочка: N просрочено / сумма».
   */
  async widget(tenantID: string, days = 3) {
    const window = Number.isFinite(days) && days >= 0 ? Math.min(Math.trunc(days), 60) : 3;
    const { rows } = await this.pool.query(
      `${InstallmentsService.PLAN_SELECT}
        WHERE p.tenant_id = $1
          AND p.status = 'open'
          AND p.next_payment_date IS NOT NULL
          AND p.next_payment_date <= (now() AT TIME ZONE 'Europe/Moscow')::date + $2::int
        ORDER BY overdue DESC, p.next_payment_date ASC NULLS LAST`,
      [tenantID, window],
    );
    // Lean widget-item shape (planId, not the full plan) — matches the
    // InstallmentWidgetItem contract the dashboard card consumes.
    const items = rows.map((r) => ({
      planId: r.id as string,
      clientId: r.client_id as string,
      clientName: r.client_name ?? null,
      clientPhone: r.client_phone ?? null,
      total: num(r.total),
      remaining: num(r.remaining),
      nextPaymentDate: r.next_payment_date ?? null,
      overdue: r.overdue === true,
      dueInDays: r.due_in_days === null || r.due_in_days === undefined ? null : parseInt(r.due_in_days, 10),
    }));
    const overdueCount = items.filter((i) => i.overdue).length;
    return {
      items,
      overdueCount,
      dueSoonCount: items.length - overdueCount,
      totalRemaining: round2(items.reduce((acc, i) => acc + i.remaining, 0)),
    };
  }

  // ─── Reminder settings (owner-class) ──────────────────────────────────

  private mapReminderSettings(r: any) {
    return {
      mode: (r.mode ?? 'off') as 'off' | 'auto' | 'manual',
      daysBefore: typeof r.days_before === 'number' ? r.days_before : parseInt(r.days_before, 10) || 1,
      onDue: r.on_due !== false,
      onOverdue: r.on_overdue !== false,
      template: r.template ?? DEFAULT_REMINDER_TEMPLATE,
      lastRunAt: r.last_run_at ?? null,
    };
  }

  async getReminderSettings(tenantID: string) {
    // Tenant-less caller (superadmin, nil-UUID sentinel): return column defaults
    // WITHOUT seeding — the upsert-on-read below would FK-violate
    // installment_reminder_settings_tenant_id_fkey (no such tenant) → 500.
    // mapReminderSettings({}) yields the exact 093 defaults (mode 'off').
    if (isTenantLess(tenantID)) {
      return this.mapReminderSettings({});
    }
    const { rows } = await this.pool.query(`SELECT * FROM installment_reminder_settings WHERE tenant_id = $1`, [
      tenantID,
    ]);
    if (rows.length === 0) {
      await this.pool.query(
        `INSERT INTO installment_reminder_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantID],
      );
      const { rows: fresh } = await this.pool.query(
        `SELECT * FROM installment_reminder_settings WHERE tenant_id = $1`,
        [tenantID],
      );
      return this.mapReminderSettings(fresh[0]);
    }
    return this.mapReminderSettings(rows[0]);
  }

  async updateReminderSettings(tenantID: string, dto: UpdateInstallmentReminderSettingsDto) {
    await this.pool.query(
      `INSERT INTO installment_reminder_settings (tenant_id, mode, days_before, on_due, on_overdue, template)
       VALUES ($1, COALESCE($2,'off'), COALESCE($3,1), COALESCE($4,true), COALESCE($5,true), COALESCE($6,$7))
       ON CONFLICT (tenant_id) DO UPDATE SET
         mode = COALESCE($2, installment_reminder_settings.mode),
         days_before = COALESCE($3, installment_reminder_settings.days_before),
         on_due = COALESCE($4, installment_reminder_settings.on_due),
         on_overdue = COALESCE($5, installment_reminder_settings.on_overdue),
         template = COALESCE($6, installment_reminder_settings.template),
         updated_at = now()`,
      [
        tenantID,
        dto.mode ?? null,
        typeof dto.daysBefore === 'number' ? dto.daysBefore : null,
        typeof dto.onDue === 'boolean' ? dto.onDue : null,
        typeof dto.onOverdue === 'boolean' ? dto.onOverdue : null,
        typeof dto.template === 'string' ? dto.template : null,
        DEFAULT_REMINDER_TEMPLATE,
      ],
    );
    return this.getReminderSettings(tenantID);
  }

  // ─── Reminder sending (used by the daily cron + a manual trigger) ─────

  /**
   * Best-effort templated reminders for ONE tenant. Finds open plans that are
   * (a) due in exactly `days_before` days, (b) due today (when on_due), or
   * (c) overdue (when on_overdue), and sends each client the templated message
   * via the shared `marketing.sendClientMessage` adapter. Non-blocking & fully
   * guarded: a messaging failure for one client never aborts the rest, and the
   * whole method swallows its own errors. Tenant-scoped on every query.
   *
   * Returns simple counts; the cron ignores them, a manual trigger surfaces them.
   */
  async sendRemindersForTenant(tenantID: string): Promise<{ sent: number; failed: number; total: number }> {
    const settings = await this.getReminderSettings(tenantID);
    // Only 'auto' (cron) and 'manual' (explicit trigger) actually send; 'off' is inert.
    if (settings.mode === 'off') return { sent: 0, failed: 0, total: 0 };

    const { rows } = await this.pool.query(
      `SELECT p.id, p.client_id, p.remaining, p.next_payment_date,
              CASE
                WHEN p.next_payment_date > (now() AT TIME ZONE 'Europe/Moscow')::date THEN 'before'
                WHEN p.next_payment_date = (now() AT TIME ZONE 'Europe/Moscow')::date THEN 'due'
                ELSE 'overdue'
              END AS phase,
              cl.full_name AS client_name, cl.phone AS client_phone
         FROM installment_plans p
         JOIN clients cl ON cl.id = p.client_id AND cl.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1
          AND p.status = 'open'
          AND p.next_payment_date IS NOT NULL
          AND cl.phone IS NOT NULL AND btrim(cl.phone) <> ''
          AND (
            p.next_payment_date = (now() AT TIME ZONE 'Europe/Moscow')::date + $2::int
            OR ($3 AND p.next_payment_date = (now() AT TIME ZONE 'Europe/Moscow')::date)
            OR ($4 AND p.next_payment_date < (now() AT TIME ZONE 'Europe/Moscow')::date)
          )
        LIMIT 500`,
      [tenantID, settings.daysBefore, settings.onDue, settings.onOverdue],
    );

    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      const dateLabel = r.next_payment_date ? String(r.next_payment_date).slice(0, 10) : '';
      const message = (settings.template || DEFAULT_REMINDER_TEMPLATE)
        .replace(/\{clientName\}/g, r.client_name || 'клиент')
        .replace(/\{amount\}/g, String(round2(num(r.remaining))))
        .replace(/\{date\}/g, dateLabel);
      try {
        // Anti-spam gate. dedup_key `installment_reminder:<planId>:<dueDate>:<phase>`
        // = at most ONE reminder per plan per due-date per phase (before/due/
        // overdue). Kills the daily-overdue-spam an open plan would otherwise
        // generate (it matches the overdue branch every day), while still
        // allowing the meaningful pre-/on-/first-overdue touch points.
        const dueDate = r.next_payment_date ? String(r.next_payment_date).slice(0, 10) : 'na';
        const result = await this.marketing.guardAndLogSend({
          tenantId: tenantID,
          phone: r.client_phone,
          body: message,
          messageType: 'reminder',
          clientId: r.client_id,
          dedupKey: `installment_reminder:${r.id}:${dueDate}:${r.phase}`,
        });
        if (result.status === 'sent') {
          sent++;
        } else if (result.status === 'failed') {
          failed++;
          if (result.reason === 'no_provider') {
            // No provider for this tenant → the rest will fail identically; stop.
            failed = rows.length - sent;
            break;
          }
        }
        // skipped_dedup → already reminded for this plan/date/phase; not a failure.
      } catch (err) {
        failed++;
        this.logger.warn(`Installment reminder failed for plan ${r.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { sent, failed, total: rows.length };
  }

  /**
   * Manual trigger from the UI («Отправить напоминания сейчас»). Allowed for any
   * mode except 'off' so the owner can fire a one-off blast even on 'manual'.
   */
  async sendRemindersNow(tenantID: string): Promise<{ sent: number; failed: number; total: number }> {
    const settings = await this.getReminderSettings(tenantID);
    if (settings.mode === 'off') {
      throw new BadRequestException({ message: 'Напоминания выключены — включите режим «авто» или «вручную»' });
    }
    return this.sendRemindersForTenant(tenantID);
  }
}
