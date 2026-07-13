import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { PushService } from '../push/push.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ScheduleService } from '../schedule/schedule.service';
import { invalidateReportsForTenant } from '../common/reports-cache';

interface PremiumDto {
  userId: string;
  type: 'cash' | 'rate_bonus';
  amount?: number;
  bonusPercent?: number;
  reason: string;
  periodMonthYear?: string;
}

@Injectable()
export class SalaryService {
  private readonly logger = new Logger('SalaryService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private push: PushService,
    private expenses: ExpensesService,
    private schedule: ScheduleService,
  ) {}

  /**
   * v3.0.1 ФИЧА 4 — сколько ОТРАБОТАННЫХ смен у каждого сотрудника в диапазоне
   * [dateFrom, dateTo] (YYYY-MM-DD, включительно). «Смена» определяется НАСТРОЙКАМИ
   * расписания тенанта (schedule_settings.shift_statuses → ScheduleService.
   * buildShiftFilter): владелец сам решает, что считать сменой (дефолт: worked +
   * short). Возвращает Map<userId, count>. Если тенант не считает ничего сменой
   * (buildShiftFilter → null) — пустая карта (у всех 0 смен → perDay = null).
   *
   * buildShiftFilter возвращает SQL-предикат БЕЗ плейсхолдеров (статусы —
   * литералы из белого списка ALLOWED_SHIFT_STATUSES), поэтому его безопасно
   * инлайнить; параметры запроса — только tenant + диапазон дат.
   */
  private async workedShiftsByUser(tenantID: string, dateFrom: string, dateTo: string): Promise<Map<string, number>> {
    const filter = await this.schedule.buildShiftFilter(tenantID);
    if (!filter) return new Map();
    const { rows } = await this.pool.query(
      `SELECT user_id, COUNT(*)::int AS worked
         FROM schedule_entries
        WHERE tenant_id = $1 AND date >= $2::date AND date <= $3::date
          AND ${filter.sql}
        GROUP BY user_id`,
      [tenantID, dateFrom, dateTo],
    );
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.user_id as string, parseInt(r.worked, 10) || 0);
    return map;
  }

  private static readonly MONTH_NAMES = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];

  async getAll(tenantID: string, query: any) {
    const dateFrom =
      query.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo = query.dateTo || new Date().toISOString().split('T')[0];

    const { rows } = await this.pool.query(
      `WITH svc AS (
         -- #56: service salary attributed to each service line's EXECUTOR
         -- (COALESCE(line.master_id, check.master_id)) — not the check creator.
         -- Sums the baked per-line salary_amount, so this reads stored data and
         -- retroactively fixes past checks.
         SELECT COALESCE(sl.master_id, ch.master_id) AS earner_id,
                COALESCE(SUM(COALESCE(sl.salary_amount, 0)), 0) AS service_earnings
           FROM checks ch
           JOIN check_service_lines sl ON sl.check_id = ch.id
          WHERE ch.tenant_id = $1 AND ch.is_deferred = false AND ch.deleted_at IS NULL
            AND ch.date >= $2 AND ch.date <= ($3::date + 1)::timestamptz
          GROUP BY COALESCE(sl.master_id, ch.master_id)
       ),
       prod AS (
         -- Product salary, revenue and check-count stay attributed to the check
         -- creator (checks.master_id) — untouched by #56.
         SELECT ch.master_id AS earner_id,
                COALESCE(SUM(COALESCE(ch.product_salary_total, 0)), 0) AS product_earnings,
                COALESCE(SUM(ch.total_revenue), 0) AS total_revenue,
                COUNT(ch.id) AS check_count
           FROM checks ch
          WHERE ch.tenant_id = $1 AND ch.is_deferred = false AND ch.deleted_at IS NULL
            AND ch.date >= $2 AND ch.date <= ($3::date + 1)::timestamptz
          GROUP BY ch.master_id
       )
       SELECT u.id as master_id, u.full_name as master_name,
              COALESCE(u.salary_percent, 0) as salary_percent,
              COALESCE(u.product_salary_percent, 0) as product_salary_percent,
              COALESCE(svc.service_earnings, 0) as service_earnings,
              COALESCE(prod.product_earnings, 0) as product_earnings,
              COALESCE(svc.service_earnings, 0) + COALESCE(prod.product_earnings, 0) as total_earnings,
              COALESCE(prod.total_revenue, 0) as total_revenue,
              COALESCE(prod.check_count, 0) as check_count
         FROM users u
         LEFT JOIN svc ON svc.earner_id = u.id
         LEFT JOIN prod ON prod.earner_id = u.id
        WHERE u.tenant_id = $1 AND u.role IN ('master', 'admin')
        ORDER BY total_earnings DESC`,
      [tenantID, dateFrom, dateTo],
    );

    // Build month_year values for the date range to query payments
    const monthYears = this.getMonthYearsForRange(dateFrom, dateTo);

    // Query payments for all masters in the period
    let paymentRows: any[] = [];
    if (monthYears.length > 0) {
      const placeholders = monthYears.map((_, i) => `$${i + 2}`).join(', ');
      const { rows: pRows } = await this.pool.query(
        `SELECT sp.*, u.full_name as user_name, c.full_name as creator_name
         FROM salary_payments sp
         LEFT JOIN users u ON u.id = sp.user_id
         LEFT JOIN users c ON c.id = sp.created_by
         WHERE sp.tenant_id = $1 AND sp.month_year IN (${placeholders})
         ORDER BY sp.date DESC LIMIT 500`,
        [tenantID, ...monthYears],
      );
      paymentRows = pRows;
    }

    // Group payments by user_id
    const paymentsByUser: Record<string, any[]> = {};
    for (const p of paymentRows) {
      if (!paymentsByUser[p.user_id]) paymentsByUser[p.user_id] = [];
      paymentsByUser[p.user_id].push({
        id: p.id,
        userId: p.user_id,
        userName: p.user_name,
        amount: parseFloat(p.amount) || 0,
        monthYear: p.month_year,
        type: p.type,
        comment: p.comment,
        createdBy: p.created_by,
        creatorName: p.creator_name,
        date: p.date,
        createdAt: p.created_at,
      });
    }

    // Premiums for the same period — both cash and rate_bonus rows.
    const { rows: premRows } = await this.pool.query(
      `SELECT sp.*, u.full_name as user_name, a.full_name as awarder_name
       FROM salary_premiums sp
       LEFT JOIN users u ON u.id = sp.user_id
       LEFT JOIN users a ON a.id = sp.awarded_by
       WHERE sp.tenant_id = $1
         AND (sp.created_at >= $2::timestamptz AND sp.created_at <= ($3::date + 1)::timestamptz)`,
      [tenantID, dateFrom, dateTo],
    );
    const premiumsByUser: Record<string, any[]> = {};
    for (const p of premRows) {
      if (!premiumsByUser[p.user_id]) premiumsByUser[p.user_id] = [];
      premiumsByUser[p.user_id].push({
        id: p.id,
        userId: p.user_id,
        userName: p.user_name,
        type: p.type,
        amount: p.amount === null || p.amount === undefined ? undefined : parseFloat(p.amount) || 0,
        bonusPercent:
          p.bonus_percent === null || p.bonus_percent === undefined ? undefined : parseFloat(p.bonus_percent) || 0,
        reason: p.reason,
        periodMonthYear: p.period_month_year,
        awardedBy: p.awarded_by,
        awarderName: p.awarder_name,
        awardedAt: p.created_at,
      });
    }

    // Penalties for the same period (056_salary_penalties) — subtracted from
    // the employee's remaining owed amount.
    const { rows: penRows } = await this.pool.query(
      `SELECT pen.*, u.full_name as user_name, c.full_name as creator_name
       FROM salary_penalties pen
       LEFT JOIN users u ON u.id = pen.user_id
       LEFT JOIN users c ON c.id = pen.created_by
       WHERE pen.tenant_id = $1
         AND pen.date >= $2::timestamptz AND pen.date <= ($3::date + 1)::timestamptz`,
      [tenantID, dateFrom, dateTo],
    );
    const penaltiesByUser: Record<string, any[]> = {};
    for (const p of penRows) {
      if (!penaltiesByUser[p.user_id]) penaltiesByUser[p.user_id] = [];
      penaltiesByUser[p.user_id].push(this.mapPenalty(p));
    }

    // «Мотивация» (095_motivation_promo_products): sum each master's promo-product
    // bonuses accrued inside the period. ADDITIVE — a tenant with no accruals
    // yields an empty map, so motivationAmount is 0 and totalEarnings /
    // remainingAmount stay byte-identical to before this feature. Same inclusive
    // date-range convention as the checks / premiums queries above (accrued_at
    // within [dateFrom, dateTo + 1 day)). Attributed by employee_id = the credited
    // master, mirroring how product revenue is attributed to checks.master_id.
    const { rows: motivationRows } = await this.pool.query(
      `SELECT employee_id, COALESCE(SUM(amount), 0) AS amount
         FROM motivation_accruals
        WHERE tenant_id = $1
          AND employee_id IS NOT NULL
          AND accrued_at >= $2::timestamptz
          AND accrued_at <= ($3::date + 1)::timestamptz
        GROUP BY employee_id`,
      [tenantID, dateFrom, dateTo],
    );
    const motivationByUser: Record<string, number> = {};
    for (const m of motivationRows) {
      motivationByUser[m.employee_id] = parseFloat(m.amount) || 0;
    }

    // v3.0.1 ФИЧА 4 — отработанные смены за тот же период (по настройкам
    // расписания). perDay = totalEarnings / workedShifts; смен 0 → perDay = null
    // (не делим). Один запрос на всех сотрудников.
    const shiftsByUser = await this.workedShiftsByUser(tenantID, dateFrom, dateTo);

    return rows.map((r) => {
      const masterId = r.master_id;
      const masterPayments = paymentsByUser[masterId] || [];
      const masterPremiums = premiumsByUser[masterId] || [];
      const masterPenalties = penaltiesByUser[masterId] || [];
      const paidAmount = masterPayments.reduce((sum: number, p: any) => sum + p.amount, 0);
      const baseEarnings = parseFloat(r.total_earnings) || 0;
      const premiumsAmount = masterPremiums.reduce(
        (sum: number, p: any) => sum + (p.type === 'cash' ? p.amount || 0 : 0),
        0,
      );
      const penaltiesAmount = masterPenalties.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      // «Мотивация»: promo-product bonus the master earned in the period. Added to
      // what the shop owes (totalEarnings → remainingAmount). 0 when no promos.
      const motivationAmount = motivationByUser[masterId] || 0;
      const totalEarnings = baseEarnings + premiumsAmount + motivationAmount;
      // «ЗП за день» = заработано за период ÷ отработанных смен. null при 0 смен.
      const workedShifts = shiftsByUser.get(masterId) || 0;
      const perDay = workedShifts > 0 ? Math.round(totalEarnings / workedShifts) : null;

      return {
        masterId,
        masterName: r.master_name,
        salaryPercent: parseFloat(r.salary_percent) || 0,
        productSalaryPercent: parseFloat(r.product_salary_percent) || 0,
        serviceEarnings: parseFloat(r.service_earnings) || 0,
        productEarnings: parseFloat(r.product_earnings) || 0,
        premiumsAmount,
        penaltiesAmount,
        motivationAmount,
        totalEarnings,
        totalRevenue: parseFloat(r.total_revenue) || 0,
        checkCount: parseInt(r.check_count) || 0,
        paidAmount,
        // Penalties reduce what the shop still owes the employee.
        remainingAmount: totalEarnings - paidAmount - penaltiesAmount,
        // v3.0.1 ФИЧА 4 — «ЗП за день» (по отработанным сменам за период).
        workedShifts,
        perDay,
        payments: masterPayments,
        premiums: masterPremiums,
        penalties: masterPenalties,
      };
    });
  }

  private getMonthYearsForRange(dateFrom: string, dateTo: string): string[] {
    const result: string[] = [];
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    const current = new Date(start.getFullYear(), start.getMonth(), 1);

    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      result.push(`${year}-${month}`);
      current.setMonth(current.getMonth() + 1);
    }

    return result;
  }

  async getPayments(tenantID: string, params: any) {
    let where = 'sp.tenant_id = $1';
    const queryParams: any[] = [tenantID];
    let idx = 2;

    if (params.userId) {
      where += ` AND sp.user_id = $${idx++}`;
      queryParams.push(params.userId);
    }
    if (params.monthYear) {
      where += ` AND sp.month_year = $${idx++}`;
      queryParams.push(params.monthYear);
    }

    const { rows } = await this.pool.query(
      `SELECT sp.*, u.full_name as user_name, c.full_name as creator_name,
              spc.confirmed_at
       FROM salary_payments sp
       LEFT JOIN users u ON u.id = sp.user_id
       LEFT JOIN users c ON c.id = sp.created_by
       LEFT JOIN salary_payment_confirmations spc ON spc.payment_id = sp.id AND spc.user_id = sp.user_id
       WHERE ${where}
       ORDER BY sp.date DESC`,
      queryParams,
    );

    return rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      amount: parseFloat(r.amount) || 0,
      monthYear: r.month_year,
      type: r.type,
      comment: r.comment,
      createdBy: r.created_by,
      creatorName: r.creator_name,
      date: r.date,
      confirmedAt: r.confirmed_at ?? null,
      createdAt: r.created_at,
    }));
  }

  async createPayment(tenantID: string, createdBy: string, dto: any) {
    // Verify the target user belongs to the caller's tenant. Without this
    // a director from tenant A could mint a "salary payment" against a
    // user in tenant B — corrupting B's salary history with a foreign
    // expense and creating an expense row in A under B's user_id.
    const { rows: userTenantRows } = await this.pool.query(
      'SELECT full_name FROM users WHERE id = $1 AND tenant_id = $2',
      [dto.userId, tenantID],
    );
    if (userTenantRows.length === 0) {
      throw new BadRequestException({ message: 'Сотрудник не найден' });
    }
    const userName = userTenantRows[0].full_name || 'Сотрудник';

    // 1. Insert salary payment
    const { rows: paymentRows } = await this.pool.query(
      `INSERT INTO salary_payments (tenant_id, user_id, amount, month_year, type, comment, created_by, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING *`,
      [tenantID, dto.userId, dto.amount, dto.monthYear, dto.type || 'salary', dto.comment || null, createdBy],
    );
    const payment = paymentRows[0];

    // 2. Find or create "Зарплата" expense category for this tenant
    let categoryId: string;
    const { rows: catRows } = await this.pool.query(
      `SELECT id FROM expense_categories WHERE tenant_id = $1 AND name = 'Зарплата' LIMIT 1`,
      [tenantID],
    );
    if (catRows.length > 0) {
      categoryId = catRows[0].id;
    } else {
      const { rows: newCatRows } = await this.pool.query(
        `INSERT INTO expense_categories (name, tenant_id) VALUES ('Зарплата', $1) RETURNING id`,
        [tenantID],
      );
      categoryId = newCatRows[0].id;
    }

    // Format month_year for description (e.g., "2026-02" -> "Февраль 2026")
    const monthNames = [
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ];
    const [year, month] = dto.monthYear.split('-');
    const monthName = monthNames[parseInt(month, 10) - 1] || dto.monthYear;
    const description = `Зарплата: ${userName} за ${monthName} ${year}`;

    // 4. Create expense record
    await this.pool.query(
      `INSERT INTO expenses (category_id, amount, description, date, user_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [categoryId, dto.amount, description, payment.date, createdBy, tenantID],
    );

    // 5. Push notification to the employee — non-blocking; failure is logged
    // inside push.service. We use a short Russian title so the iOS lock
    // screen shows it cleanly.
    const titleByType: Record<string, string> = {
      salary: 'Зарплата',
      advance: 'Аванс',
      premium: 'Премия',
    };
    const title = titleByType[String(payment.type)] || 'Зарплата';
    const formatted = (parseFloat(payment.amount) || 0).toLocaleString('ru-RU');
    this.push.sendToUserCategory(payment.user_id, 'salary', `${title} начислена`, `Сумма: ${formatted} ₽`, {
      kind: 'salary',
      paymentId: payment.id,
      paymentType: payment.type,
    });

    // 6. Return created payment with user info
    return {
      id: payment.id,
      userId: payment.user_id,
      userName,
      amount: parseFloat(payment.amount) || 0,
      monthYear: payment.month_year,
      type: payment.type,
      comment: payment.comment,
      createdBy: payment.created_by,
      date: payment.date,
      createdAt: payment.created_at,
    };
  }

  // ─── Premiums ────────────────────────────────────────────────────────

  /**
   * Award a premium to an employee. The DB CHECK constraint forces type into
   * {cash, rate_bonus}; here we additionally enforce that the matching
   * monetary field is filled.
   */
  async createPremium(tenantID: string, awardedBy: string, dto: PremiumDto) {
    if (!dto || !dto.userId || !dto.type || !dto.reason) {
      throw new BadRequestException({ message: 'userId, type и reason обязательны' });
    }
    if (dto.type === 'cash' && (dto.amount === undefined || Number(dto.amount) <= 0)) {
      throw new BadRequestException({ message: 'Для премии типа "cash" укажите сумму' });
    }
    if (dto.type === 'rate_bonus' && (dto.bonusPercent === undefined || Number(dto.bonusPercent) <= 0)) {
      throw new BadRequestException({ message: 'Для премии "rate_bonus" укажите процент' });
    }

    const { rows: userRows } = await this.pool.query('SELECT full_name FROM users WHERE id=$1 AND tenant_id=$2', [
      dto.userId,
      tenantID,
    ]);
    if (userRows.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });

    const { rows } = await this.pool.query(
      `INSERT INTO salary_premiums (
         tenant_id, user_id, type, amount, bonus_percent, reason, period_month_year, awarded_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        tenantID,
        dto.userId,
        dto.type,
        dto.type === 'cash' ? dto.amount : null,
        dto.type === 'rate_bonus' ? dto.bonusPercent : null,
        dto.reason,
        dto.periodMonthYear ?? null,
        awardedBy,
      ],
    );
    const p = rows[0];

    // Push the news so the employee sees it instantly.
    const body =
      dto.type === 'cash'
        ? `Сумма: ${(parseFloat(p.amount) || 0).toLocaleString('ru-RU')} ₽ — ${dto.reason}`
        : `Бонус к ставке: +${parseFloat(p.bonus_percent) || 0}% — ${dto.reason}`;
    this.push.sendToUserCategory(dto.userId, 'salary', 'Премия начислена', body, { kind: 'premium', premiumId: p.id });

    return this.mapPremium(p);
  }

  async listPremiums(tenantID: string, query: { userId?: string; monthYear?: string }) {
    const conds: string[] = ['sp.tenant_id=$1'];
    const params: any[] = [tenantID];
    let idx = 2;
    if (query.userId) {
      conds.push(`sp.user_id=$${idx++}`);
      params.push(query.userId);
    }
    if (query.monthYear) {
      conds.push(`sp.period_month_year=$${idx++}`);
      params.push(query.monthYear);
    }
    const { rows } = await this.pool.query(
      `SELECT sp.*, u.full_name as user_name, a.full_name as awarder_name
       FROM salary_premiums sp
       LEFT JOIN users u ON u.id = sp.user_id
       LEFT JOIN users a ON a.id = sp.awarded_by
       WHERE ${conds.join(' AND ')}
       ORDER BY sp.created_at DESC`,
      params,
    );
    return rows.map((r) => this.mapPremium(r));
  }

  async removePremium(id: string, tenantID: string) {
    const { rowCount } = await this.pool.query('DELETE FROM salary_premiums WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (!rowCount) throw new NotFoundException({ message: 'Премия не найдена' });
    return { message: 'Удалено' };
  }

  private mapPremium(r: any) {
    return {
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      type: r.type,
      amount: r.amount === null || r.amount === undefined ? undefined : parseFloat(r.amount) || 0,
      bonusPercent:
        r.bonus_percent === null || r.bonus_percent === undefined ? undefined : parseFloat(r.bonus_percent) || 0,
      reason: r.reason,
      periodMonthYear: r.period_month_year,
      awardedBy: r.awarded_by,
      awarderName: r.awarder_name,
      awardedAt: r.created_at,
    };
  }

  // ─── Penalties (штрафы, 056_salary_penalties) ────────────────────────

  /**
   * Apply a penalty to an employee. The amount is subtracted from the
   * employee's remaining owed salary in `getAll`. No expense row is written —
   * a penalty reduces what is owed, it is not money that left the till.
   */
  async createPenalty(
    tenantID: string,
    createdBy: string,
    dto: { userId: string; amount: number; description?: string; date?: string },
  ) {
    if (!dto || !dto.userId) {
      throw new BadRequestException({ message: 'userId обязателен' });
    }
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({ message: 'Сумма штрафа должна быть положительной' });
    }

    // Mandatory reason «за что». Enforced here (whitespace-only → 400), in the
    // DTO (@IsNotEmpty) and at the DB (salary_penalties.description NOT NULL +
    // non-blank CHECK, 100_salary_payouts_and_fines).
    const comment = String(dto.description ?? '').trim();
    if (!comment) {
      throw new BadRequestException({ message: 'Укажите причину штрафа' });
    }

    // The target must belong to the caller's tenant — same isolation guard
    // used by createPayment / createPremium.
    const { rows: userRows } = await this.pool.query('SELECT full_name FROM users WHERE id=$1 AND tenant_id=$2', [
      dto.userId,
      tenantID,
    ]);
    if (userRows.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });

    const { rows } = await this.pool.query(
      `INSERT INTO salary_penalties (tenant_id, user_id, amount, description, date, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6)
       RETURNING *`,
      [tenantID, dto.userId, amount, comment, dto.date ?? null, createdBy],
    );
    const p = rows[0];
    p.user_name = userRows[0].full_name;

    // Notify the employee so a penalty is never silent.
    const formatted = amount.toLocaleString('ru-RU');
    this.push.sendToUserCategory(dto.userId, 'penalty', 'Штраф наложен', `${formatted} ₽ — ${comment}`, {
      kind: 'penalty',
      penaltyId: p.id,
    });

    return this.mapPenalty(p);
  }

  async listPenalties(tenantID: string, query: { userId?: string }) {
    const conds: string[] = ['pen.tenant_id=$1'];
    const params: any[] = [tenantID];
    let idx = 2;
    if (query.userId) {
      conds.push(`pen.user_id=$${idx++}`);
      params.push(query.userId);
    }
    const { rows } = await this.pool.query(
      `SELECT pen.*, u.full_name as user_name, c.full_name as creator_name
       FROM salary_penalties pen
       LEFT JOIN users u ON u.id = pen.user_id
       LEFT JOIN users c ON c.id = pen.created_by
       WHERE ${conds.join(' AND ')}
       ORDER BY pen.date DESC`,
      params,
    );
    return rows.map((r) => this.mapPenalty(r));
  }

  async deletePenalty(id: string, tenantID: string) {
    const { rowCount } = await this.pool.query('DELETE FROM salary_penalties WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (!rowCount) throw new NotFoundException({ message: 'Штраф не найден' });
    return { message: 'Удалено' };
  }

  private mapPenalty(r: any) {
    return {
      id: r.id,
      userId: r.user_id,
      userName: r.user_name ?? undefined,
      amount: parseFloat(r.amount) || 0,
      description: r.description ?? undefined,
      // Owner-facing alias of `description` — the fine «comment» (за что). Now
      // always present (NOT NULL since 100). SalaryFine.comment reads this.
      comment: r.description ?? undefined,
      date: r.date,
      createdBy: r.created_by ?? undefined,
      creatorName: r.creator_name ?? undefined,
      createdAt: r.created_at,
    };
  }

  // ─── Payment confirmations ───────────────────────────────────────────

  /**
   * Employee confirms receipt of a salary payment. Uniqueness is enforced
   * by the DB index — re-confirming returns the existing confirmation
   * timestamp without bumping it (we want the FIRST confirmation, the
   * canonical "yes I got it" moment).
   */
  async confirmPayment(paymentId: string, tenantID: string, userID: string) {
    const { rows: paymentRows } = await this.pool.query(
      'SELECT sp.user_id FROM salary_payments sp WHERE sp.id=$1 AND sp.tenant_id=$2 LIMIT 1',
      [paymentId, tenantID],
    );
    if (paymentRows.length === 0) throw new NotFoundException({ message: 'Выплата не найдена' });
    const ownerId = paymentRows[0].user_id as string;
    if (ownerId !== userID) {
      throw new BadRequestException({ message: 'Подтвердить может только получатель выплаты' });
    }

    const { rows } = await this.pool.query(
      `INSERT INTO salary_payment_confirmations (payment_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (payment_id, user_id) DO NOTHING
       RETURNING confirmed_at`,
      [paymentId, userID],
    );
    if (rows.length > 0) {
      return { paymentId, userId: userID, confirmedAt: rows[0].confirmed_at };
    }
    // Already confirmed — fetch existing timestamp.
    const { rows: existing } = await this.pool.query(
      'SELECT confirmed_at FROM salary_payment_confirmations WHERE payment_id=$1 AND user_id=$2',
      [paymentId, userID],
    );
    return { paymentId, userId: userID, confirmedAt: existing[0]?.confirmed_at ?? null };
  }

  async getMy(tenantID: string, userID: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 1).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { rows: userRows } = await this.pool.query(
      'SELECT full_name, COALESCE(salary_percent, 0) as salary_percent, COALESCE(product_salary_percent, 0) as product_salary_percent FROM users WHERE id=$1 AND tenant_id=$2',
      [userID, tenantID],
    );
    const user = userRows[0] || { full_name: '', salary_percent: 0, product_salary_percent: 0 };

    // Product salary + cash/card/warranty + check counts stay attributed to the
    // check creator (master_id = $1). Service salary is summed separately by the
    // line executor (#56) below, then folded into today/week/month/total.
    // Рассрочка ('installment') участвует в нал/карта: первый взнос лежит в
    // cash_amount/card_amount (мобилка кладёт весь взнос в наличные, web может
    // разбить нал+карта) — иначе касса мастера теряла принятые живые деньги.
    const { rows: prodRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= $2 THEN COALESCE(product_salary_total, 0) END), 0) as today_product,
         COALESCE(SUM(CASE WHEN date >= $3 THEN COALESCE(product_salary_total, 0) END), 0) as week_product,
         COALESCE(SUM(CASE WHEN date >= $4 THEN COALESCE(product_salary_total, 0) END), 0) as month_product,
         COALESCE(SUM(COALESCE(product_salary_total, 0)), 0) as total_product,
         COUNT(CASE WHEN date >= $2 THEN 1 END) as today_checks,
         COUNT(CASE WHEN date >= $4 THEN 1 END) as month_checks,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method IN ('cash','cash_card','installment') THEN cash_amount END), 0) as today_cash,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method IN ('card','cash_card','installment') THEN card_amount END), 0) as today_card,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method = 'warranty' THEN total_revenue END), 0) as today_warranty
       FROM checks
       WHERE master_id = $1 AND is_deferred = false AND tenant_id = $5 AND deleted_at IS NULL`,
      [userID, todayStart, weekStart, monthStart, tenantID],
    );

    // #56: service salary this user EARNED as the line executor — their own
    // service lines on ANY check (whoever created it), bucketed by check date.
    const { rows: svcRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN ch.date >= $2 THEN COALESCE(sl.salary_amount, 0) END), 0) as today_service,
         COALESCE(SUM(CASE WHEN ch.date >= $3 THEN COALESCE(sl.salary_amount, 0) END), 0) as week_service,
         COALESCE(SUM(CASE WHEN ch.date >= $4 THEN COALESCE(sl.salary_amount, 0) END), 0) as month_service,
         COALESCE(SUM(COALESCE(sl.salary_amount, 0)), 0) as total_service
       FROM checks ch
       JOIN check_service_lines sl ON sl.check_id = ch.id
       WHERE COALESCE(sl.master_id, ch.master_id) = $1 AND ch.is_deferred = false AND ch.tenant_id = $5
         AND ch.deleted_at IS NULL`,
      [userID, todayStart, weekStart, monthStart, tenantID],
    );

    // Погашения рассрочки, принятые СЕГОДНЯ этим пользователем (created_by =
    // userID, 093/119): живые деньги у него на руках — раньше касса мастера их
    // теряла вовсе («принял погашение наличными — нигде не видно»). Атрибуция
    // по ПРИНЯВШЕМУ платёж, а не по мастеру исходного чека. Разбивка по
    // payment_method (119): 'card' → today_card, всё остальное → today_cash
    // (строки до миграции считаются налом — решение владельца). Tenant-scoped.
    const { rows: instRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN payment_method = 'card' THEN amount ELSE 0 END), 0) as today_inst_card,
         COALESCE(SUM(CASE WHEN COALESCE(payment_method, 'cash') <> 'card' THEN amount ELSE 0 END), 0) as today_inst_cash
       FROM installment_payments
       WHERE tenant_id = $1 AND created_by = $2 AND paid_at >= $3`,
      [tenantID, userID, todayStart],
    );
    const todayInstCash = parseFloat(instRows[0]?.today_inst_cash) || 0;
    const todayInstCard = parseFloat(instRows[0]?.today_inst_card) || 0;

    const prodAgg = prodRows[0];
    const svcAgg = svcRows[0];
    const todayService = parseFloat(svcAgg.today_service) || 0;
    const weekService = parseFloat(svcAgg.week_service) || 0;
    const monthService = parseFloat(svcAgg.month_service) || 0;
    const totalService = parseFloat(svcAgg.total_service) || 0;
    const todayProduct = parseFloat(prodAgg.today_product) || 0;
    const weekProduct = parseFloat(prodAgg.week_product) || 0;
    const monthProduct = parseFloat(prodAgg.month_product) || 0;
    const totalProduct = parseFloat(prodAgg.total_product) || 0;

    // Fetch product commission promotions for this master
    const { rows: promoRows } = await this.pool.query(
      `SELECT pc.percent, p.id as product_id, p.name as product_name,
              p.sell_price, p.cost_price, p.photo
       FROM product_commissions pc
       JOIN products p ON p.id = pc.product_id
       WHERE pc.user_id = $1 AND pc.tenant_id = $2
       ORDER BY pc.percent DESC, p.name`,
      [userID, tenantID],
    );

    const productPromotions = promoRows.map((p) => ({
      productId: p.product_id,
      productName: p.product_name,
      percent: parseFloat(p.percent) || 0,
      sellPrice: parseFloat(p.sell_price) || 0,
      costPrice: parseFloat(p.cost_price) || 0,
      photo: p.photo,
      estimatedBonus: Math.round(
        ((parseFloat(p.sell_price) || 0) - (parseFloat(p.cost_price) || 0)) * (parseFloat(p.percent) / 100),
      ),
    }));

    // «Мотивация» (095): this master's promo-product bonuses for today / this
    // month / all-time. NEW additive fields — the existing today/week/month/total
    // earnings above are intentionally LEFT UNTOUCHED (motivation is a separate
    // component, never folded into base earnings), so legacy clients are unaffected.
    const { rows: motRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN accrued_at >= $2 THEN amount END), 0) AS today,
         COALESCE(SUM(CASE WHEN accrued_at >= $3 THEN amount END), 0) AS month,
         COALESCE(SUM(amount), 0) AS total
       FROM motivation_accruals
       WHERE tenant_id = $1 AND employee_id = $4`,
      [tenantID, todayStart, monthStart, userID],
    );
    const mot = motRows[0] || { today: 0, month: 0, total: 0 };

    // v3.0.1 ФИЧА 4 — «ЗП за день / за месяц» на ГЛАВНОЙ у самого сотрудника
    // (master-view). Отработанные смены с начала месяца по сегодня (по настройкам
    // расписания тенанта). perDay = ЗП за месяц (month) ÷ отработанных смен; смен
    // 0 → null (показываем только «за месяц»). Даты — локальные YYYY-MM-DD,
    // согласованно с monthStart выше.
    const y = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const shiftsMap = await this.workedShiftsByUser(tenantID, `${y}-${mm}-01`, `${y}-${mm}-${dd}`);
    const workedShiftsMonth = shiftsMap.get(userID) || 0;
    const monthEarned = monthService + monthProduct;
    const perDay = workedShiftsMonth > 0 ? Math.round(monthEarned / workedShiftsMonth) : null;

    return {
      today: todayService + todayProduct,
      week: weekService + weekProduct,
      month: monthService + monthProduct,
      total: totalService + totalProduct,
      // v3.0.1 ФИЧА 4 — своя «ЗП за день» + отработанные смены месяца (master-view).
      workedShiftsMonth,
      perDay,
      todayService,
      todayProduct,
      masterName: user.full_name,
      salaryPercent: parseFloat(user.salary_percent) || 0,
      productSalaryPercent: parseFloat(user.product_salary_percent) || 0,
      todayChecks: parseInt(prodAgg.today_checks) || 0,
      monthChecks: parseInt(prodAgg.month_checks) || 0,
      todayCash: (parseFloat(prodAgg.today_cash) || 0) + todayInstCash,
      todayCard: (parseFloat(prodAgg.today_card) || 0) + todayInstCard,
      todayWarranty: parseFloat(prodAgg.today_warranty) || 0,
      productPromotions,
      motivationToday: parseFloat(mot.today) || 0,
      motivationMonth: parseFloat(mot.month) || 0,
      motivationTotal: parseFloat(mot.total) || 0,
    };
  }

  // ─── Payouts with confirmation (100_salary_payouts_and_fines) ────────────
  //
  // A NEW, separate flow from the legacy salary_payments path (which writes the
  // expense immediately on create). Here the владелец (director/superadmin)
  // issues a payout → it sits `pending` → the employee accepts or rejects →
  // ONLY on accept is an expense recorded (dated the accept day). The legacy
  // createPayment / confirmPayment path is intentionally left untouched.

  /**
   * Owner (director/superadmin) issues a salary / advance payout to an
   * employee. Starts `pending` and pushes the employee to decide. No money
   * moves yet — the expense is written only when the employee accepts.
   */
  async createPayout(
    tenantID: string,
    createdBy: string,
    dto: { employeeId: string; type: 'salary' | 'advance'; amount: number; comment?: string },
  ) {
    if (!dto || !dto.employeeId) {
      throw new BadRequestException({ message: 'employeeId обязателен' });
    }
    const type = dto.type === 'advance' ? 'advance' : 'salary';
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({ message: 'Сумма выплаты должна быть положительной' });
    }

    // Tenant-isolation: the recipient must belong to the caller's tenant.
    const { rows: userRows } = await this.pool.query('SELECT full_name FROM users WHERE id=$1 AND tenant_id=$2', [
      dto.employeeId,
      tenantID,
    ]);
    if (userRows.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });

    const comment = dto.comment ? String(dto.comment).trim() || null : null;
    const { rows } = await this.pool.query(
      `INSERT INTO salary_payouts (tenant_id, employee_id, type, amount, status, comment, created_by)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING *`,
      [tenantID, dto.employeeId, type, amount, comment, createdBy],
    );
    const p = rows[0];
    p.user_name = userRows[0].full_name;

    // Push the employee to confirm receipt. Category 'salary' respects the
    // employee's «Уведомления» toggle. Fire-and-forget (push is never source
    // of truth).
    const title = type === 'advance' ? 'Аванс к выплате' : 'Зарплата к выплате';
    const formatted = amount.toLocaleString('ru-RU');
    this.push.sendToUserCategory(dto.employeeId, 'salary', title, `Сумма: ${formatted} ₽ — подтвердите получение`, {
      kind: 'payout',
      payoutId: p.id,
      payoutType: type,
      action: 'decide',
    });

    return this.mapPayout(p);
  }

  /**
   * The employee accepts or rejects a pending payout. Money path — fully
   * transactional and idempotent:
   *   - the row is locked FOR UPDATE and the flip only happens while it is
   *     still `pending` (a second accept can never double-record an expense);
   *   - on accept the «Зарплата» expense is inserted INSIDE the same
   *     transaction and linked back via expense_id, so status + expense commit
   *     atomically;
   *   - on reject nothing is recorded.
   * Only the recipient may decide (the role gate on the route is open; this
   * is the real authorization check).
   */
  async decidePayout(payoutId: string, tenantID: string, userID: string, decision: 'accept' | 'reject') {
    const client = await this.pool.connect();
    let result: any;
    let employeeName = 'Сотрудник';
    let ownerToNotify: string | null = null;
    try {
      await client.query('BEGIN');

      const { rows: lockRows } = await client.query(
        `SELECT p.*, u.full_name AS employee_name
           FROM salary_payouts p
           LEFT JOIN users u ON u.id = p.employee_id
          WHERE p.id = $1 AND p.tenant_id = $2
          FOR UPDATE`,
        [payoutId, tenantID],
      );
      if (lockRows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Выплата не найдена' });
      }
      const payout = lockRows[0];
      employeeName = payout.employee_name || employeeName;
      ownerToNotify = payout.created_by ?? null;

      // Authorization: only the recipient decides.
      if (payout.employee_id !== userID) {
        await client.query('ROLLBACK');
        throw new ForbiddenException({ message: 'Решение принимает только получатель выплаты' });
      }
      // Idempotency guard: only a pending payout can be decided.
      if (payout.status !== 'pending') {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Выплата уже обработана' });
      }

      if (decision === 'accept') {
        const typeLabel = payout.type === 'advance' ? 'Аванс' : 'Зарплата';
        const note = payout.comment ? ` — ${payout.comment}` : '';
        const description = `${typeLabel}: ${employeeName}${note}`;
        // Expense via ExpensesService, inside this transaction, dated now()
        // (the accept day). user_id / created_by → the владелец who issued.
        const expense = await this.expenses.recordSalaryExpense(
          tenantID,
          {
            amount: parseFloat(payout.amount) || 0,
            description,
            date: new Date().toISOString(),
            createdBy: payout.created_by ?? null,
          },
          client,
        );
        const { rows: upd } = await client.query(
          `UPDATE salary_payouts
              SET status = 'accepted', decided_at = now(), expense_id = $3
            WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
            RETURNING *`,
          [payoutId, tenantID, expense.id],
        );
        // Defensive: the FOR UPDATE lock already guarantees we are the only
        // writer, but re-checking the WHERE status='pending' rowcount makes the
        // double-record impossibility explicit.
        if (upd.length === 0) {
          await client.query('ROLLBACK');
          throw new BadRequestException({ message: 'Выплата уже обработана' });
        }
        result = upd[0];
      } else {
        const { rows: upd } = await client.query(
          `UPDATE salary_payouts
              SET status = 'rejected', decided_at = now()
            WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
            RETURNING *`,
          [payoutId, tenantID],
        );
        if (upd.length === 0) {
          await client.query('ROLLBACK');
          throw new BadRequestException({ message: 'Выплата уже обработана' });
        }
        result = upd[0];
      }

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw err;
    } finally {
      client.release();
    }

    // The UPDATE ... RETURNING row has no users join — carry the recipient name
    // captured from the locked SELECT so mapPayout populates userName.
    result.user_name = employeeName;

    // ── Post-commit side-effects (fire-and-forget) ──────────────────────────
    if (decision === 'accept') {
      // The new expense moves the cash position — drop the tenant's cached
      // report aggregates and nudge other devices to refetch money queries.
      invalidateReportsForTenant(tenantID);
      this.push.sendDataToTenant(tenantID, userID, { type: 'cash-changed', tenantId: tenantID }).catch(() => {
        /* best-effort */
      });
    }
    // Notify the владелец who issued the payout of the employee's decision.
    if (ownerToNotify) {
      const title = decision === 'accept' ? 'Выплата подтверждена' : 'Выплата отклонена';
      const verb = decision === 'accept' ? 'подтвердил(а) получение' : 'отклонил(а) выплату';
      const formatted = (parseFloat(result.amount) || 0).toLocaleString('ru-RU');
      this.push.sendToUserCategory(ownerToNotify, 'salary', title, `${employeeName} ${verb}: ${formatted} ₽`, {
        kind: 'payout',
        payoutId: result.id,
        status: result.status,
      });
    }

    return this.mapPayout(result);
  }

  /**
   * List payouts. Owner (director/superadmin) sees the whole tenant (optionally
   * filtered by employee / status / month); an employee is scoped to their own
   * by the controller. `monthYear` filters by the issue month (created_at).
   */
  async listPayouts(
    tenantID: string,
    query: { employeeId?: string; status?: 'pending' | 'accepted' | 'rejected'; monthYear?: string },
  ) {
    const conds: string[] = ['p.tenant_id = $1'];
    const params: any[] = [tenantID];
    let idx = 2;
    if (query.employeeId) {
      conds.push(`p.employee_id = $${idx++}`);
      params.push(query.employeeId);
    }
    if (query.status) {
      conds.push(`p.status = $${idx++}`);
      params.push(query.status);
    }
    if (query.monthYear) {
      conds.push(`to_char(p.created_at, 'YYYY-MM') = $${idx++}`);
      params.push(query.monthYear);
    }
    const { rows } = await this.pool.query(
      `SELECT p.*, u.full_name AS user_name, c.full_name AS creator_name
         FROM salary_payouts p
         LEFT JOIN users u ON u.id = p.employee_id
         LEFT JOIN users c ON c.id = p.created_by
        WHERE ${conds.join(' AND ')}
        ORDER BY p.created_at DESC`,
      params,
    );
    return rows.map((r) => this.mapPayout(r));
  }

  private mapPayout(r: any) {
    return {
      id: r.id,
      userId: r.employee_id,
      userName: r.user_name ?? undefined,
      type: r.type,
      amount: parseFloat(r.amount) || 0,
      status: r.status,
      comment: r.comment ?? undefined,
      createdBy: r.created_by ?? undefined,
      creatorName: r.creator_name ?? undefined,
      createdAt: r.created_at,
      decidedAt: r.decided_at ?? null,
      expenseId: r.expense_id ?? null,
    };
  }

  // ─── Per-employee monthly salary detail ──────────────────────────────────
  //
  // Powers the full-screen salary card that pages month-by-month. Returns one
  // employee's breakdown for one calendar month: earnings (service + product),
  // «Мотивация», premiums, fines (deducted), payouts (with statuses) and the
  // computed «к выплате». Mirrors getAll's component math (totalEarnings = base
  // + premiums + motivation; remaining subtracts fines) and additionally counts
  // accepted payouts (+ legacy salary_payments) as paid.

  async getEmployeeMonth(tenantID: string, employeeId: string, month?: string) {
    const monthYear = /^\d{4}-\d{2}$/.test(month ?? '')
      ? (month as string)
      : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const [yearStr, monStr] = monthYear.split('-');
    const year = parseInt(yearStr, 10);
    const mon = parseInt(monStr, 10); // 1-12
    // Half-open [monthStart, nextMonthStart) in UTC.
    const monthStart = new Date(Date.UTC(year, mon - 1, 1)).toISOString();
    const nextMonthStart = new Date(Date.UTC(year, mon, 1)).toISOString();

    const { rows: userRows } = await this.pool.query(
      `SELECT full_name, COALESCE(salary_percent, 0) AS salary_percent,
              COALESCE(product_salary_percent, 0) AS product_salary_percent
         FROM users WHERE id = $1 AND tenant_id = $2`,
      [employeeId, tenantID],
    );
    if (userRows.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });
    const user = userRows[0];

    // Product salary, revenue and check-count from this master's own (created)
    // non-deferred checks in the month — attribution unchanged.
    const { rows: earnRows } = await this.pool.query(
      `SELECT COALESCE(SUM(COALESCE(product_salary_total, 0)), 0) AS product_earnings,
              COALESCE(SUM(total_revenue), 0) AS total_revenue,
              COUNT(id) AS check_count
         FROM checks
        WHERE master_id = $1 AND tenant_id = $2 AND is_deferred = false
          AND deleted_at IS NULL
          AND date >= $3 AND date < $4`,
      [employeeId, tenantID, monthStart, nextMonthStart],
    );
    const e = earnRows[0];
    // #56: service salary this employee earned as the LINE executor (their own
    // service lines on ANY check in the month, not only checks they created).
    const { rows: svcEarnRows } = await this.pool.query(
      `SELECT COALESCE(SUM(COALESCE(sl.salary_amount, 0)), 0) AS service_earnings
         FROM checks ch
         JOIN check_service_lines sl ON sl.check_id = ch.id
        WHERE COALESCE(sl.master_id, ch.master_id) = $1 AND ch.tenant_id = $2 AND ch.is_deferred = false
          AND ch.deleted_at IS NULL
          AND ch.date >= $3 AND ch.date < $4`,
      [employeeId, tenantID, monthStart, nextMonthStart],
    );
    const serviceEarnings = parseFloat(svcEarnRows[0].service_earnings) || 0;
    const productEarnings = parseFloat(e.product_earnings) || 0;

    // «Мотивация» (095): promo-product bonus accrued in the month.
    const { rows: motRows } = await this.pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS amount
         FROM motivation_accruals
        WHERE tenant_id = $1 AND employee_id = $2
          AND accrued_at >= $3 AND accrued_at < $4`,
      [tenantID, employeeId, monthStart, nextMonthStart],
    );
    const motivationAmount = parseFloat(motRows[0].amount) || 0;

    // Premiums awarded in the month (cash premiums add to earnings).
    const { rows: premRows } = await this.pool.query(
      `SELECT sp.*, u.full_name AS user_name, a.full_name AS awarder_name
         FROM salary_premiums sp
         LEFT JOIN users u ON u.id = sp.user_id
         LEFT JOIN users a ON a.id = sp.awarded_by
        WHERE sp.tenant_id = $1 AND sp.user_id = $2
          AND sp.created_at >= $3 AND sp.created_at < $4
        ORDER BY sp.created_at DESC`,
      [tenantID, employeeId, monthStart, nextMonthStart],
    );
    const premiums = premRows.map((r) => this.mapPremium(r));
    const premiumsAmount = premiums.reduce((sum, p) => sum + (p.type === 'cash' ? p.amount || 0 : 0), 0);

    // Fines (штрафы, 056) applied in the month — deducted from «к выплате».
    const { rows: fineRows } = await this.pool.query(
      `SELECT pen.*, u.full_name AS user_name, c.full_name AS creator_name
         FROM salary_penalties pen
         LEFT JOIN users u ON u.id = pen.user_id
         LEFT JOIN users c ON c.id = pen.created_by
        WHERE pen.tenant_id = $1 AND pen.user_id = $2
          AND pen.date >= $3 AND pen.date < $4
        ORDER BY pen.date DESC`,
      [tenantID, employeeId, monthStart, nextMonthStart],
    );
    const fines = fineRows.map((r) => this.mapPenalty(r));
    const finesAmount = fines.reduce((sum, f) => sum + (f.amount || 0), 0);

    // Payouts issued in the month (any status). Accepted ones count as paid.
    const { rows: payoutRows } = await this.pool.query(
      `SELECT p.*, u.full_name AS user_name, c.full_name AS creator_name
         FROM salary_payouts p
         LEFT JOIN users u ON u.id = p.employee_id
         LEFT JOIN users c ON c.id = p.created_by
        WHERE p.tenant_id = $1 AND p.employee_id = $2
          AND p.created_at >= $3 AND p.created_at < $4
        ORDER BY p.created_at DESC`,
      [tenantID, employeeId, monthStart, nextMonthStart],
    );
    const payouts = payoutRows.map((r) => this.mapPayout(r));
    const acceptedPayoutsAmount = payouts.reduce((sum, p) => sum + (p.status === 'accepted' ? p.amount || 0 : 0), 0);

    // Legacy salary_payments for the month (old immediate-expense flow) — also
    // money paid; included so the card never hides a recorded payment.
    const { rows: paymentRows } = await this.pool.query(
      `SELECT sp.*, u.full_name AS user_name, c.full_name AS creator_name
         FROM salary_payments sp
         LEFT JOIN users u ON u.id = sp.user_id
         LEFT JOIN users c ON c.id = sp.created_by
        WHERE sp.tenant_id = $1 AND sp.user_id = $2 AND sp.month_year = $3
        ORDER BY sp.date DESC`,
      [tenantID, employeeId, monthYear],
    );
    const payments = paymentRows.map((p) => ({
      id: p.id,
      userId: p.user_id,
      userName: p.user_name,
      amount: parseFloat(p.amount) || 0,
      monthYear: p.month_year,
      type: p.type,
      comment: p.comment,
      createdBy: p.created_by,
      creatorName: p.creator_name,
      date: p.date,
      createdAt: p.created_at,
    }));
    const legacyPaidAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const totalEarnings = serviceEarnings + productEarnings + premiumsAmount + motivationAmount;
    const paidAmount = acceptedPayoutsAmount + legacyPaidAmount;

    return {
      userId: employeeId,
      userName: user.full_name,
      month: monthYear,
      salaryPercent: parseFloat(user.salary_percent) || 0,
      productSalaryPercent: parseFloat(user.product_salary_percent) || 0,
      serviceEarnings,
      productEarnings,
      premiumsAmount,
      motivationAmount,
      totalEarnings,
      finesAmount,
      paidAmount,
      // What the shop still owes for the month after fines and what's paid.
      remainingAmount: totalEarnings - finesAmount - paidAmount,
      totalRevenue: parseFloat(e.total_revenue) || 0,
      checkCount: parseInt(e.check_count, 10) || 0,
      payouts,
      fines,
      premiums,
      payments,
    };
  }
}
