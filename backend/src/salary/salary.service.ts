import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { PushService } from '../push/push.service';

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
  ) {}

  async getAll(tenantID: string, query: any) {
    const dateFrom =
      query.dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const dateTo = query.dateTo || new Date().toISOString().split('T')[0];

    const { rows } = await this.pool.query(
      `SELECT u.id as master_id, u.full_name as master_name,
              COALESCE(u.salary_percent, 0) as salary_percent,
              COALESCE(u.product_salary_percent, 0) as product_salary_percent,
              COALESCE(SUM(ch.service_salary_total), 0) as service_earnings,
              COALESCE(SUM(COALESCE(ch.product_salary_total, 0)), 0) as product_earnings,
              COALESCE(SUM(ch.service_salary_total) + SUM(COALESCE(ch.product_salary_total, 0)), 0) as total_earnings,
              COALESCE(SUM(ch.total_revenue), 0) as total_revenue,
              COUNT(ch.id) as check_count
       FROM users u
       LEFT JOIN checks ch ON ch.master_id = u.id
         AND ch.tenant_id = u.tenant_id
         AND ch.date >= $2 AND ch.date <= ($3::date + 1)::timestamptz
         AND ch.is_deferred = false
       WHERE u.tenant_id = $1 AND u.role IN ('master', 'admin')
       GROUP BY u.id, u.full_name, u.salary_percent, u.product_salary_percent
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
      [tenantID, dto.userId, amount, dto.description ?? null, dto.date ?? null, createdBy],
    );
    const p = rows[0];
    p.user_name = userRows[0].full_name;

    // Notify the employee so a penalty is never silent.
    const formatted = amount.toLocaleString('ru-RU');
    this.push.sendToUserCategory(
      dto.userId,
      'penalty',
      'Штраф наложен',
      dto.description ? `${formatted} ₽ — ${dto.description}` : `Сумма: ${formatted} ₽`,
      { kind: 'penalty', penaltyId: p.id },
    );

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

    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= $2 THEN service_salary_total + COALESCE(product_salary_total, 0) END), 0) as today,
         COALESCE(SUM(CASE WHEN date >= $3 THEN service_salary_total + COALESCE(product_salary_total, 0) END), 0) as week,
         COALESCE(SUM(CASE WHEN date >= $4 THEN service_salary_total + COALESCE(product_salary_total, 0) END), 0) as month,
         COALESCE(SUM(service_salary_total + COALESCE(product_salary_total, 0)), 0) as total,
         COALESCE(SUM(CASE WHEN date >= $2 THEN service_salary_total END), 0) as today_service,
         COALESCE(SUM(CASE WHEN date >= $2 THEN COALESCE(product_salary_total, 0) END), 0) as today_product,
         COUNT(CASE WHEN date >= $2 THEN 1 END) as today_checks,
         COUNT(CASE WHEN date >= $4 THEN 1 END) as month_checks,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method IN ('cash','cash_card') THEN cash_amount END), 0) as today_cash,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method IN ('card','cash_card') THEN card_amount END), 0) as today_card,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method = 'warranty' THEN total_revenue END), 0) as today_warranty
       FROM checks
       WHERE master_id = $1 AND is_deferred = false AND tenant_id = $5`,
      [userID, todayStart, weekStart, monthStart, tenantID],
    );

    const r = rows[0];

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

    return {
      today: parseFloat(r.today) || 0,
      week: parseFloat(r.week) || 0,
      month: parseFloat(r.month) || 0,
      total: parseFloat(r.total) || 0,
      todayService: parseFloat(r.today_service) || 0,
      todayProduct: parseFloat(r.today_product) || 0,
      masterName: user.full_name,
      salaryPercent: parseFloat(user.salary_percent) || 0,
      productSalaryPercent: parseFloat(user.product_salary_percent) || 0,
      todayChecks: parseInt(r.today_checks) || 0,
      monthChecks: parseInt(r.month_checks) || 0,
      todayCash: parseFloat(r.today_cash) || 0,
      todayCard: parseFloat(r.today_card) || 0,
      todayWarranty: parseFloat(r.today_warranty) || 0,
      productPromotions,
      motivationToday: parseFloat(mot.today) || 0,
      motivationMonth: parseFloat(mot.month) || 0,
      motivationTotal: parseFloat(mot.total) || 0,
    };
  }
}
