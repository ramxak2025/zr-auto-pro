import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { ttlCache } from '../common/ttl-cache';
import { userHasPermission } from '../common/guards/permissions.guard';
import { CallsService } from '../calls/calls.service';

/** Актор запроса «Движения денег» — источник охвата (свои / все) и атрибуции. */
interface CashFlowActor {
  userID: string;
  tenantID: string;
  role?: string;
  permissions?: Record<string, boolean>;
}

/**
 * One bucket in a marketing time-series (weekly or monthly). `periodStart` is the
 * ISO date (YYYY-MM-DD) of the bucket's first day. Every metric is derived from
 * real rows inside that bucket (see marketingTrends); a bucket with no activity
 * is still emitted with zeros so the client can draw a continuous chart.
 */
export interface MarketingTrendPoint {
  periodStart: string;
  newClients: number;
  revenue: number;
  returningRate: number;
  calls: number;
  reviews: number;
}

// Matches a calendar date `YYYY-MM-DD`. Anything else (locale-formatted,
// empty, ISO-with-time, garbage) is rejected so it never reaches a raw
// `$n::date` cast in SQL — an invalid cast surfaces as a deterministic 500
// that no client retry can recover from.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Бизнес-таймзона продукта (UTC+3). Сервер и Postgres живут в UTC, но владелец
// считает кассу по МОСКОВСКОМУ календарному дню: чек, пробитый 00:00–03:00 МСК,
// обязан попадать в «сегодня», а не во «вчера». Все дневные группировки и границы
// периодов в отчётах режутся полуинтервалом [from 00:00 МСК, to+1 00:00 МСК) —
// синхронно с checks.service.ts / schedule.service.ts (AT TIME ZONE 'Europe/Moscow').
const BUSINESS_TZ = 'Europe/Moscow';

@Injectable()
export class ReportsService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private callsService: CallsService,
  ) {}

  /**
   * Normalise a caller-supplied date param to a safe `YYYY-MM-DD` string.
   * A well-formed value is also range-checked (Postgres would reject e.g.
   * `2026-13-40`); anything invalid falls back to `fallback` so the query
   * can never 500 on a bad `::date` cast. Behaviour for valid input is
   * unchanged — every previously-200 request stays 200 with the same shape.
   */
  private safeDate(value: unknown, fallback: string): string {
    if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return fallback;
    const ts = Date.parse(`${value}T00:00:00Z`);
    if (Number.isNaN(ts)) return fallback;
    // Reject overflow dates that match the regex but aren't real (e.g. 02-30).
    if (new Date(ts).toISOString().slice(0, 10) !== value) return fallback;
    return value;
  }

  private firstOfMonth(): string {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split('T')[0];
  }

  private todayISO(): string {
    return new Date().toISOString().split('T')[0];
  }

  async getFinancial(tenantID: string, query: any) {
    const dateFrom = this.safeDate(query?.dateFrom, this.firstOfMonth());
    const dateTo = this.safeDate(query?.dateTo, this.todayISO());

    // ITEM 2 — «по гарантии» = убыток, не выручка. Гарантийные чеки
    // (payment_method='warranty') ИСКЛЮЧАЮТСЯ из revenue / productCost /
    // salaries (FILTER … IS DISTINCT FROM 'warranty' — NULL считается
    // не-гарантией), а вместо них учитывается ОТДЕЛЬНЫЙ убыток warrantyLoss =
    // Σ(product_cost_total + service_salary_total + product_salary_total) по
    // гарантийным чекам (закупка запчастей + выплата мастеру за работу + товарная
    // комиссия мастера: salary.service начисляет product_salary_total и по
    // гарантии, поэтому без него netProfit был бы завышен — money-audit C2).
    // netProfit уменьшается ровно на этот убыток. Чистый вклад гарантийного
    // чека в netProfit = −(запчасти+зарплата), выручка = 0. Полностью derived
    // из колонок checks — ничего не материализуем, двойного счёта с
    // «Расходами» нет (см. expenses).
    // Границы периода — московский полуинтервал [from, to+1) (BUSINESS_TZ).
    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(total_revenue) FILTER (WHERE payment_method IS DISTINCT FROM 'warranty'), 0) as revenue,
         COALESCE(SUM(product_cost_total) FILTER (WHERE payment_method IS DISTINCT FROM 'warranty'), 0) as product_cost,
         COALESCE(SUM(service_salary_total + COALESCE(product_salary_total, 0)) FILTER (WHERE payment_method IS DISTINCT FROM 'warranty'), 0) as salaries,
         COALESCE(SUM(product_cost_total + service_salary_total + COALESCE(product_salary_total, 0)) FILTER (WHERE payment_method = 'warranty'), 0) as warranty_loss,
         COUNT(*) as check_count
       FROM checks
       WHERE tenant_id = $1
         AND date >= $2::date::timestamp AT TIME ZONE '${BUSINESS_TZ}'
         AND date < ($3::date + 1)::timestamp AT TIME ZONE '${BUSINESS_TZ}'
         AND is_deferred = false
         AND deleted_at IS NULL`,
      [tenantID, dateFrom, dateTo],
    );

    const r = rows[0];
    const revenue = parseFloat(r.revenue) || 0;
    const productCost = parseFloat(r.product_cost) || 0;
    const salaries = parseFloat(r.salaries) || 0;
    const warrantyLoss = parseFloat(r.warranty_loss) || 0;
    const grossProfit = revenue - productCost;

    // Get director expenses for the same period. Two corrections vs. naïve
    // SUM(amount): (1) net profit must NOT double-count labour — the per-check
    // salary accrual is already in `salaries` above, and salary PAYOUTS are
    // mirrored into `expenses` under the 'Зарплата' category by
    // salary.createPayment, so we exclude that category here; (2) only
    // APPROVED expenses count — pending / rejected must never reduce profit.
    // Legacy rows have NULL approval_status → treated as approved.
    const { rows: expRows } = await this.pool.query(
      `SELECT COALESCE(SUM(e.amount), 0) as total
         FROM expenses e
         LEFT JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.tenant_id = $1
          AND e.date >= $2::date::timestamp AT TIME ZONE '${BUSINESS_TZ}'
          AND e.date < ($3::date + 1)::timestamp AT TIME ZONE '${BUSINESS_TZ}'
          AND COALESCE(e.approval_status, 'approved') = 'approved'
          AND COALESCE(ec.name, '') <> 'Зарплата'`,
      [tenantID, dateFrom, dateTo],
    );
    const otherExpenses = parseFloat(expRows[0]?.total) || 0;

    // Гарантия вычитается ОТДЕЛЬНЫМ термом (warrantyLoss). productCost/salaries
    // выше уже НЕ содержат гарантийных чеков (FILTER), поэтому двойного вычета
    // запчастей/зарплаты нет.
    const netProfit = grossProfit - salaries - otherExpenses - warrantyLoss;

    return {
      dateFrom,
      dateTo,
      revenue,
      productCost,
      salaries,
      otherExpenses,
      // ITEM 2 — убыток по гарантийным чекам за период (запчасти + выплата
      // мастеру). Уже вычтен из netProfit; отдаётся отдельно, чтобы UI мог
      // показать «Гарантия (убыток)» строкой. 0 если гарантийных чеков не было.
      warrantyLoss,
      grossProfit,
      netProfit,
      checkCount: parseInt(r.check_count) || 0,
    };
  }

  /**
   * Aggregate stock_movements rows for the period and return totals for
   * defect transfers (main → defect), writeoffs (with / without expense
   * booking), and supplier returns. Powers the report screen for owners.
   *
   * "Value" columns use `qty * cost_price` from the linked product so we
   * don't have to materialise per-movement amounts in stock_movements.
   * If a product is later soft-deleted the row stays (product table is
   * kept around, only marked deleted_at), so the join still resolves.
   */
  async getDefectWriteoffReport(tenantID: string, query: { from?: string; to?: string }) {
    const dateFrom = this.safeDate(query?.from, this.firstOfMonth());
    const dateTo = this.safeDate(query?.to, this.todayISO());

    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN sm.type = 'defect_transfer' THEN sm.quantity ELSE 0 END), 0) as defect_qty,
         COALESCE(SUM(CASE WHEN sm.type = 'defect_transfer' THEN sm.quantity * p.cost_price ELSE 0 END), 0) as defect_value,
         COALESCE(SUM(CASE WHEN sm.type = 'writeoff' THEN sm.quantity ELSE 0 END), 0) as writeoff_qty,
         COALESCE(SUM(CASE WHEN sm.type = 'writeoff' THEN sm.quantity * p.cost_price ELSE 0 END), 0) as writeoff_value,
         COALESCE(SUM(CASE WHEN sm.type = 'writeoff' AND sm.record_as_expense = true THEN sm.quantity ELSE 0 END), 0) as writeoff_expensed_qty,
         COALESCE(SUM(CASE WHEN sm.type = 'writeoff' AND sm.record_as_expense = true THEN sm.quantity * p.cost_price ELSE 0 END), 0) as writeoff_expensed_value,
         COALESCE(SUM(CASE WHEN sm.type = 'defect_return_to_supplier' THEN sm.quantity ELSE 0 END), 0) as returned_qty,
         COALESCE(SUM(CASE WHEN sm.type = 'defect_return_to_supplier' THEN sm.quantity * p.cost_price ELSE 0 END), 0) as returned_value
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       WHERE sm.tenant_id = $1
         AND sm.created_at >= $2::date::timestamp AT TIME ZONE '${BUSINESS_TZ}'
         AND sm.created_at < ($3::date + 1)::timestamp AT TIME ZONE '${BUSINESS_TZ}'
         AND sm.type IN ('defect_transfer','writeoff','defect_return_to_supplier')`,
      [tenantID, dateFrom, dateTo],
    );

    const r = rows[0];
    return {
      dateFrom,
      dateTo,
      defectQty: parseFloat(r.defect_qty) || 0,
      defectValue: parseFloat(r.defect_value) || 0,
      writeoffQty: parseFloat(r.writeoff_qty) || 0,
      writeoffValue: parseFloat(r.writeoff_value) || 0,
      writeoffExpensedQty: parseFloat(r.writeoff_expensed_qty) || 0,
      writeoffExpensedValue: parseFloat(r.writeoff_expensed_value) || 0,
      returnedToSupplierQty: parseFloat(r.returned_qty) || 0,
      returnedToSupplierValue: parseFloat(r.returned_value) || 0,
    };
  }

  /**
   * Call funnel report: cross-reference sms_history (which logs inbound/outbound
   * SMS contacts stored persistently in DB) with checks to build a conversion
   * funnel. The external "calls" log (from Moi Zvonki API) is not persisted to
   * DB, so we use sms_history as the tenant contact proxy.
   *
   * For tenants without any SMS integration the query returns zeros — not an
   * error, just an empty funnel.
   */
  async getCallFunnel(tenantID: string, query: { dateFrom?: string; dateTo?: string }) {
    const dateFrom = this.safeDate(query?.dateFrom, this.firstOfMonth());
    const dateTo = this.safeDate(query?.dateTo, this.todayISO());

    // Contact stats from sms_history
    const { rows: contactRows } = await this.pool.query(
      `SELECT
         COUNT(*) AS total_contacts,
         COUNT(DISTINCT phone) AS unique_callers
       FROM sms_history
       WHERE tenant_id = $1
         AND created_at::date BETWEEN $2::date AND $3::date`,
      [tenantID, dateFrom, dateTo],
    );

    // Checks created for clients who appear in sms_history during the same period
    const { rows: checkRows } = await this.pool.query(
      `SELECT
         COUNT(DISTINCT ch.client_id) AS arrived_clients,
         COUNT(DISTINCT ch.id) AS created_checks,
         COALESCE(SUM(ch.total_revenue), 0) AS total_revenue
       FROM checks ch
       JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = $1
       WHERE ch.tenant_id = $1
         AND ch.is_deferred = false
         AND ch.deleted_at IS NULL
         AND ch.date::date BETWEEN $2::date AND $3::date
         AND cl.phone IN (
           SELECT DISTINCT phone FROM sms_history
           WHERE tenant_id = $1
             AND created_at::date BETWEEN $2::date AND $3::date
         )`,
      [tenantID, dateFrom, dateTo],
    );

    // Repeat clients (clients with more than 1 check total for this tenant)
    const { rows: repeatRows } = await this.pool.query(
      `SELECT COUNT(DISTINCT client_id) AS repeat_clients
       FROM (
         SELECT client_id, COUNT(*) AS check_count
         FROM checks
         WHERE tenant_id = $1 AND is_deferred = false AND client_id IS NOT NULL
           AND deleted_at IS NULL
         GROUP BY client_id
         HAVING COUNT(*) > 1
       ) sub`,
      [tenantID],
    );

    const c = contactRows[0];
    const r = checkRows[0];
    const rp = repeatRows[0];

    const totalCalls = parseInt(c.total_contacts) || 0;
    const uniqueCallers = parseInt(c.unique_callers) || 0;
    const arrivedClients = parseInt(r.arrived_clients) || 0;
    const createdChecks = parseInt(r.created_checks) || 0;
    const totalRevenue = parseFloat(r.total_revenue) || 0;
    const avgCheckValue = createdChecks > 0 ? totalRevenue / createdChecks : 0;
    const repeatClients = parseInt(rp.repeat_clients) || 0;
    const conversionRate = uniqueCallers > 0 ? (arrivedClients / uniqueCallers) * 100 : 0;

    return {
      totalCalls,
      uniqueCallers,
      arrivedClients,
      createdChecks,
      totalRevenue,
      avgCheckValue,
      repeatClients,
      conversionRate: Math.round(conversionRate * 10) / 10,
      period: { from: dateFrom, to: dateTo },
    };
  }

  async getCashFlow(actor: CashFlowActor, query: any) {
    const tenantID = actor.tenantID;
    const dateFrom = this.safeDate(query?.dateFrom, this.firstOfMonth());
    const dateTo = this.safeDate(query?.dateTo, this.todayISO());

    // ITEM 6 — охват «Движение денег»: свои vs все.
    //   • cashflow_view_all (охват 'all', либо owner-class director/admin/superadmin
    //     по строковой роли) → видит ВСЁ; клиентский masterId уважается как фильтр
    //     (владелец может посмотреть конкретного мастера — прежнее поведение).
    //   • только cashflow_view (охват 'own') → видит ТОЛЬКО свои операции:
    //     принудительно masterId = свой userID, клиентский masterId игнорируется
    //     (мастер не может подсмотреть чужую кассу, подставив чужой id).
    // Сам факт доступа к эндпоинту гарантирует @RequirePermission('cashflow_view')
    // в контроллере; здесь решается лишь широта охвата.
    const canViewAll = userHasPermission(actor, 'cashflow_view_all');
    // masterId reaches a raw `master_id = $n` (uuid) comparison; a non-uuid
    // value triggers "invalid input syntax for type uuid" → 500. Ignore an
    // invalid filter rather than blow up (an invalid master = no such master,
    // so dropping the filter would over-report — instead force an empty set).
    const rawMaster = canViewAll ? query?.masterId : actor.userID;
    const masterId = typeof rawMaster === 'string' && UUID_RE.test(rawMaster) ? rawMaster : null;
    const masterInvalid = !!rawMaster && masterId === null;
    if (masterInvalid) {
      return {
        days: [],
        totals: {
          cash: 0,
          card: 0,
          warranty: 0,
          warrantyLoss: 0,
          total: 0,
          installmentDebt: 0,
          installmentPaid: 0,
          installmentPaidCash: 0,
          installmentPaidCard: 0,
          received: 0,
          refunds: 0,
        },
      };
    }

    const params: any[] = [tenantID, dateFrom, dateTo];
    let masterFilter = '';
    let refundMasterFilter = '';
    if (masterId) {
      params.push(masterId);
      const mIdx = params.length;
      if (canViewAll) {
        // Явный фильтр владельца «по сотруднику» — по главному мастеру чека,
        // тем же предикатом, что journal-фильтр ?masterId (checks.getAll).
        masterFilter = ` AND master_id = $${mIdx}`;
        refundMasterFilter = ` AND ch.master_id = $${mIdx}`;
      } else {
        // Охват 'own' (мастер видит только свою кассу): предикат тот же, что у
        // ЕГО журнала (checks.getAll для restricted-мастера) — главный мастер
        // ИЛИ исполнитель строки. Иначе раскрытый список дня (журнальное
        // правило) был шире суммы дня и цифры не сходились (cashflow M3).
        masterFilter = ` AND (master_id = $${mIdx} OR EXISTS (
          SELECT 1 FROM check_service_lines sl
           WHERE sl.check_id = checks.id AND sl.master_id = $${mIdx}
        ))`;
        refundMasterFilter = ` AND (ch.master_id = $${mIdx} OR EXISTS (
          SELECT 1 FROM check_service_lines sl
           WHERE sl.check_id = ch.id AND sl.master_id = $${mIdx}
        ))`;
      }
    }

    // ITEM 2 — гарантия ИСКЛЮЧЕНА из оборота (total): работа по гарантии денег
    // в кассу не приносит. total теперь = нал + карта + долг по рассрочке
    // (гарантийные чеки имеют cash=card=0 и в total НЕ входят). Новое тождество:
    // cash + card + installmentDebt (+ unallocated) = total.
    //   • warranty (справочно, для совместимости) — «отпускная» стоимость
    //     гарантийных работ = Σ total_revenue по гарантии (сколько было бы
    //     выручки, если бы не гарантия). НЕ входит в total.
    //   • warrantyLoss — реальный УБЫТОК по гарантии = Σ(product_cost_total
    //     + service_salary_total + product_salary_total): запчасти + выплата
    //     мастеру за работу + его товарная комиссия (money-audit C2 — она
    //     начисляется и по гарантии). Показывается как затрата в «Движении
    //     денег». Derived из checks, в таблицу расходов не пишется → двойного
    //     счёта нет.
    // Волна G (решение владельца 2026-07): «Движение денег» возвращено к
    // ПРОСТОМУ виду — нал/карта/погашения рассрочки/возвраты/Итого. Поля
    // unallocated («Не разнесено»), supplierPayments/expensesOut (оттоки) и
    // netCash («Осталось в кассе») УБРАНЫ из ответа: закупки у поставщиков
    // теперь показываются в разделе «Расходы» отдельной секцией, а не тут.
    // День = МОСКОВСКИЙ календарный день (BUSINESS_TZ), границы — полуинтервал
    // [from 00:00 МСК, to+1 00:00 МСК): ночные чеки 00:00–03:00 МСК больше не
    // падают во «вчера», а чек, датированный dateTo+1 (веб пишет голую дату =
    // ровно полночь), в период НЕ попадает. День отдаётся строкой 'YYYY-MM-DD'
    // (to_char), чтобы pg-драйвер не превращал DATE в JS Date с TZ-сдвигом.
    const { rows } = await this.pool.query(
      `SELECT to_char((date AT TIME ZONE '${BUSINESS_TZ}')::date, 'YYYY-MM-DD') as day,
              COALESCE(SUM(cash_amount), 0) as cash,
              COALESCE(SUM(card_amount), 0) as card,
              COALESCE(SUM(CASE WHEN payment_method = 'warranty' THEN total_revenue ELSE 0 END), 0) as warranty,
              COALESCE(SUM(CASE WHEN payment_method = 'warranty' THEN product_cost_total + service_salary_total + COALESCE(product_salary_total, 0) ELSE 0 END), 0) as warranty_loss,
              COALESCE(SUM(CASE WHEN payment_method = 'installment' THEN GREATEST(total_revenue - cash_amount - card_amount, 0) ELSE 0 END), 0) as installment_debt,
              COALESCE(SUM(CASE WHEN payment_method IS DISTINCT FROM 'warranty' THEN total_revenue ELSE 0 END), 0) as total
       FROM checks
       WHERE tenant_id = $1
         AND date >= $2::date::timestamp AT TIME ZONE '${BUSINESS_TZ}'
         AND date < ($3::date + 1)::timestamp AT TIME ZONE '${BUSINESS_TZ}'
         AND is_deferred = false
         AND deleted_at IS NULL${masterFilter}
       GROUP BY 1
       ORDER BY 1`,
      params,
    );

    // Погашения рассрочки за период — по ДАТЕ ПЛАТЕЖА (installment_payments,
    // 093). Информационное поле: это деньги за ПРОШЛЫЕ продажи, в оборот
    // (total, по начислению) они НЕ входят. Фильтр по мастеру — через чек,
    // из которого родился план (check_id может быть NULL после удаления чека —
    // такие платежи при фильтре по мастеру не атрибутируются никому).
    // ch.deleted_at IS NULL — симметрия с корзиной installmentDebt (основная
    // выборка выше считает только неудалённые чеки): погашение не должно
    // атрибутироваться мастеру, если долга-источника в этом же отчёте нет.
    // На практике чек с планом в корзину не попадает (softDelete отказывает),
    // так что это страховка на будущее, а не изменение цифр.
    let paidMasterFilter = '';
    if (masterId) {
      // masterId уже лежит в params под тем же индексом, что и в masterFilter.
      // Атрибуция — по ПРИНЯВШЕМУ платёж (p.created_by, 093), а не по мастеру
      // исходного чека: деньги на руках у того, кто их принял. Для старых
      // строк без created_by — fallback на мастера чека (LEFT JOIN: чек
      // удалён/отвязан → ch.master_id IS NULL → платёж не атрибутируется
      // никому, симметрия с корзиной installmentDebt выше).
      paidMasterFilter = ` AND COALESCE(p.created_by, ch.master_id) = $${params.length}`;
    }
    // Разбивка по payment_method (119): 'card' → paid_card, остальное →
    // paid_cash (строки до миграции считаются налом — решение владельца).
    // paid = paid_cash + paid_card — поле остаётся суммой для совместимости.
    const { rows: paidRows } = await this.pool.query(
      `SELECT to_char((p.paid_at AT TIME ZONE '${BUSINESS_TZ}')::date, 'YYYY-MM-DD') as day,
              COALESCE(SUM(p.amount), 0) as paid,
              COALESCE(SUM(CASE WHEN p.payment_method = 'card' THEN p.amount ELSE 0 END), 0) as paid_card,
              COALESCE(SUM(CASE WHEN COALESCE(p.payment_method, 'cash') <> 'card' THEN p.amount ELSE 0 END), 0) as paid_cash
       FROM installment_payments p
       JOIN installment_plans pl ON pl.id = p.plan_id AND pl.tenant_id = $1
       ${masterId ? 'LEFT JOIN checks ch ON ch.id = pl.check_id AND ch.deleted_at IS NULL' : ''}
       WHERE p.tenant_id = $1
         AND p.paid_at >= $2::date::timestamp AT TIME ZONE '${BUSINESS_TZ}'
         AND p.paid_at < ($3::date + 1)::timestamp AT TIME ZONE '${BUSINESS_TZ}'${paidMasterFilter}
       GROUP BY 1
       ORDER BY 1`,
      params,
    );

    // Возвраты по ДАТЕ ФАКТИЧЕСКОГО ВОЗВРАТА (check_returns.created_at, cashflow
    // M2). Политика владельца (2026-06) «возврат гасит продажу в её периоде»
    // сохранена — деньги уже вычтены из дня ПРОДАЖИ реверсом ног в
    // returns.service. refunds — ИНФОРМАЦИОННАЯ строка дня возврата («в этот
    // день выдали клиентам N ₽»), в total НЕ входит и из cash/card дня возврата
    // НЕ вычитается (иначе был бы двойной минус). netCash её тоже НЕ вычитает
    // повторно: received уже уменьшен на возврат в дне ПРОДАЖИ. JOIN checks —
    // для симметрии с основной выборкой (deleted_at IS NULL) и фильтра по мастеру.
    const { rows: refundRows } = await this.pool.query(
      `SELECT to_char((cr.created_at AT TIME ZONE '${BUSINESS_TZ}')::date, 'YYYY-MM-DD') as day,
              COALESCE(SUM(cr.refund_amount), 0) as refunds
       FROM check_returns cr
       JOIN checks ch ON ch.id = cr.check_id AND ch.tenant_id = $1 AND ch.deleted_at IS NULL
       WHERE cr.tenant_id = $1
         AND cr.created_at >= $2::date::timestamp AT TIME ZONE '${BUSINESS_TZ}'
         AND cr.created_at < ($3::date + 1)::timestamp AT TIME ZONE '${BUSINESS_TZ}'${refundMasterFilter}
       GROUP BY 1
       ORDER BY 1`,
      params,
    );

    const dayKey = (d: any): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

    const days = rows.map((r) => ({
      date: r.day,
      cash: parseFloat(r.cash) || 0,
      card: parseFloat(r.card) || 0,
      warranty: parseFloat(r.warranty) || 0,
      warrantyLoss: parseFloat(r.warranty_loss) || 0,
      installmentDebt: parseFloat(r.installment_debt) || 0,
      installmentPaid: 0,
      installmentPaidCash: 0,
      installmentPaidCard: 0,
      total: parseFloat(r.total) || 0,
      refunds: 0,
      // «Касса за день» — реально принятые деньги (нал+карта+погашения
      // рассрочки), считается после вливания погашений ниже.
      received: 0,
    }));

    // Вливаем погашения и возвраты в дни: совпавший день дополняем, день без
    // чеков (было только погашение / только возврат) добавляем нулевой строкой,
    // затем восстанавливаем хронологию.
    const emptyDay = (date: any) => ({
      date,
      cash: 0,
      card: 0,
      warranty: 0,
      warrantyLoss: 0,
      installmentDebt: 0,
      installmentPaid: 0,
      installmentPaidCash: 0,
      installmentPaidCard: 0,
      total: 0,
      refunds: 0,
      received: 0,
    });

    const byKey = new Map(days.map((d) => [dayKey(d.date), d]));
    for (const r of paidRows) {
      const key = dayKey(r.day);
      let existing = byKey.get(key);
      if (!existing) {
        existing = emptyDay(r.day);
        byKey.set(key, existing);
        days.push(existing);
      }
      existing.installmentPaid += parseFloat(r.paid) || 0;
      existing.installmentPaidCash += parseFloat(r.paid_cash) || 0;
      existing.installmentPaidCard += parseFloat(r.paid_card) || 0;
    }
    for (const r of refundRows) {
      const key = dayKey(r.day);
      let existing = byKey.get(key);
      if (!existing) {
        existing = emptyDay(r.day);
        byKey.set(key, existing);
        days.push(existing);
      }
      existing.refunds += parseFloat(r.refunds) || 0;
    }
    for (const d of days) {
      d.received = d.cash + d.card + d.installmentPaid;
    }
    days.sort((a, b) => dayKey(a.date).localeCompare(dayKey(b.date)));

    const totals = {
      cash: 0,
      card: 0,
      warranty: 0,
      warrantyLoss: 0,
      total: 0,
      installmentDebt: 0,
      installmentPaid: 0,
      installmentPaidCash: 0,
      installmentPaidCard: 0,
      received: 0,
      refunds: 0,
    };
    for (const d of days) {
      totals.cash += d.cash;
      totals.card += d.card;
      totals.warranty += d.warranty;
      totals.warrantyLoss += d.warrantyLoss;
      totals.installmentDebt += d.installmentDebt;
      totals.installmentPaid += d.installmentPaid;
      totals.installmentPaidCash += d.installmentPaidCash;
      totals.installmentPaidCard += d.installmentPaidCard;
      totals.total += d.total;
      totals.received += d.received;
      totals.refunds += d.refunds;
    }

    return { days, totals };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Owner dashboard v2 — richer aggregates (net profit, cash position,
  //  margin, deferred sum, personal records, month forecast).
  //  Cached 30s per tenant.
  // ──────────────────────────────────────────────────────────────────────

  async dashboardV2(tenantID: string, period: 'today' | 'week' | 'month' | 'year' = 'month') {
    return ttlCache.wrap(`reports:dashboard-v2:${tenantID}:${period}`, 30_000, () =>
      this.computeDashboardV2(tenantID, period),
    );
  }

  private async computeDashboardV2(tenantID: string, period: 'today' | 'week' | 'month' | 'year') {
    // E-7 — границы дня/месяца в БИЗНЕС-таймзоне (Europe/Moscow, UTC+3 без
    // летнего времени), как getFinancial/getCashFlow и shifts/salary. Раньше
    // границы строились от контейнерного (UTC) настенного времени, поэтому в
    // 00:00–02:59 МСК чек попадал в «сегодня/этот месяц» на дашборде иначе, чем
    // на экранах денег, и «Финансы» расходились с «Движением денег». Считаем
    // компоненты московского «сейчас» (UTC-геттеры от сдвинутого времени) и
    // отдаём границы как UTC-инстанты московской полуночи (паттерн salary).
    const MSK_OFFSET_MS = 3 * 60 * 60 * 1000; // Europe/Moscow = UTC+3
    const mskNow = new Date(Date.now() + MSK_OFFSET_MS);
    const mskY = mskNow.getUTCFullYear();
    const mskM = mskNow.getUTCMonth();
    const mskD = mskNow.getUTCDate();
    const todayStart = new Date(Date.UTC(mskY, mskM, mskD) - MSK_OFFSET_MS).toISOString();
    const monthStart = new Date(Date.UTC(mskY, mskM, 1) - MSK_OFFSET_MS).toISOString();
    const prevMonthStart = new Date(Date.UTC(mskY, mskM - 1, 1) - MSK_OFFSET_MS).toISOString();

    // Existing dashboard numbers (preserve compatibility — caller sees them too).
    // ITEM 2 — гарантия ИСКЛЮЧЕНА из выручки; в прибыли заменена на убыток.
    //   • revenue_today/month: FILTER … IS DISTINCT FROM 'warranty' — гарантия
    //     не выручка.
    //   • profit_today/month: для гарантийного чека вместо сохранённого
    //     (положительного) profit берём −(product_cost_total + service_salary_total
    //     + product_salary_total) — реальный убыток (запчасти + выплата мастеру +
    //     его товарная комиссия, money-audit C2: она начисляется и по гарантии).
    //     netProfit = profit − расходы, поэтому убыток корректно уменьшает
    //     чистую прибыль.
    //   • warranty_today (справочно) — «отпускная» сумма гарантийных работ.
    //   • warranty_loss_today (НОВОЕ) — тот же убыток за сегодня для cashPosition.
    const { rows: baseRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method IS DISTINCT FROM 'warranty' THEN total_revenue END), 0) AS revenue_today,
         COALESCE(COUNT(CASE WHEN date >= $2 THEN 1 END), 0) AS checks_today,
         COALESCE(SUM(CASE WHEN date >= $3 AND payment_method IS DISTINCT FROM 'warranty' THEN total_revenue END), 0) AS revenue_month,
         COALESCE(SUM(CASE WHEN date >= $2 THEN (CASE WHEN payment_method='warranty' THEN -(product_cost_total + service_salary_total + COALESCE(product_salary_total, 0)) ELSE profit END) END), 0) AS profit_today,
         COALESCE(SUM(CASE WHEN date >= $3 THEN (CASE WHEN payment_method='warranty' THEN -(product_cost_total + service_salary_total + COALESCE(product_salary_total, 0)) ELSE profit END) END), 0) AS profit_month,
         COALESCE(SUM(CASE WHEN date >= $2 THEN cash_amount END), 0) AS cash_today,
         COALESCE(SUM(CASE WHEN date >= $2 THEN card_amount END), 0) AS card_today,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method='warranty' THEN total_revenue END), 0) AS warranty_today,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method='warranty' THEN product_cost_total + service_salary_total + COALESCE(product_salary_total, 0) END), 0) AS warranty_loss_today,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method='installment' THEN GREATEST(total_revenue - cash_amount - card_amount, 0) END), 0) AS installment_debt_today
       FROM checks
       WHERE tenant_id=$1 AND is_deferred=false AND deleted_at IS NULL`,
      [tenantID, todayStart, monthStart],
    );
    const base = baseRows[0];

    // Director-recorded expenses (today, month, last month) — needed for
    // net profit and the spark line.
    // Same two corrections as getFinancial: exclude the 'Зарплата' payout
    // category (per-check `profit` already nets the salary accrual, so adding
    // the payout expense would double-count labour in netProfit) and count
    // only APPROVED expenses (NULL = legacy approved).
    // `exp_month_oneoff` (v3.0.1 ФИЧА 1) — ТОЛЬКО РАЗОВЫЕ расходы месяца:
    // approved, не «Зарплата», И категория НЕ помечена is_recurring (132). Это
    // единственный расходный терм, который режет ACCRUAL-прибыль. Плановая
    // постоянка (recurring-категории) в accrual НЕ вычитается по факту — она
    // начисляется из fixed_costs/employee_compensation ниже, а её оплаты идут
    // только в «Движение денег» (развязка двойного списания). exp_month/exp_today
    // (кассовые) остаются как были — их использует СТАРАЯ netProfitMonth (по факту).
    // `exp_month_recurring` (FIX 2) — companion to exp_month_oneoff: approved,
    // non-«Зарплата», recurring-flagged (132) expenses this month. Guarantees
    // exp_month = exp_month_oneoff + exp_month_recurring, so no paid expense can
    // silently vanish from the accrual when a category is flagged recurring but
    // never budgeted in fixed_costs (see reconciliation below).
    const { rows: expenseRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN e.date >= $2 THEN e.amount END), 0) AS exp_today,
         COALESCE(SUM(CASE WHEN e.date >= $3 THEN e.amount END), 0) AS exp_month,
         COALESCE(SUM(CASE WHEN e.date >= $4 AND e.date < $3 THEN e.amount END), 0) AS exp_prev_month,
         COALESCE(SUM(CASE WHEN e.date >= $3 AND COALESCE(ec.is_recurring, false) = false THEN e.amount END), 0) AS exp_month_oneoff,
         COALESCE(SUM(CASE WHEN e.date >= $3 AND COALESCE(ec.is_recurring, false) = true THEN e.amount END), 0) AS exp_month_recurring
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.tenant_id=$1
         AND COALESCE(e.approval_status, 'approved') = 'approved'
         AND COALESCE(ec.name, '') <> 'Зарплата'`,
      [tenantID, todayStart, monthStart, prevMonthStart],
    );
    const expToday = parseFloat(expenseRows[0]?.exp_today) || 0;
    const expMonth = parseFloat(expenseRows[0]?.exp_month) || 0;
    const expPrevMonth = parseFloat(expenseRows[0]?.exp_prev_month) || 0;
    const oneOffExpMonth = parseFloat(expenseRows[0]?.exp_month_oneoff) || 0;
    const recurringActualMonth = parseFloat(expenseRows[0]?.exp_month_recurring) || 0;

    const profitToday = parseFloat(base.profit_today) || 0;
    const profitMonth = parseFloat(base.profit_month) || 0;
    const revenueToday = parseFloat(base.revenue_today) || 0;
    const revenueMonth = parseFloat(base.revenue_month) || 0;
    const checksToday = parseInt(base.checks_today) || 0;
    const cashToday = parseFloat(base.cash_today) || 0;
    const cardToday = parseFloat(base.card_today) || 0;
    const warrantyToday = parseFloat(base.warranty_today) || 0;
    const warrantyLossToday = parseFloat(base.warranty_loss_today) || 0;
    const installmentDebtToday = parseFloat(base.installment_debt_today) || 0;

    const netProfitToday = profitToday - expToday;
    const netProfitMonth = profitMonth - expMonth;

    // Previous-period net profit (last month) for marginPctChange.
    // Гарантия исключена из выручки и заменена на убыток в прибыли — та же
    // семантика, что в baseRows, чтобы marginPctChange считался консистентно.
    const { rows: prevRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN payment_method IS DISTINCT FROM 'warranty' THEN total_revenue ELSE 0 END), 0) AS revenue,
         COALESCE(SUM(CASE WHEN payment_method='warranty' THEN -(product_cost_total + service_salary_total + COALESCE(product_salary_total, 0)) ELSE profit END), 0) AS profit
         FROM checks
        WHERE tenant_id=$1 AND is_deferred=false AND deleted_at IS NULL
          AND date >= $2 AND date < $3`,
      [tenantID, prevMonthStart, monthStart],
    );
    const prevRevenue = parseFloat(prevRows[0]?.revenue) || 0;
    const prevProfit = parseFloat(prevRows[0]?.profit) || 0;
    const prevNet = prevProfit - expPrevMonth;
    const marginPct = revenueMonth > 0 ? (netProfitMonth / revenueMonth) * 100 : 0;
    const prevMarginPct = prevRevenue > 0 ? (prevNet / prevRevenue) * 100 : 0;
    const marginPctChange = marginPct - prevMarginPct;

    // Spark line: 30-day net profit per day.
    const { rows: sparkRows } = await this.pool.query(
      `SELECT day, COALESCE(profit, 0) AS profit, COALESCE(exp, 0) AS expense
         FROM (
           SELECT generate_series(now()::date - interval '29 days', now()::date, '1 day')::date AS day
         ) d
         LEFT JOIN (
           SELECT date::date AS day,
                  SUM(CASE WHEN payment_method='warranty' THEN -(product_cost_total + service_salary_total + COALESCE(product_salary_total, 0)) ELSE profit END) AS profit
             FROM checks
            WHERE tenant_id=$1 AND is_deferred=false AND deleted_at IS NULL
              AND date >= now() - interval '30 days'
            GROUP BY day
         ) ch USING (day)
         LEFT JOIN (
           SELECT e.date::date AS day, SUM(e.amount) AS exp
             FROM expenses e
             LEFT JOIN expense_categories ec ON ec.id = e.category_id
            WHERE e.tenant_id=$1 AND e.date >= now() - interval '30 days'
              AND COALESCE(e.approval_status, 'approved') = 'approved'
              AND COALESCE(ec.name, '') <> 'Зарплата'
            GROUP BY day
         ) ex USING (day)
         ORDER BY day`,
      [tenantID],
    );
    const marginSpark = sparkRows.map((r) => (parseFloat(r.profit) || 0) - (parseFloat(r.expense) || 0));

    // Погашения рассрочки за сегодня — по дате платежа (installment_payments,
    // 093). Информационно: деньги за прошлые продажи, в revenueToday не входят.
    // Разбивка по payment_method (119): 'card' → card, остальное → cash
    // (до-миграционные строки считаются налом — решение владельца).
    // paid = paid_cash + paid_card; installmentPaid остаётся суммой для
    // совместимости со старыми клиентами.
    const { rows: instPaidRows } = await this.pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid,
              COALESCE(SUM(CASE WHEN payment_method = 'card' THEN amount ELSE 0 END), 0) AS paid_card,
              COALESCE(SUM(CASE WHEN COALESCE(payment_method, 'cash') <> 'card' THEN amount ELSE 0 END), 0) AS paid_cash
         FROM installment_payments
        WHERE tenant_id=$1 AND paid_at >= $2`,
      [tenantID, todayStart],
    );
    const installmentPaidToday = parseFloat(instPaidRows[0]?.paid) || 0;
    const installmentPaidCashToday = parseFloat(instPaidRows[0]?.paid_cash) || 0;
    const installmentPaidCardToday = parseFloat(instPaidRows[0]?.paid_card) || 0;

    // Cash position: реально принятые сегодня деньги = cash + card (ITEM 2 —
    // гарантия БОЛЬШЕ не входит в total: работа по гарантии денег в кассу не
    // приносит). `warranty` остаётся справочным полем (отпускная стоимость
    // гарантийных работ), `warrantyLoss` (НОВОЕ) — сегодняшний убыток по
    // гарантии (запчасти + выплата мастеру) для показа затратой.
    // installmentDebt/installmentPaid — отдельные строки, клиенты показывают их
    // сами, когда поле пришло числом.
    const cashPosition = {
      cash: cashToday,
      card: cardToday,
      warranty: warrantyToday,
      warrantyLoss: warrantyLossToday,
      total: cashToday + cardToday,
      installmentDebt: installmentDebtToday,
      installmentPaid: installmentPaidToday,
      installmentPaidCash: installmentPaidCashToday,
      installmentPaidCard: installmentPaidCardToday,
    };

    // Deferred sum: open drafts (is_deferred=true) totals.
    const { rows: defRows } = await this.pool.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_revenue), 0) AS sum
         FROM checks WHERE tenant_id=$1 AND is_deferred=true AND deleted_at IS NULL`,
      [tenantID],
    );
    const deferredSum = {
      count: parseInt(defRows[0]?.cnt) || 0,
      sum: parseFloat(defRows[0]?.sum) || 0,
    };

    // Personal record: best day + best month all time. Гарантия исключена из
    // выручки (ITEM 2), поэтому рекорд считается по реальной выручке.
    const { rows: bestDayRows } = await this.pool.query(
      `SELECT date::date AS day, SUM(CASE WHEN payment_method IS DISTINCT FROM 'warranty' THEN total_revenue ELSE 0 END) AS revenue
         FROM checks WHERE tenant_id=$1 AND is_deferred=false AND deleted_at IS NULL
         GROUP BY day ORDER BY revenue DESC LIMIT 1`,
      [tenantID],
    );
    const { rows: bestMonthRows } = await this.pool.query(
      `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS ym, SUM(CASE WHEN payment_method IS DISTINCT FROM 'warranty' THEN total_revenue ELSE 0 END) AS revenue
         FROM checks WHERE tenant_id=$1 AND is_deferred=false AND deleted_at IS NULL
         GROUP BY ym ORDER BY revenue DESC LIMIT 1`,
      [tenantID],
    );
    const personalRecord = {
      bestDay: bestDayRows[0]
        ? {
            date:
              typeof bestDayRows[0].day === 'string'
                ? bestDayRows[0].day.slice(0, 10)
                : new Date(bestDayRows[0].day).toISOString().slice(0, 10),
            value: parseFloat(bestDayRows[0].revenue) || 0,
          }
        : undefined,
      bestMonth: bestMonthRows[0]
        ? {
            ym: bestMonthRows[0].ym as string,
            value: parseFloat(bestMonthRows[0].revenue) || 0,
          }
        : undefined,
    };

    // Month forecast: project current MTD revenue to end of month linearly.
    // Дни месяца/день месяца — в московской бизнес-таймзоне (E-7), чтобы
    // амортизация постоянки и прогноз считались от того же «сегодня», что и
    // MTD-агрегаты выше (иначе в 00:00–02:59 МСК dayOfMonth отставал на сутки).
    const daysInMonth = new Date(Date.UTC(mskY, mskM + 1, 0)).getUTCDate();
    const dayOfMonth = Math.max(mskD, 1);
    const monthForecast = (revenueMonth / dayOfMonth) * daysInMonth;

    // ── v3.0.1 ФИЧА 1 — ЧИСТАЯ ПРИБЫЛЬ ПО НАЧИСЛЕНИЮ (accrual) ────────────────
    // Гладкая, прогнозируемая прибыль: аренда/коммуналка/маркетинг/оклады НЕ
    // прыгают в день оплаты, а размазываются по ВСЕМ календарным дням месяца.
    //
    // ФОРМУЛА (MTD = с начала месяца по сегодня):
    //   checkProfit           = profitMonth  (выручка − запчасти − %мастеру за
    //                           работу; уже в per-check profit; гарантия = убыток)
    //   plannedFixedAmortized = Σ fixed_costs.monthly_amount / daysInMonth × dayOfMonth
    //   staffFixedAmortized   = Σ оклады (employee_compensation type=fixed_monthly)
    //                           / daysInMonth × dayOfMonth
    //   staffPctTurnover      = revenueMonth × Σ%(pct_turnover)/100   (натурально MTD)
    //   staffPctProfit        = max(checkProfit,0) × Σ%(pct_profit)/100
    //                           (база — прибыль по чекам ДО вычета постоянки/мотиваций,
    //                            иначе рекурсия; в убыток доля = 0)
    //   oneOffExpenses        = разовые approved-расходы месяца (НЕ recurring, НЕ
    //                           «Зарплата»); СУНК-стоимость — считаются ОДИН раз,
    //                           в прогнозе НЕ run-rate'ятся (FIX 1)
    //   recurringExcess       = страховка «ничего не теряется» (FIX 2, см. ниже)
    //   netProfitAccrued_MTD  = checkProfit − plannedFixedAmortized − staffFixedAmortized
    //                           − staffPctTurnover − staffPctProfit − oneOffExpenses
    //                           − recurringExcess
    //
    // РАЗВЯЗКА ДВОЙНОГО СПИСАНИЯ: плановая постоянка вычитается ТОЛЬКО из конфига
    // (fixed_costs + employee_compensation). Её ФАКТИЧЕСКИЕ оплаты пишутся в
    // expenses под recurring-категориями (132) / «Зарплата» и в accrual-прибыль
    // повторно НЕ попадают (oneOffExpMonth их исключает; per-check %мастеру и так
    // не в expenses). Итог: каждая копейка постоянки списывается РОВНО один раз.
    //
    // FIX 2 — «ничего не теряется» + инвариант нулевого конфига:
    //   • НЕТ планового конфига (всё 0) → recurring-категории трактуем как разовые:
    //     фактический расход месяца берём НЕФИЛЬТРОВАННЫМ (expMonth), поэтому
    //     mtd.netProfit === netProfitMonth ТОЧНО (иначе помеченная recurring-, но
    //     не заведённая в план категория «испаряла» реальный расход из прибыли).
    //   • ЕСТЬ плановый конфиг → плановая постоянка амортизируется как обычно, но
    //     ДОПОЛНИТЕЛЬНО вычитаем непокрытый планом избыток фактической постоянки:
    //     recurringExcessMTD = max(recurringActualMonth×amortFactor − plannedCoverageMTD, 0)
    //     где plannedCoverageMTD = (plannedFixed+staffFixed)×amortFactor
    //       + revenueMTD×%оборот/100 + max(checkProfit,0)×%прибыль/100.
    //     Так реальная аренда 80k, помеченная recurring, но не заведённая в план,
    //     не исчезает — она уходит в recurringExcess (и в config.recurringUncovered
    //     как сигнал владельцу «отмечено постоянным, но не заведено в План»).
    //
    // ПРОГНОЗ на весь месяц = run-rate выручки/прибыли (÷ dayOfMonth × daysInMonth)
    // − ПОЛНАЯ плановая постоянка (не амортизированная) − %-сотрудники от run-rate
    // − разовые расходы ОДИН раз (сунк, без run-rate) − run-rate непокрытой постоянки.
    const [{ rows: fcRows }, { rows: compRows }] = await Promise.all([
      this.pool.query(
        `SELECT COALESCE(SUM(monthly_amount), 0) AS planned_fixed
           FROM fixed_costs WHERE tenant_id = $1 AND active = true`,
        [tenantID],
      ),
      this.pool.query(
        `SELECT type, COALESCE(SUM(amount), 0) AS total
           FROM employee_compensation WHERE tenant_id = $1 AND active = true
          GROUP BY type`,
        [tenantID],
      ),
    ]);
    const plannedFixedMonthly = parseFloat(fcRows[0]?.planned_fixed) || 0;
    let staffFixedMonthly = 0;
    let pctTurnoverTotal = 0;
    let pctProfitTotal = 0;
    for (const c of compRows) {
      const total = parseFloat(c.total) || 0;
      if (c.type === 'fixed_monthly') staffFixedMonthly += total;
      else if (c.type === 'pct_turnover') pctTurnoverTotal += total;
      else if (c.type === 'pct_profit') pctProfitTotal += total;
    }
    // Есть ли у тенанта ХОТЬ КАКОЙ-ТО плановый конфиг? От этого зависит трактовка
    // recurring-категорий (см. FIX 2 выше).
    const hasPlannedConfig =
      plannedFixedMonthly > 0 || staffFixedMonthly > 0 || pctTurnoverTotal > 0 || pctProfitTotal > 0;

    const checkProfitMTD = profitMonth;
    const revenueMTD = revenueMonth;
    const amortFactor = dayOfMonth / daysInMonth; // доля месяца, прошедшая к сегодня
    const runRateFactor = daysInMonth / dayOfMonth; // экстраполяция MTD → полный месяц

    // Month-to-date accrual. `% с прибыли` база — max(checkProfit, 0): в убыточный
    // месяц доля с прибыли = 0, а не отрицательная (не отбираем у сотрудника, не
    // «раздуваем» прибыль двойным минусом). `% с оборота` база (выручка) всегда ≥ 0.
    const mtdPlannedFixed = plannedFixedMonthly * amortFactor;
    const mtdStaffFixed = staffFixedMonthly * amortFactor;
    const mtdStaffPctTurnover = revenueMTD * (pctTurnoverTotal / 100);
    const mtdStaffPctProfit = Math.max(checkProfitMTD, 0) * (pctProfitTotal / 100);

    // FIX 2 — фактический расход + непокрытый избыток постоянки. Без конфига:
    // расход = expMonth (recurring как разовые) → инвариант mtd===netProfitMonth.
    // С конфигом: расход = oneOffExpMonth, плюс recurringExcess подхватывает всё,
    // что помечено постоянным, но планом не покрыто (ничего не теряется).
    const mtdOneOff = hasPlannedConfig ? oneOffExpMonth : expMonth;
    let mtdRecurringExcess = 0;
    if (hasPlannedConfig) {
      const plannedCoverageMTD = mtdPlannedFixed + mtdStaffFixed + mtdStaffPctTurnover + mtdStaffPctProfit;
      mtdRecurringExcess = Math.max(recurringActualMonth * amortFactor - plannedCoverageMTD, 0);
    }
    const mtdNetProfit =
      checkProfitMTD -
      mtdPlannedFixed -
      mtdStaffFixed -
      mtdStaffPctTurnover -
      mtdStaffPctProfit -
      mtdOneOff -
      mtdRecurringExcess;

    // Full-month projection (run-rate revenue/profit + FULL planned costs). Разовые
    // расходы — СУНК: считаем ОДИН раз (projOneOff === mtdOneOff, БЕЗ run-rate,
    // FIX 1). Непокрытая постоянка — ongoing, поэтому run-rate'ится.
    const projRevenue = revenueMTD * runRateFactor;
    const projCheckProfit = checkProfitMTD * runRateFactor;
    const projOneOff = mtdOneOff; // FIX 1 — sunk cost, count once (matches mtd)
    const projStaffPctTurnover = projRevenue * (pctTurnoverTotal / 100);
    const projStaffPctProfit = Math.max(projCheckProfit, 0) * (pctProfitTotal / 100);
    let projRecurringExcess = 0;
    if (hasPlannedConfig) {
      const plannedCoverageProj = plannedFixedMonthly + staffFixedMonthly + projStaffPctTurnover + projStaffPctProfit;
      projRecurringExcess = Math.max(recurringActualMonth * runRateFactor - plannedCoverageProj, 0);
    }
    const projNetProfit =
      projCheckProfit -
      plannedFixedMonthly -
      staffFixedMonthly -
      projStaffPctTurnover -
      projStaffPctProfit -
      projOneOff -
      projRecurringExcess;

    const r0 = (n: number) => Math.round(n);
    const netProfitAccrual = {
      daysInMonth,
      daysElapsed: dayOfMonth,
      mtd: {
        checkProfit: r0(checkProfitMTD),
        plannedFixedAmortized: r0(mtdPlannedFixed),
        staffFixedAmortized: r0(mtdStaffFixed),
        staffPctTurnover: r0(mtdStaffPctTurnover),
        staffPctProfit: r0(mtdStaffPctProfit),
        oneOffExpenses: r0(mtdOneOff),
        // Непокрытый планом избыток фактической постоянки (FIX 2). 0 при отсутствии
        // конфига (recurring трактуется как разовое в oneOffExpenses).
        recurringExcess: r0(mtdRecurringExcess),
        netProfit: r0(mtdNetProfit),
      },
      projection: {
        revenue: r0(projRevenue),
        checkProfit: r0(projCheckProfit),
        plannedFixed: r0(plannedFixedMonthly),
        staffFixed: r0(staffFixedMonthly),
        staffPctTurnover: r0(projStaffPctTurnover),
        staffPctProfit: r0(projStaffPctProfit),
        // Разовые — сунк, один раз (совпадает с mtd.oneOffExpenses, FIX 1).
        oneOffExpenses: r0(projOneOff),
        recurringExcess: r0(projRecurringExcess),
        netProfit: r0(projNetProfit),
      },
      config: {
        plannedFixedMonthly: r0(plannedFixedMonthly),
        staffFixedMonthly: r0(staffFixedMonthly),
        pctTurnoverTotal,
        pctProfitTotal,
        // FIX 2d — сколько фактической постоянки (MTD) помечено «постоянной», но НЕ
        // покрыто планом: сигнал UI «отмечено постоянным, но не заведено в План: X ₽»,
        // чтобы владелец добавил строку в fixed_costs, а не терял расход молча.
        recurringUncovered: r0(mtdRecurringExcess),
      },
    };

    return {
      revenueToday,
      revenueMonth,
      checksToday,
      netProfitToday,
      netProfitMonth,
      cashPosition,
      marginPct: Math.round(marginPct * 10) / 10,
      marginPctChange: Math.round(marginPctChange * 10) / 10,
      marginSpark,
      deferredSum,
      personalRecord,
      monthForecast: Math.round(monthForecast),
      // v3.0.1 ФИЧА 1 — гладкая чистая прибыль по начислению (факт MTD + прогноз).
      // Additive: старые клиенты игнорируют поле; новые показывают
      // netProfitAccrual.mtd.netProfit («с начала месяца») и
      // netProfitAccrual.projection.netProfit («прогноз на месяц»). Кассовый
      // netProfitMonth (по факту) остаётся для обратной совместимости.
      netProfitAccrual,
      period,
    };
  }

  /**
   * "New vs returning" client split for the requested window.
   *
   * v3.0.1 ФИЧА 5 — определение владельца (было: по дате ПЕРВОГО ЧЕКА; стало: по
   * дате ЗАВЕДЕНИЯ КЛИЕНТА В БАЗУ):
   *   • НОВЫЙ (new)       = клиент, чья запись СОЗДАНА в периоде
   *     (clients.created_at ∈ [from,to]). Считаются ВСЕ такие клиенты тенанта,
   *     независимо от того, был ли у них чек. Метка UI: «новые (добавлены в базу
   *     за период)».
   *   • СУЩЕСТВУЮЩИЙ (returning) = клиент, который был в базе ДО периода
   *     (created_at < from) И проявил активность (имел чек) в периоде. Метка UI:
   *     «существующие».
   *   newRevenue      = выручка чеков в периоде у клиентов, заведённых в периоде.
   *   returningRevenue= выручка чеков в периоде у клиентов, заведённых раньше.
   * `basis` явно фиксирует базу расчёта, чтобы UI не гадал. Tenant-scoped.
   */
  async clientsNewVsReturning(tenantID: string, params: { from: string; to: string }) {
    const from = this.safeDate(params?.from, '');
    const to = this.safeDate(params?.to, '');
    if (!from || !to) {
      return {
        newCount: 0,
        returningCount: 0,
        newRevenue: 0,
        returningRevenue: 0,
        basis: 'client_created_at' as const,
        period: { from: params?.from ?? '', to: params?.to ?? '' },
      };
    }
    params = { from, to };
    const { rows } = await this.pool.query(
      `WITH window_checks AS (
         -- Чеки периода + дата ЗАВЕДЕНИЯ клиента (created_at) для когорты.
         SELECT ch.client_id, ch.total_revenue, ch.payment_method, cl.created_at AS client_created_at
           FROM checks ch
           JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = $1
          WHERE ch.tenant_id=$1 AND ch.is_deferred=false
            AND ch.deleted_at IS NULL
            AND ch.client_id IS NOT NULL
            AND ch.date::date BETWEEN $2::date AND $3::date
       )
       SELECT
         -- НОВЫЕ = все записи клиентов, созданные в периоде (даже без чека).
         (SELECT COUNT(*) FROM clients
            WHERE tenant_id=$1 AND created_at::date BETWEEN $2::date AND $3::date) AS new_count,
         -- СУЩЕСТВУЮЩИЕ = активные в периоде, заведённые ДО периода. FIX 3 —
         -- клиенты с НЕИЗВЕСТНОЙ датой заведения (created_at IS NULL) идут в
         -- «существующие», НЕ в «новые»: иначе они выпадали из обоих сегментов и
         -- их выручка периода терялась. new_count/new_revenue не трогаем (NULL в
         -- BETWEEN и так не попадает).
         -- ВЫРУЧКА без гарантии (ITEM 2 / money-audit M8): гарантийный ремонт —
         -- убыток, не marketing-выручка. Счётчики активности гарантию сохраняют
         -- (визит был), фильтруется только SUM.
         COUNT(DISTINCT CASE WHEN client_created_at IS NULL OR client_created_at::date < $2::date THEN client_id END) AS returning_count,
         COALESCE(SUM(CASE WHEN payment_method IS DISTINCT FROM 'warranty' AND client_created_at::date BETWEEN $2::date AND $3::date THEN total_revenue END), 0) AS new_revenue,
         COALESCE(SUM(CASE WHEN payment_method IS DISTINCT FROM 'warranty' AND (client_created_at IS NULL OR client_created_at::date < $2::date) THEN total_revenue END), 0) AS returning_revenue
       FROM window_checks`,
      [tenantID, params.from, params.to],
    );
    const r = rows[0];
    return {
      newCount: parseInt(r?.new_count) || 0,
      returningCount: parseInt(r?.returning_count) || 0,
      newRevenue: parseFloat(r?.new_revenue) || 0,
      returningRevenue: parseFloat(r?.returning_revenue) || 0,
      // Явная база расчёта для прозрачности UI: «новый» = добавлен в базу за период.
      basis: 'client_created_at' as const,
      period: { from: params.from, to: params.to },
    };
  }

  /**
   * Top-10 owner alerts derived from existing modules — low stock, low
   * reviews, open warranty claims, late masters today, recent returns.
   * Order: crit → warn → info, then by recency. Cached 30s per tenant.
   */
  async alerts(tenantID: string) {
    return ttlCache.wrap(`reports:alerts:${tenantID}`, 30_000, () => this.computeAlerts(tenantID));
  }

  private async computeAlerts(tenantID: string) {
    const out: Array<{
      type: 'low_stock' | 'low_review' | 'warranty' | 'late_master' | 'pending_return';
      severity: 'info' | 'warn' | 'crit';
      message: string;
      link?: string;
    }> = [];

    // Low-stock items (≤ min_stock AND min_stock > 0).
    const { rows: low } = await this.pool.query(
      `SELECT id, name, stock, min_stock FROM products
        WHERE tenant_id=$1 AND deleted_at IS NULL
          AND stock <= min_stock AND min_stock > 0
        ORDER BY (min_stock - stock) DESC LIMIT 5`,
      [tenantID],
    );
    for (const p of low) {
      const sev = parseFloat(p.stock) <= 0 ? 'crit' : 'warn';
      out.push({
        type: 'low_stock',
        severity: sev,
        message: `${p.name}: ${p.stock}/${p.min_stock}`,
        link: `/products/${p.id}`,
      });
    }

    // Low reviews (≤3 in last 7 days)
    const { rows: lowRev } = await this.pool.query(
      `SELECT rr.id, rr.rating, cl.full_name AS client_name, u.full_name AS employee_name
         FROM review_responses rr
         LEFT JOIN clients cl ON cl.id = rr.client_id
         LEFT JOIN users u ON u.id = rr.employee_id
        WHERE rr.tenant_id=$1
          AND rr.created_at >= now() - interval '7 days'
          AND rr.rating <= 3
        ORDER BY rr.created_at DESC LIMIT 5`,
      [tenantID],
    );
    for (const r of lowRev) {
      out.push({
        type: 'low_review',
        severity: parseInt(r.rating) <= 2 ? 'crit' : 'warn',
        message: `Низкая оценка ${r.rating}★ — ${r.client_name ?? 'клиент'} → ${r.employee_name ?? 'сотрудник'}`,
        link: '/marketing',
      });
    }

    // Open warranty claims (not used + expires within 7 days)
    const { rows: war } = await this.pool.query(
      `SELECT id, item_name, expires_at FROM warranty_claims
        WHERE tenant_id=$1 AND used_at IS NULL
          AND expires_at <= now() + interval '7 days'
          AND expires_at >= now()
        ORDER BY expires_at ASC LIMIT 5`,
      [tenantID],
    );
    for (const w of war) {
      out.push({
        type: 'warranty',
        severity: 'info',
        message: `Гарантия скоро истечёт: ${w.item_name ?? 'позиция'}`,
        link: `/warranty/${w.id}`,
      });
    }

    // Late masters today (schedule_entries with late_status = late_major today)
    const { rows: lateMasters } = await this.pool.query(
      `SELECT u.full_name FROM schedule_entries se
        JOIN users u ON u.id = se.user_id
       WHERE se.tenant_id=$1
         AND se.date = (now() AT TIME ZONE 'Europe/Moscow')::date
         AND se.late_status = 'late_major'
       LIMIT 5`,
      [tenantID],
    );
    for (const m of lateMasters) {
      out.push({
        type: 'late_master',
        severity: 'warn',
        message: `${m.full_name} — опоздал`,
        link: '/schedule',
      });
    }

    // Recent returns (last 24h)
    const { rows: rets } = await this.pool.query(
      `SELECT cr.id, ch.number AS check_number, cr.created_at
         FROM check_returns cr
         JOIN checks ch ON ch.id = cr.check_id
        WHERE cr.tenant_id=$1 AND cr.created_at >= now() - interval '1 day'
        ORDER BY cr.created_at DESC LIMIT 5`,
      [tenantID],
    );
    for (const r of rets) {
      out.push({
        type: 'pending_return',
        severity: 'info',
        message: `Возврат по заказ-наряду #${r.check_number}`,
        link: '/returns',
      });
    }

    // Severity sort: crit > warn > info; cap to 10.
    const order: Record<string, number> = { crit: 0, warn: 1, info: 2 };
    out.sort((a, b) => order[a.severity] - order[b.severity]);
    return out.slice(0, 10);
  }

  /** Aggregate revenue by weekday for the period. */
  async bestDayOfWeek(tenantID: string, params: { from: string; to: string }) {
    const from = this.safeDate(params?.from, '');
    const to = this.safeDate(params?.to, '');
    if (!from || !to) {
      return { days: [], best: 0, worst: 0 };
    }
    params = { from, to };
    const { rows } = await this.pool.query(
      `SELECT EXTRACT(DOW FROM date)::int AS weekday,
              COALESCE(SUM(total_revenue), 0) AS revenue,
              COUNT(*) AS cnt
         FROM checks
        WHERE tenant_id=$1 AND is_deferred=false AND deleted_at IS NULL
          AND date::date BETWEEN $2::date AND $3::date
        GROUP BY weekday
        ORDER BY weekday`,
      [tenantID, params.from, params.to],
    );
    const map: Record<number, { weekday: number; revenue: number; count: number }> = {};
    for (let i = 0; i <= 6; i++) map[i] = { weekday: i, revenue: 0, count: 0 };
    for (const r of rows) {
      const wd = parseInt(r.weekday);
      map[wd] = { weekday: wd, revenue: parseFloat(r.revenue) || 0, count: parseInt(r.cnt) || 0 };
    }
    const days = Object.values(map);
    let best = 0,
      worst = 0,
      bestVal = -Infinity,
      worstVal = Infinity;
    for (const d of days) {
      if (d.revenue > bestVal) {
        bestVal = d.revenue;
        best = d.weekday;
      }
      if (d.revenue < worstVal) {
        worstVal = d.revenue;
        worst = d.weekday;
      }
    }
    return { days, best, worst };
  }

  async recentReviews(tenantID: string, limit = 5) {
    const cap = Math.min(Math.max(limit, 1), 50);
    const { rows } = await this.pool.query(
      `SELECT rr.id, rr.rating, rr.comment, rr.created_at,
              cl.full_name AS client_name,
              u.full_name AS employee_name
         FROM review_responses rr
         LEFT JOIN clients cl ON cl.id = rr.client_id
         LEFT JOIN users u ON u.id = rr.employee_id
        WHERE rr.tenant_id=$1
        ORDER BY rr.created_at DESC
        LIMIT $2`,
      [tenantID, cap],
    );
    return rows.map((r) => ({
      id: r.id,
      rating: parseInt(r.rating) || 0,
      comment: r.comment,
      clientName: r.client_name,
      employeeName: r.employee_name,
      createdAt: r.created_at,
    }));
  }

  /**
   * Client retention stats for the requested rolling period (week / month / year).
   * Returns the share of returning clients (i.e. clients who had any earlier
   * check before this window) and average LTV / days between visits.
   */
  async retention(tenantID: string, period: 'week' | 'month' | 'year' = 'month') {
    const interval = period === 'week' ? '7 days' : period === 'year' ? '365 days' : '30 days';
    const { rows } = await this.pool.query(
      `WITH visits AS (
         SELECT client_id, COUNT(*) AS visit_count, SUM(total_revenue) AS ltv,
                MIN(date) AS first_date, MAX(date) AS last_date
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL
            AND deleted_at IS NULL
          GROUP BY client_id
       ),
       window_clients AS (
         SELECT DISTINCT client_id
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false
            AND deleted_at IS NULL
            AND date >= now() - interval '${interval}'
            AND client_id IS NOT NULL
       )
       SELECT
         COUNT(*) AS total_in_window,
         COUNT(*) FILTER (WHERE v.visit_count > 1) AS returning,
         COALESCE(AVG(v.ltv), 0) AS avg_ltv,
         COALESCE(AVG(EXTRACT(EPOCH FROM (v.last_date - v.first_date)) / 86400 / NULLIF(v.visit_count - 1, 0)), 0) AS avg_days_between
       FROM window_clients wc
       JOIN visits v ON v.client_id = wc.client_id`,
      [tenantID],
    );
    const r = rows[0];
    const total = parseInt(r?.total_in_window) || 0;
    const returning = parseInt(r?.returning) || 0;
    return {
      returningRate: total > 0 ? Math.round((returning / total) * 1000) / 10 : 0,
      avgLtv: Math.round(parseFloat(r?.avg_ltv) || 0),
      avgDaysBetweenVisits: Math.round(parseFloat(r?.avg_days_between) || 0),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Consolidated «Маркетинговые отчёты» (GET /reports/marketing?from&to).
  //
  //  Owner-locked redesign: EVERY number here is derived from real rows in
  //  existing tables — nothing is invented or forward-accumulated. Directions:
  //    • acquisition — new/returning clients (count+revenue), by clients.source,
  //                    first-visit cohort.            [checks + clients.source]
  //    • retention   — returning rate, avg LTV, avg days between visits,
  //                    repeat-purchase distribution.  [checks]
  //    • calls       — funnel + summary (0 when no telephony).
  //                                                   [CallsService + sms_history]
  //    • reviews     — totals, rating, response/conversion, token funnel.
  //                                                   [review_responses/_tokens]
  //    • loyalty     — points accrued/redeemed, redemption value, participants.
  //                                                   [loyalty_settings + client_bonuses]
  //    • revenue     — revenue by client source and by master.        [checks]
  //    • trends      — weekly AND monthly buckets over the window for
  //                    new clients / revenue / returning rate / calls / reviews.
  //                                        [checks + sms_history + review_responses]
  //
  //  Warranty checks (payment_method='warranty') are EXCLUDED from every revenue
  //  figure — a warranty repair is a loss, not marketing revenue (mirrors the
  //  financial report, ITEM 2). Each sub-section is computed best-effort — a
  //  failure in one (e.g. no telephony) degrades to zeros/empty instead of
  //  failing the whole report. All queries are tenant-scoped; from/to default to
  //  the current month.
  // ──────────────────────────────────────────────────────────────────────

  private static readonly EMPTY_ACQUISITION = {
    newClients: 0,
    returningClients: 0,
    newRevenue: 0,
    returningRevenue: 0,
    bySource: [] as Array<{ source: string; count: number; revenue: number }>,
    firstVisitCohort: [] as Array<{ periodStart: string; newClients: number; revenue: number }>,
  };
  private static readonly EMPTY_RETENTION = {
    returningRate: 0,
    avgLtv: 0,
    avgDaysBetweenVisits: 0,
    repeatPurchaseDistribution: [] as Array<{ visits: string; clients: number }>,
  };
  private static readonly EMPTY_CALLS = {
    total: 0,
    incoming: 0,
    outgoing: 0,
    missed: 0,
    notCalledBack: 0,
    answerRate: 0,
    funnel: {
      uniqueCallers: 0,
      arrivedClients: 0,
      createdChecks: 0,
      conversionRate: 0,
      repeatClients: 0,
      revenue: 0,
    },
  };
  private static readonly EMPTY_REVIEWS = {
    total: 0,
    avgRating: 0,
    positive: 0,
    negative: 0,
    responseRate: 0,
    conversionRate: 0,
    tokensSent: 0,
    tokensResponded: 0,
  };
  private static readonly EMPTY_LOYALTY = {
    enabled: false,
    accrualPercent: 0,
    participants: 0,
    pointsAccrued: 0,
    pointsRedeemed: 0,
    accrualCount: 0,
    redemptionCount: 0,
    outstandingBalance: 0,
  };
  private static readonly EMPTY_REVENUE = {
    bySource: [] as Array<{ source: string; checks: number; revenue: number }>,
    byMaster: [] as Array<{ masterId: string | null; masterName: string; checks: number; revenue: number }>,
  };
  private static readonly EMPTY_TRENDS = {
    weekly: [] as MarketingTrendPoint[],
    monthly: [] as MarketingTrendPoint[],
  };

  async getMarketingReport(tenantID: string, query: { from?: string; to?: string }) {
    const from = this.safeDate(query?.from, this.firstOfMonth());
    const to = this.safeDate(query?.to, this.todayISO());

    const [acquisition, retention, calls, reviews, loyalty, revenue, trends] = await Promise.all([
      this.marketingAcquisition(tenantID, from, to).catch(() => ReportsService.EMPTY_ACQUISITION),
      this.retentionForWindow(tenantID, from, to).catch(() => ReportsService.EMPTY_RETENTION),
      this.marketingCalls(tenantID, from, to).catch(() => ReportsService.EMPTY_CALLS),
      this.periodReviews(tenantID, from, to).catch(() => ReportsService.EMPTY_REVIEWS),
      this.marketingLoyalty(tenantID, from, to).catch(() => ReportsService.EMPTY_LOYALTY),
      this.marketingRevenue(tenantID, from, to).catch(() => ReportsService.EMPTY_REVENUE),
      this.marketingTrends(tenantID, from, to).catch(() => ReportsService.EMPTY_TRENDS),
    ]);

    return { period: { from, to }, acquisition, retention, calls, reviews, loyalty, revenue, trends };
  }

  /**
   * Acquisition: reuse clientsNewVsReturning for the new/returning split, then
   * ADD a by-source breakdown of the NEW clients, grouped by clients.source.
   *
   * v3.0.1 ФИЧА 5 — «новый» теперь = запись клиента СОЗДАНА в периоде
   * (clients.created_at ∈ [from,to]), а НЕ «первый чек в периоде» (согласовано с
   * владельцем). bySource и firstVisitCohort ниже используют то же определение,
   * чтобы весь раздел «Отчёты → привлечение» был консистентен. null/empty source
   * → «Без источника». Per-source revenue = Σ чеков этих клиентов в периоде.
   */
  private async marketingAcquisition(tenantID: string, from: string, to: string) {
    const base = await this.clientsNewVsReturning(tenantID, { from, to });

    const { rows } = await this.pool.query(
      `WITH new_clients AS (
         -- НОВЫЕ = записи клиентов, заведённые в периоде (определение владельца).
         SELECT id AS client_id
           FROM clients
          WHERE tenant_id = $1 AND created_at::date BETWEEN $2::date AND $3::date
       )
       SELECT
         COALESCE(NULLIF(btrim(cl.source), ''), 'Без источника') AS source,
         COUNT(DISTINCT nc.client_id) AS count,
         -- Без гарантии (M8): выручка по источнику — только реальные деньги,
         -- как в revenue.bySource/trends этого же отчёта.
         COALESCE(SUM(ch.total_revenue), 0) AS revenue
       FROM new_clients nc
       JOIN clients cl ON cl.id = nc.client_id AND cl.tenant_id = $1
       LEFT JOIN checks ch
         ON ch.client_id = nc.client_id
        AND ch.tenant_id = $1
        AND ch.is_deferred = false
        AND ch.deleted_at IS NULL
        AND ch.payment_method IS DISTINCT FROM 'warranty'
        AND ch.date::date BETWEEN $2::date AND $3::date
       GROUP BY COALESCE(NULLIF(btrim(cl.source), ''), 'Без источника')
       ORDER BY count DESC, revenue DESC`,
      [tenantID, from, to],
    );

    // Cohort of NEW clients bucketed by the ISO WEEK they were ADDED TO THE BASE
    // (clients.created_at — v3.0.1 ФИЧА 5, was «first ever check»), with the
    // revenue of their in-window checks. Lets the client draw "how many new
    // clients were added each week and what they spent". date_trunc('week') →
    // Monday-start ISO weeks.
    const { rows: cohortRows } = await this.pool.query(
      `WITH new_clients AS (
         SELECT id AS client_id, created_at AS created_date
           FROM clients
          WHERE tenant_id = $1 AND created_at::date BETWEEN $2::date AND $3::date
       )
       SELECT
         to_char(date_trunc('week', nc.created_date), 'YYYY-MM-DD') AS period_start,
         COUNT(DISTINCT nc.client_id) AS new_clients,
         COALESCE(SUM(ch.total_revenue) FILTER (WHERE ch.payment_method IS DISTINCT FROM 'warranty'), 0) AS revenue
       FROM new_clients nc
       LEFT JOIN checks ch
         ON ch.client_id = nc.client_id
        AND ch.tenant_id = $1
        AND ch.is_deferred = false
        AND ch.deleted_at IS NULL
        AND ch.date::date BETWEEN $2::date AND $3::date
       GROUP BY date_trunc('week', nc.created_date)
       ORDER BY date_trunc('week', nc.created_date)`,
      [tenantID, from, to],
    );

    return {
      newClients: base.newCount,
      returningClients: base.returningCount,
      newRevenue: base.newRevenue,
      returningRevenue: base.returningRevenue,
      bySource: rows.map((r) => ({
        source: r.source as string,
        count: parseInt(r.count, 10) || 0,
        revenue: parseFloat(r.revenue) || 0,
      })),
      firstVisitCohort: cohortRows.map((r) => ({
        periodStart: r.period_start as string,
        newClients: parseInt(r.new_clients, 10) || 0,
        revenue: parseFloat(r.revenue) || 0,
      })),
    };
  }

  /**
   * Windowed retention: identical aggregate logic to `retention()`, but the
   * client set is selected by «had ≥1 check inside [from,to]» instead of a
   * rolling now()-interval. Per-client aggregates (visit_count, ltv,
   * first/last date) stay ALL-TIME, so returningRate/avgLtv/avgDaysBetween
   * describe the lifetime behaviour of clients who were active in the window.
   */
  private async retentionForWindow(tenantID: string, from: string, to: string) {
    const { rows } = await this.pool.query(
      `WITH visits AS (
         SELECT client_id, COUNT(*) AS visit_count, SUM(total_revenue) AS ltv,
                MIN(date) AS first_date, MAX(date) AS last_date
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL
            AND deleted_at IS NULL
          GROUP BY client_id
       ),
       window_clients AS (
         SELECT DISTINCT client_id
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false
            AND deleted_at IS NULL
            AND date::date BETWEEN $2::date AND $3::date
            AND client_id IS NOT NULL
       )
       SELECT
         COUNT(*) AS total_in_window,
         COUNT(*) FILTER (WHERE v.visit_count > 1) AS returning,
         COALESCE(AVG(v.ltv), 0) AS avg_ltv,
         COALESCE(AVG(EXTRACT(EPOCH FROM (v.last_date - v.first_date)) / 86400 / NULLIF(v.visit_count - 1, 0)), 0) AS avg_days_between
       FROM window_clients wc
       JOIN visits v ON v.client_id = wc.client_id`,
      [tenantID, from, to],
    );
    const r = rows[0];
    const total = parseInt(r?.total_in_window) || 0;
    const returning = parseInt(r?.returning) || 0;

    // Repeat-purchase distribution: among clients active in the window, how many
    // have made 1 / 2 / 3 / 4 / 5+ lifetime (non-deferred) visits. Fixed bucket
    // labels ('1'..'4','5+') so the client can render a stable histogram; an
    // empty bucket is simply absent from the array.
    const { rows: distRows } = await this.pool.query(
      `WITH visits AS (
         SELECT client_id, COUNT(*) AS visit_count
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL
            AND deleted_at IS NULL
          GROUP BY client_id
       ),
       window_clients AS (
         SELECT DISTINCT client_id
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false
            AND deleted_at IS NULL
            AND date::date BETWEEN $2::date AND $3::date
            AND client_id IS NOT NULL
       )
       SELECT
         CASE WHEN v.visit_count >= 5 THEN '5+' ELSE v.visit_count::text END AS bucket,
         COUNT(*) AS clients
       FROM window_clients wc
       JOIN visits v ON v.client_id = wc.client_id
       GROUP BY CASE WHEN v.visit_count >= 5 THEN '5+' ELSE v.visit_count::text END
       ORDER BY MIN(v.visit_count)`,
      [tenantID, from, to],
    );

    return {
      returningRate: total > 0 ? Math.round((returning / total) * 1000) / 10 : 0,
      avgLtv: Math.round(parseFloat(r?.avg_ltv) || 0),
      avgDaysBetweenVisits: Math.round(parseFloat(r?.avg_days_between) || 0),
      repeatPurchaseDistribution: distRows.map((d) => ({
        visits: d.bucket as string,
        clients: parseInt(d.clients, 10) || 0,
      })),
    };
  }

  /**
   * Calls section: reuse getCallFunnel (sms_history → checks) for the funnel and
   * CallsService.getCalls for the raw summary (МоиЗвонки live proxy / stored
   * Mango). getCalls throws when no telephony integration is configured — that
   * is caught here and degraded to zero counts (the funnel still returns from
   * sms_history). answerRate = answered / total, answered = total − missed.
   */
  private async marketingCalls(tenantID: string, from: string, to: string) {
    const funnel = await this.getCallFunnel(tenantID, { dateFrom: from, dateTo: to });

    let summary = { total: 0, incoming: 0, outgoing: 0, missed: 0, notCalledBack: 0 };
    try {
      const res = await this.callsService.getCalls(tenantID, { dateFrom: from, dateTo: to });
      summary = res.summary;
    } catch {
      // No МоиЗвонки/Mango integration (or provider error) → zero call counts;
      // the funnel below is independent (sms_history-derived) and still shows.
    }

    const answered = Math.max(summary.total - summary.missed, 0);
    const answerRate = summary.total > 0 ? Math.round((answered / summary.total) * 1000) / 10 : 0;

    return {
      total: summary.total,
      incoming: summary.incoming,
      outgoing: summary.outgoing,
      missed: summary.missed,
      notCalledBack: summary.notCalledBack,
      answerRate,
      funnel: {
        uniqueCallers: funnel.uniqueCallers,
        arrivedClients: funnel.arrivedClients,
        createdChecks: funnel.createdChecks,
        conversionRate: funnel.conversionRate,
        repeatClients: funnel.repeatClients,
        revenue: funnel.totalRevenue,
      },
    };
  }

  /**
   * Period-aware review KPIs (the existing marketing getDashboard is all-time).
   * review_responses are counted by created_at within [from,to]; review_tokens
   * are counted by created_at within the same window (tokensResponded = those
   * tokens that were also used → responded ⊆ sent, keeping responseRate ≤ 100%).
   * Semantics otherwise mirror getDashboard (positive ≥4, negative ≤3,
   * conversionRate = redirected/positive).
   */
  private async periodReviews(tenantID: string, from: string, to: string) {
    const {
      rows: [stats],
    } = await this.pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(AVG(rating), 0) AS avg_rating,
              COUNT(*) FILTER (WHERE rating >= 4) AS positive,
              COUNT(*) FILTER (WHERE rating <= 3) AS negative,
              COUNT(*) FILTER (WHERE redirected_to IS NOT NULL) AS redirected
         FROM review_responses
        WHERE tenant_id=$1
          AND created_at >= $2::date
          AND created_at < ($3::date + 1)`,
      [tenantID, from, to],
    );

    const {
      rows: [tokenStats],
    } = await this.pool.query(
      `SELECT COUNT(*) AS sent,
              COUNT(*) FILTER (WHERE used_at IS NOT NULL) AS responded
         FROM review_tokens
        WHERE tenant_id=$1
          AND created_at >= $2::date
          AND created_at < ($3::date + 1)`,
      [tenantID, from, to],
    );

    const total = parseInt(stats.total, 10) || 0;
    const positive = parseInt(stats.positive, 10) || 0;
    const negative = parseInt(stats.negative, 10) || 0;
    const redirected = parseInt(stats.redirected, 10) || 0;
    const sent = parseInt(tokenStats.sent, 10) || 0;
    const responded = parseInt(tokenStats.responded, 10) || 0;

    return {
      total,
      avgRating: Math.round((parseFloat(stats.avg_rating) || 0) * 10) / 10,
      positive,
      negative,
      responseRate: sent > 0 ? Math.round((responded / sent) * 100) : 0,
      conversionRate: positive > 0 && redirected > 0 ? Math.round((redirected / positive) * 100) : 0,
      tokensSent: sent,
      tokensResponded: responded,
    };
  }

  /**
   * Loyalty ROI for the window (loyalty_settings + client_bonuses, migration
   * 083). ONLY real ledger rows:
   *   • pointsAccrued / pointsRedeemed = Σ amount of accrual / redemption
   *     movements CREATED inside [from,to] (a bonus is a money amount).
   *   • redemption value = pointsRedeemed (each redemption row is money paid with
   *     bonus).
   *   • participants = distinct clients with ANY bonus movement in the window.
   *   • outstandingBalance = ALL-TIME Σ(accrual) − Σ(redemption) across the
   *     tenant (the live liability — not window-scoped, a balance is a snapshot).
   * enabled/accrualPercent are copied from loyalty_settings for context. Returns
   * zeros with enabled=false when the tenant never opened loyalty (no settings
   * row) — never fabricated.
   */
  private async marketingLoyalty(tenantID: string, from: string, to: string) {
    const {
      rows: [settings],
    } = await this.pool.query(`SELECT enabled, accrual_percent FROM loyalty_settings WHERE tenant_id=$1`, [tenantID]);

    // Window movements (accrual vs redemption), by created_at.
    const {
      rows: [win],
    } = await this.pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type='accrual'), 0)    AS accrued,
         COALESCE(SUM(amount) FILTER (WHERE type='redemption'), 0) AS redeemed,
         COUNT(*) FILTER (WHERE type='accrual')                    AS accrual_count,
         COUNT(*) FILTER (WHERE type='redemption')                 AS redemption_count,
         COUNT(DISTINCT client_id)                                 AS participants
       FROM client_bonuses
      WHERE tenant_id=$1
        AND created_at >= $2::date
        AND created_at < ($3::date + 1)`,
      [tenantID, from, to],
    );

    // All-time outstanding bonus liability (balance is a snapshot, not windowed).
    const {
      rows: [bal],
    } = await this.pool.query(
      `SELECT COALESCE(SUM(CASE WHEN type='accrual' THEN amount ELSE -amount END), 0) AS balance
         FROM client_bonuses WHERE tenant_id=$1`,
      [tenantID],
    );

    return {
      enabled: settings?.enabled === true,
      accrualPercent: parseFloat(settings?.accrual_percent) || 0,
      participants: parseInt(win?.participants, 10) || 0,
      pointsAccrued: Math.round((parseFloat(win?.accrued) || 0) * 100) / 100,
      pointsRedeemed: Math.round((parseFloat(win?.redeemed) || 0) * 100) / 100,
      accrualCount: parseInt(win?.accrual_count, 10) || 0,
      redemptionCount: parseInt(win?.redemption_count, 10) || 0,
      outstandingBalance: Math.round((parseFloat(bal?.balance) || 0) * 100) / 100,
    };
  }

  /**
   * Revenue attribution for the window (checks only). Two independent groupings:
   *   • bySource — Σ revenue of in-window checks grouped by the CLIENT's
   *     clients.source (null/empty → «Без источника»). Retail / phoneless
   *     clients still count (this is revenue, not a segment).
   *   • byMaster — Σ revenue grouped by checks.master_id → users.full_name
   *     (null master → «Без мастера»).
   * Both EXCLUDE warranty checks (payment_method='warranty' = loss, not revenue).
   * Tenant-scoped, non-deferred, not deleted.
   */
  private async marketingRevenue(tenantID: string, from: string, to: string) {
    const { rows: bySourceRows } = await this.pool.query(
      `SELECT
         COALESCE(NULLIF(btrim(cl.source), ''), 'Без источника') AS source,
         COUNT(*)                       AS checks,
         COALESCE(SUM(ch.total_revenue), 0) AS revenue
       FROM checks ch
       LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = $1
      WHERE ch.tenant_id=$1 AND ch.is_deferred=false AND ch.deleted_at IS NULL
        AND ch.payment_method IS DISTINCT FROM 'warranty'
        AND ch.date::date BETWEEN $2::date AND $3::date
      GROUP BY COALESCE(NULLIF(btrim(cl.source), ''), 'Без источника')
      ORDER BY revenue DESC`,
      [tenantID, from, to],
    );

    const { rows: byMasterRows } = await this.pool.query(
      `SELECT
         ch.master_id                          AS master_id,
         COALESCE(u.full_name, 'Без мастера')  AS master_name,
         COUNT(*)                              AS checks,
         COALESCE(SUM(ch.total_revenue), 0)    AS revenue
       FROM checks ch
       LEFT JOIN users u ON u.id = ch.master_id AND u.tenant_id = $1
      WHERE ch.tenant_id=$1 AND ch.is_deferred=false AND ch.deleted_at IS NULL
        AND ch.payment_method IS DISTINCT FROM 'warranty'
        AND ch.date::date BETWEEN $2::date AND $3::date
      GROUP BY ch.master_id, u.full_name
      ORDER BY revenue DESC`,
      [tenantID, from, to],
    );

    return {
      bySource: bySourceRows.map((r) => ({
        source: r.source as string,
        checks: parseInt(r.checks, 10) || 0,
        revenue: parseFloat(r.revenue) || 0,
      })),
      byMaster: byMasterRows.map((r) => ({
        masterId: (r.master_id as string) ?? null,
        masterName: r.master_name as string,
        checks: parseInt(r.checks, 10) || 0,
        revenue: parseFloat(r.revenue) || 0,
      })),
    };
  }

  /**
   * Weekly AND monthly time-series over [from,to] for the chart-able KPIs. Each
   * bucket carries: newClients (first-ever visit in the bucket), revenue
   * (non-warranty in-window checks), returningRate (% of bucket-active clients
   * with >1 lifetime visit), calls (sms_history contact rows — the accurate
   * per-bucket proxy; the live-call provider isn't historically queryable per
   * bucket), reviews (review_responses created in the bucket). Buckets with no
   * activity are still emitted with zeros over the FULL window so the client can
   * draw a continuous line. `granularity` = 'week' | 'month' (date_trunc).
   */
  private async marketingTrendSeries(
    tenantID: string,
    from: string,
    to: string,
    granularity: 'week' | 'month',
  ): Promise<MarketingTrendPoint[]> {
    const { rows } = await this.pool.query(
      `WITH buckets AS (
         SELECT generate_series(
                  date_trunc($4, $2::timestamptz),
                  date_trunc($4, $3::timestamptz),
                  ('1 ' || $4)::interval
                ) AS b
       ),
       lifetime_visits AS (
         SELECT client_id, COUNT(*) AS visit_count
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL AND deleted_at IS NULL
          GROUP BY client_id
       ),
       -- New clients per bucket: client ADDED TO BASE (clients.created_at) in the
       -- bucket — v3.0.1 ФИЧА 5 (was «first-ever visit»), so trends.newClients
       -- matches the corrected new-vs-returning definition.
       new_by_bucket AS (
         SELECT date_trunc($4, created_at) AS b, COUNT(*) AS new_clients
           FROM clients
          WHERE tenant_id=$1 AND created_at::date BETWEEN $2::date AND $3::date
          GROUP BY date_trunc($4, created_at)
       ),
       -- Revenue per bucket (non-warranty in-window checks).
       rev_by_bucket AS (
         SELECT date_trunc($4, date) AS b,
                COALESCE(SUM(total_revenue), 0) AS revenue
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND deleted_at IS NULL
            AND payment_method IS DISTINCT FROM 'warranty'
            AND date::date BETWEEN $2::date AND $3::date
          GROUP BY date_trunc($4, date)
       ),
       -- Returning rate per bucket: of the DISTINCT clients active in the bucket,
       -- the share whose lifetime visit_count > 1.
       ret_by_bucket AS (
         SELECT b, COUNT(*) AS active, COUNT(*) FILTER (WHERE visit_count > 1) AS returning
           FROM (
             SELECT DISTINCT date_trunc($4, ch.date) AS b, ch.client_id, lv.visit_count
               FROM checks ch
               JOIN lifetime_visits lv ON lv.client_id = ch.client_id
              WHERE ch.tenant_id=$1 AND ch.is_deferred=false AND ch.deleted_at IS NULL
                AND ch.client_id IS NOT NULL
                AND ch.date::date BETWEEN $2::date AND $3::date
           ) d
          GROUP BY b
       ),
       -- Calls per bucket: sms_history contact rows (accurate historical proxy).
       calls_by_bucket AS (
         SELECT date_trunc($4, created_at) AS b, COUNT(*) AS calls
           FROM sms_history
          WHERE tenant_id=$1 AND created_at::date BETWEEN $2::date AND $3::date
          GROUP BY date_trunc($4, created_at)
       ),
       -- Reviews per bucket: review_responses created in the bucket.
       reviews_by_bucket AS (
         SELECT date_trunc($4, created_at) AS b, COUNT(*) AS reviews
           FROM review_responses
          WHERE tenant_id=$1 AND created_at::date BETWEEN $2::date AND $3::date
          GROUP BY date_trunc($4, created_at)
       )
       SELECT
         to_char(bk.b, 'YYYY-MM-DD') AS period_start,
         COALESCE(nb.new_clients, 0) AS new_clients,
         COALESCE(rb.revenue, 0)     AS revenue,
         CASE WHEN COALESCE(rt.active, 0) > 0
              THEN round((rt.returning::numeric / rt.active) * 1000) / 10
              ELSE 0 END            AS returning_rate,
         COALESCE(cb.calls, 0)       AS calls,
         COALESCE(rvb.reviews, 0)    AS reviews
       FROM buckets bk
       LEFT JOIN new_by_bucket     nb  ON nb.b  = bk.b
       LEFT JOIN rev_by_bucket     rb  ON rb.b  = bk.b
       LEFT JOIN ret_by_bucket     rt  ON rt.b  = bk.b
       LEFT JOIN calls_by_bucket   cb  ON cb.b  = bk.b
       LEFT JOIN reviews_by_bucket rvb ON rvb.b = bk.b
       ORDER BY bk.b`,
      [tenantID, from, to, granularity],
    );

    return rows.map((r) => ({
      periodStart: r.period_start as string,
      newClients: parseInt(r.new_clients, 10) || 0,
      revenue: parseFloat(r.revenue) || 0,
      returningRate: parseFloat(r.returning_rate) || 0,
      calls: parseInt(r.calls, 10) || 0,
      reviews: parseInt(r.reviews, 10) || 0,
    }));
  }

  private async marketingTrends(tenantID: string, from: string, to: string) {
    const [weekly, monthly] = await Promise.all([
      this.marketingTrendSeries(tenantID, from, to, 'week'),
      this.marketingTrendSeries(tenantID, from, to, 'month'),
    ]);
    return { weekly, monthly };
  }

  async returnsSummaryForDashboard(tenantID: string) {
    const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString();
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(refund_amount), 0) AS sum
         FROM check_returns
        WHERE tenant_id=$1 AND created_at >= $2`,
      [tenantID, todayStart],
    );
    return {
      returnsToday: parseInt(rows[0]?.cnt) || 0,
      returnsAmount: parseFloat(rows[0]?.sum) || 0,
    };
  }
}
