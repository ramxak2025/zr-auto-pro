import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { ttlCache } from '../common/ttl-cache';
import { userHasPermission } from '../common/guards/permissions.guard';
import { actorPointId, pointCacheSegment, pointFilterSql } from '../common/point-scope';
import { checkMoneyBaseWhere, checkProfitExpr, checkRevenueExpr } from '../common/check-money-sql';
import { motivationPointFilterSql, premiumCashAmountExpr, premiumMonthExpr } from '../common/salary-extras-sql';
import {
  getTenantTimezone,
  getZonedParts,
  startOfDayInZone,
  startOfMonthInZone,
  startOfMonthInZoneOffset,
  zonedMonthKey,
} from '../common/timezone';
import { previousComparableWindow } from '../common/period-compare';
import { CallsService } from '../calls/calls.service';

/** Актор запроса «Движения денег» — источник охвата (свои / все) и атрибуции. */
interface CashFlowActor {
  userID: string;
  tenantID: string;
  role?: string;
  permissions?: Record<string, boolean>;
  /** Филиал СЕССИИ (163), null = у тенанта нет филиалов. Разбор — actorPointId(). */
  currentPointId?: string | null;
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

// Бизнес-таймзона БОЛЬШЕ НЕ КОНСТАНТА: она берётся из tenants.timezone
// (миграция 157) один раз на запрос — getTenantTimezone кеширует значение на 5
// минут. Сервер и Postgres живут в UTC, но владелец считает кассу по СВОЕМУ
// календарному дню: чек, пробитый сразу после местной полуночи, обязан попадать
// в «сегодня», а не во «вчера». Все дневные группировки и границы периодов в
// отчётах режутся полуинтервалом [from 00:00, to+1 00:00) местного времени.
//
// В SQL пояс уходит ПАРАМЕТРОМ (`AT TIME ZONE $n::text`), а не склейкой строки:
// значение приходит из БД и провалидировано белым списком, но параметризация —
// единственная защита, которая не зависит от того, кто и как заполнил колонку.

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

  async getFinancial(tenantID: string, query: any, pointId: string | null = null) {
    const dateFrom = this.safeDate(query?.dateFrom, this.firstOfMonth());
    const dateTo = this.safeDate(query?.dateTo, this.todayISO());
    // Пояс тенанта — ОДИН раз на запрос, дальше уходит параметром в оба запроса.
    const tz = await getTenantTimezone(this.pool, tenantID);

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
    // Границы периода — полуинтервал [from, to+1) в поясе тенанта ($4).
    // ФИЛИАЛ (156/160): финотчёт филиала — деньги ТОЛЬКО этого филиала.
    // Точки нет (у тенанта нет филиалов — одноточечный автосервис) → фильтра нет, запрос
    // дословно прежний.
    const checkParams: any[] = [tenantID, dateFrom, dateTo, tz];
    const checkPointFilter = pointFilterSql(null, pointId, checkParams);
    const { rows } = await this.pool.query(
      // Выручка — ИЗ ОБЩЕГО МОДУЛЯ ФОРМУЛ (common/check-money-sql): раньше здесь
      // стояла своя копия правила «гарантия не выручка», и таких копий по
      // отчётам накопилось несколько. Пока формула физически одна, разъехаться
      // экранам не на чем. Остальные колонки (себестоимость/зарплата/убыток по
      // гарантии) — FILTER'ы того же правила, они живут только здесь.
      `SELECT
         COALESCE(SUM(${checkRevenueExpr()}), 0) as revenue,
         COALESCE(SUM(product_cost_total) FILTER (WHERE payment_method IS DISTINCT FROM 'warranty'), 0) as product_cost,
         COALESCE(SUM(service_salary_total + COALESCE(product_salary_total, 0)) FILTER (WHERE payment_method IS DISTINCT FROM 'warranty'), 0) as salaries,
         COALESCE(SUM(product_cost_total + service_salary_total + COALESCE(product_salary_total, 0)) FILTER (WHERE payment_method = 'warranty'), 0) as warranty_loss,
         COUNT(*) as check_count
       FROM checks
       WHERE tenant_id = $1
         AND date >= $2::date::timestamp AT TIME ZONE $4::text
         AND date < ($3::date + 1)::timestamp AT TIME ZONE $4::text
         AND ${checkMoneyBaseWhere()}${checkPointFilter}`,
      checkParams,
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
    //
    // Round 14 (149, семантика уточнена adversarial-ревью) — «за какой месяц»:
    // расход с period_month относится к НАЗНАЧЕННОМУ месяцу и попадает в отчёт
    // ТОЛЬКО когда запрошенный диапазон покрывает этот месяц ЦЕЛИКОМ
    // (1-е…последнее число). В неполномесячные срезы (день/неделя/15.07–15.08)
    // period-расход НЕ входит вовсе — ни по периоду, ни по дате факта: иначе
    // каждый под-диапазон месяца включал бы его целиком и сумма недель
    // задваивала бы месяц (инвариант: под-диапазоны не двоят, месяц полон).
    // Строки без периода (дефолт клиентов) — прежний точный дата-диапазон,
    // байт-в-байт. Пример: выплата 5 августа «за июль» режет прибыль отчёта за
    // ВЕСЬ июль, не видна ни в одном августовском/недельном срезе; касса
    // (getCashFlow) видит её 5 августа — по дате факта, как и лента «Расходы».
    // ФИЛИАЛ (161): у `expenses` теперь ЕСТЬ колонка точки, и расход принадлежит
    // тому филиалу, на котором возник. Фильтр обязателен: выручка и
    // себестоимость уже отрезаны точкой, а расходы вычитались по ВСЕЙ сети —
    // филиал А с расходами 100 000 показывал чистую прибыль, уменьшенную ещё и
    // на 400 000 филиала Б. Способ фильтрации — ТОТ ЖЕ pointFilterSql, что в
    // ExpensesService.getAll, поэтому сумма отчёта сходится с лентой «Расходы».
    // Плейсхолдер кладётся ПОСЛЕДНИМ в собственный массив ($5): у запроса выше
    // своя нумерация, и общий массив на два разных запроса развалил бы оба.
    const expParams: any[] = [tenantID, dateFrom, dateTo, tz];
    const expPointFilter = pointFilterSql('e', pointId, expParams);
    const { rows: expRows } = await this.pool.query(
      `SELECT COALESCE(SUM(e.amount), 0) as total
         FROM expenses e
         LEFT JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.tenant_id = $1
          AND (
            (e.period_month IS NULL
              AND e.date >= $2::date::timestamp AT TIME ZONE $4::text
              AND e.date < ($3::date + 1)::timestamp AT TIME ZONE $4::text)
            OR (e.period_month IS NOT NULL
              AND to_date(e.period_month || '-01', 'YYYY-MM-DD') >= $2::date
              AND (to_date(e.period_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date <= $3::date)
          )
          AND COALESCE(e.approval_status, 'approved') = 'approved'
          AND COALESCE(ec.name, '') <> 'Зарплата'${expPointFilter}`,
      expParams,
    );
    const otherExpenses = parseFloat(expRows[0]?.total) || 0;

    // Премии деньгами и мотивация — ТРЕТИЙ вид зарплатного начисления рядом с
    // чековым (`salaries`) и выплатным (категория «Зарплата», исключена выше).
    // Обоснование и доказательство отсутствия двойного счёта —
    // common/salary-extras-sql.ts.
    const extras = await this.salaryExtrasForPeriod(tenantID, dateFrom, dateTo, tz, pointId);

    // Гарантия вычитается ОТДЕЛЬНЫМ термом (warrantyLoss). productCost/salaries
    // выше уже НЕ содержат гарантийных чеков (FILTER), поэтому двойного вычета
    // запчастей/зарплаты нет.
    const netProfit = grossProfit - salaries - otherExpenses - warrantyLoss - extras.total;

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
      // Отдельными строками, чтобы владелец видел, из чего сложилась разница
      // между «зарплатой по чекам» и фактически выданными деньгами. Обе УЖЕ
      // вычтены из netProfit — суммировать их с netProfit повторно нельзя.
      premiums: extras.premiums,
      motivation: extras.motivation,
      grossProfit,
      netProfit,
      checkCount: parseInt(r.check_count) || 0,
    };
  }

  /**
   * Премии деньгами + мотивация за период — зарплатные начисления, которых нет
   * ни в чековых колонках, ни в расходах (см. common/salary-extras-sql.ts).
   *
   * ОТНЕСЕНИЕ К ПЕРИОДУ — ДОСЛОВНО КАК У РАСХОДОВ В getFinancial:
   *   • премия БЕЗ назначенного месяца — по дате факта, местный полуинтервал
   *     [from 00:00, to+1 00:00);
   *   • премия С назначенным месяцем (period_month_year) входит ТОЛЬКО когда
   *     диапазон покрывает этот месяц ЦЕЛИКОМ — иначе сумма недель месяца
   *     задваивала бы его (тот же инвариант «под-диапазоны не двоят»);
   *   • мусор в period_month_year трактуется как отсутствие периода (regex —
   *     то же, что в SalaryService.premiumMonthExpr): без этого to_date упал бы
   *     на кривой строке и уронил весь отчёт.
   * Мотивация периода не имеет вовсе — только дата начисления (accrued_at).
   */
  private async salaryExtrasForPeriod(
    tenantID: string,
    dateFrom: string,
    dateTo: string,
    tz: string,
    pointId: string | null,
  ): Promise<{ premiums: number; motivation: number; total: number }> {
    // Нормализованный период премии: кривое значение = «периода нет».
    const premPeriod = `CASE WHEN sp.period_month_year ~ '^\\d{4}-\\d{2}$' THEN sp.period_month_year END`;
    const premParams: any[] = [tenantID, dateFrom, dateTo, tz];
    const premPointFilter = pointFilterSql('sp', pointId, premParams);
    const { rows: premRows } = await this.pool.query(
      `SELECT COALESCE(SUM(${premiumCashAmountExpr('sp')}), 0) AS total
         FROM salary_premiums sp
        WHERE sp.tenant_id = $1
          AND (
            (${premPeriod} IS NULL
              AND sp.created_at >= $2::date::timestamp AT TIME ZONE $4::text
              AND sp.created_at < ($3::date + 1)::timestamp AT TIME ZONE $4::text)
            OR (${premPeriod} IS NOT NULL
              AND to_date(${premPeriod} || '-01', 'YYYY-MM-DD') >= $2::date
              AND (to_date(${premPeriod} || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date <= $3::date)
          )${premPointFilter}`,
      premParams,
    );

    const motParams: any[] = [tenantID, dateFrom, dateTo, tz];
    const motPointFilter = motivationPointFilterSql('ma', '$1', pointId, motParams);
    const { rows: motRows } = await this.pool.query(
      `SELECT COALESCE(SUM(ma.amount), 0) AS total
         FROM motivation_accruals ma
        WHERE ma.tenant_id = $1
          AND ma.accrued_at >= $2::date::timestamp AT TIME ZONE $4::text
          AND ma.accrued_at < ($3::date + 1)::timestamp AT TIME ZONE $4::text${motPointFilter}`,
      motParams,
    );

    const premiums = parseFloat(premRows[0]?.total) || 0;
    const motivation = parseFloat(motRows[0]?.total) || 0;
    return { premiums, motivation, total: premiums + motivation };
  }

  /**
   * Те же премии + мотивация, но в РАЗРЕЗАХ ДАШБОРДА (сегодня / текущий месяц /
   * окно сравнения прошлого месяца). Отдельный метод, а не три вызова
   * salaryExtrasForPeriod: у дашборда своя, УЖЕ СУЩЕСТВУЮЩАЯ конвенция
   * отнесения к месяцу (COALESCE(период, месяц факта) = 'YYYY-MM'), и премии
   * обязаны собираться ровно так же, как расходы рядом с ними — иначе
   * netProfitMonth и mtd.netProfit разъедутся на границе месяца.
   *
   * `today` дополнительно требует «премия ЗА ТЕКУЩИЙ месяц» — зеркало exp_today:
   * премия задним числом за июль не имеет права портить «прибыль сегодня».
   * У мотивации периода нет вовсе, поэтому она режется только датами.
   */
  private async salaryExtrasForDashboard(
    tenantID: string,
    pointId: string | null,
    tz: string,
    w: {
      todayStart: string;
      monthStart: string;
      curYm: string;
      prevYm: string;
      prevWindowStart: string;
      prevWindowEnd: string;
    },
  ): Promise<{ today: number; month: number; prevWindow: number }> {
    const premEff = premiumMonthExpr('sp', '$5::text');
    const premParams: any[] = [tenantID, w.todayStart, w.curYm, w.prevYm, tz, w.prevWindowEnd, w.prevWindowStart];
    const premPointFilter = pointFilterSql('sp', pointId, premParams);
    const cash = premiumCashAmountExpr('sp');
    const { rows: premRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN sp.created_at >= $2 AND ${premEff} = $3 THEN ${cash} END), 0) AS prem_today,
         COALESCE(SUM(CASE WHEN ${premEff} = $3 THEN ${cash} END), 0) AS prem_month,
         COALESCE(SUM(CASE WHEN ${premEff} = $4 AND sp.created_at >= $7 AND sp.created_at <= $6 THEN ${cash} END), 0) AS prem_prev
       FROM salary_premiums sp
      WHERE sp.tenant_id = $1${premPointFilter}`,
      premParams,
    );

    const motParams: any[] = [tenantID, w.todayStart, w.monthStart, w.prevWindowStart, w.prevWindowEnd];
    const motPointFilter = motivationPointFilterSql('ma', '$1', pointId, motParams);
    const { rows: motRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN ma.accrued_at >= $2 THEN ma.amount END), 0) AS mot_today,
         COALESCE(SUM(CASE WHEN ma.accrued_at >= $3 THEN ma.amount END), 0) AS mot_month,
         COALESCE(SUM(CASE WHEN ma.accrued_at >= $4 AND ma.accrued_at <= $5 THEN ma.amount END), 0) AS mot_prev
       FROM motivation_accruals ma
      WHERE ma.tenant_id = $1${motPointFilter}`,
      motParams,
    );

    const num = (v: unknown) => parseFloat(String(v)) || 0;
    return {
      today: num(premRows[0]?.prem_today) + num(motRows[0]?.mot_today),
      month: num(premRows[0]?.prem_month) + num(motRows[0]?.mot_month),
      prevWindow: num(premRows[0]?.prem_prev) + num(motRows[0]?.mot_prev),
    };
  }

  /**
   * Отчёт «по меткам» (Round 12 #9, миграция 140): GET /reports/tags →
   * [{tagId, name, color, checksCount, revenue, profit}], прибыль по убыванию.
   *
   * КОНВЕНЦИЯ ПРИБЫЛИ — ЧЕКОВАЯ (per-check), та же, что в dashboardV2
   * (profit_today/profit_month) и в основе getFinancial:
   *   • только проведённые живые чеки: is_deferred=false AND deleted_at IS NULL;
   *   • границы периода — полуинтервал [from, to+1) в поясе тенанта, зеркально
   *     getFinancial — «чеки за период» сходятся с журналом;
   *   • revenue = SUM(total_revenue) БЕЗ гарантийных чеков (warranty = убыток,
   *     не выручка — ITEM 2);
   *   • profit: для обычного чека — сохранённый checks.profit (выручка −
   *     себестоимость − зарплатные начисления, уже с учётом возвратов: возврат
   *     корректирует total_revenue/profit строки чека реверсом); для
   *     гарантийного — −(product_cost_total + service_salary_total +
   *     product_salary_total), как в dashboardV2.
   * Общие расходы тенанта (аренда и т.п.) на метки НЕ раскладываются — их
   * нельзя атрибутировать конкретной метке; это прибыль ДО общих расходов.
   * Архивные метки в отчёт ВХОДЯТ, если их чеки попали в период (архив не
   * ломает историю). Метки без чеков за период не возвращаются вовсе.
   */
  async getTagAnalytics(tenantID: string, query: any, pointId: string | null = null) {
    const dateFrom = this.safeDate(query?.dateFrom, this.firstOfMonth());
    const dateTo = this.safeDate(query?.dateTo, this.todayISO());
    const tz = await getTenantTimezone(this.pool, tenantID);

    // ФИЛИАЛ (156/160): отчёт по меткам — чеки текущего филиала, как журнал.
    const tagParams: any[] = [tenantID, dateFrom, dateTo, tz];
    const tagPointFilter = pointFilterSql('ch', pointId, tagParams);
    const { rows } = await this.pool.query(
      // Выручка и прибыль — ИЗ ОБЩЕГО МОДУЛЯ (common/check-money-sql). Здесь
      // лежала дословная копия обеих формул: и «гарантия не выручка», и
      // «прибыль гарантийного = минус запчасти и зарплата мастера». Копия
      // ровно того сорта, из-за которого правило уже трижды разъезжалось между
      // экранами — заменена вызовом.
      `SELECT d.id AS tag_id, d.name, d.color,
              COUNT(*) AS checks_count,
              COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS revenue,
              COALESCE(SUM(${checkProfitExpr('ch')}), 0) AS profit
         FROM check_tag_links tl
         JOIN check_tag_defs d ON d.id = tl.tag_id
         JOIN checks ch ON ch.id = tl.check_id AND ch.tenant_id = tl.tenant_id
        WHERE tl.tenant_id = $1
          AND ${checkMoneyBaseWhere('ch')}
          AND ch.date >= $2::date::timestamp AT TIME ZONE $4::text
          AND ch.date < ($3::date + 1)::timestamp AT TIME ZONE $4::text${tagPointFilter}
        GROUP BY d.id, d.name, d.color
        ORDER BY profit DESC, lower(d.name)`,
      tagParams,
    );

    return rows.map((r) => ({
      tagId: r.tag_id,
      name: r.name,
      color: r.color ?? null,
      checksCount: parseInt(r.checks_count) || 0,
      revenue: parseFloat(r.revenue) || 0,
      profit: parseFloat(r.profit) || 0,
    }));
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
    const tz = await getTenantTimezone(this.pool, tenantID);

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
         AND sm.created_at >= $2::date::timestamp AT TIME ZONE $4::text
         AND sm.created_at < ($3::date + 1)::timestamp AT TIME ZONE $4::text
         AND sm.type IN ('defect_transfer','writeoff','defect_return_to_supplier')`,
      [tenantID, dateFrom, dateTo, tz],
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
  async getCallFunnel(tenantID: string, query: { dateFrom?: string; dateTo?: string }, pointId: string | null = null) {
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
    // ФИЛИАЛ (156/160): «доехавшие» и их выручка — чеки ЭТОГО филиала.
    const funnelParams: any[] = [tenantID, dateFrom, dateTo];
    const funnelPointFilter = pointFilterSql('ch', pointId, funnelParams);
    const { rows: checkRows } = await this.pool.query(
      // Выручка воронки — через общий модуль формул: гарантия денег не
      // приносит, и «доехавший по звонку клиент» не имеет права раздувать
      // конверсию в рублях гарантийным ремонтом. Счётчики визитов и чеков
      // гарантию СОХРАНЯЮТ (человек действительно доехал) — поэтому правило
      // применяется выражением суммы, а не фильтром строк.
      `SELECT
         COUNT(DISTINCT ch.client_id) AS arrived_clients,
         COUNT(DISTINCT ch.id) AS created_checks,
         COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS total_revenue
       FROM checks ch
       JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = $1
       WHERE ch.tenant_id = $1
         AND ${checkMoneyBaseWhere('ch')}
         AND ch.date::date BETWEEN $2::date AND $3::date
         AND cl.phone IN (
           SELECT DISTINCT phone FROM sms_history
           WHERE tenant_id = $1
             AND created_at::date BETWEEN $2::date AND $3::date
         )${funnelPointFilter}`,
      funnelParams,
    );

    // Repeat clients (clients with more than 1 check total for this tenant)
    const repeatParams: any[] = [tenantID];
    const repeatPointFilter = pointFilterSql(null, pointId, repeatParams);
    const { rows: repeatRows } = await this.pool.query(
      `SELECT COUNT(DISTINCT client_id) AS repeat_clients
       FROM (
         SELECT client_id, COUNT(*) AS check_count
         FROM checks
         WHERE tenant_id = $1 AND is_deferred = false AND client_id IS NOT NULL
           AND deleted_at IS NULL${repeatPointFilter}
         GROUP BY client_id
         HAVING COUNT(*) > 1
       ) sub`,
      repeatParams,
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
    const tz = await getTenantTimezone(this.pool, tenantID);

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
          collections: 0,
        },
      };
    }

    const params: any[] = [tenantID, dateFrom, dateTo];
    // Пояс тенанта кладём в params ПЕРВЫМ из опциональных: индекс $4 фиксирован
    // для всех четырёх запросов ниже. Дальше по очереди ложатся точка и
    // masterId — каждый адресуется через `$${params.length}` В МОМЕНТ своего
    // push'а, поэтому порядок можно менять только вместе с этими выражениями.
    // ВАЖНО: все три запроса ниже получают ОДИН И ТОТ ЖЕ массив params, а
    // Postgres отвергает лишний параметр — значит каждый положенный параметр
    // обязан быть УПОМЯНУТ в каждом из них (см. точку и мастера).
    params.push(tz);
    const tzIdx = params.length;

    // ── ФИЛИАЛ (156/160) ─────────────────────────────────────────────────
    // «Движение денег» ОБЯЗАНО фильтровать точку так же, как журнал
    // (checks.getAll): раскрытие дня шлёт в журнал те же даты, и разъехавшиеся
    // предикаты означали бы, что сумма дня не сходится со списком дня — для
    // владельца это выглядит как пропавшие деньги. Точка кладётся в params
    // СРАЗУ ПОСЛЕ пояса и ДО masterId, чтобы фиксированные индексы $1..$4
    // остались на месте, а `$${params.length}` у мастера по-прежнему
    // указывал на только что положенное значение.
    const cashFlowPointId = actorPointId(actor);
    const checkPointFilter = pointFilterSql(null, cashFlowPointId, params);
    const refundPointFilter = cashFlowPointId ? ` AND ch.point_id = $${params.length}` : '';
    // Погашения рассрочки атрибутируются филиалу ЧЕРЕЗ ЧЕК-ИСТОЧНИК (у самих
    // installment_payments точки нет — модуль рассрочки правит следующая
    // волна). LEFT JOIN + предикат по ch.point_id даёт ту же семантику, что и
    // фильтр по мастеру ниже: платёж без живого чека-источника не
    // атрибутируется никакому филиалу и в срез филиала не попадает.
    const paidPointFilter = refundPointFilter;
    let masterFilter = '';
    let refundMasterFilter = '';
    if (masterId) {
      params.push(masterId);
      const mIdx = params.length;
      // Решение владельца 2026-07-28: деньги мастера = ТОЛЬКО чеки, где он
      // ГЛАВНЫЙ мастер (checks.master_id). Исполнительство строк услуг
      // (sl.master_id) на кассу НЕ влияет — это механизм ВИДИМОСТИ журнала
      // (checks.getAll, visibility-предикат «свои ИЛИ исполнитель»), а не
      // принадлежности денег. Оба охвата — 'own' и явный фильтр владельца
      // «по сотруднику» — считают ОДНИМ строгим предикатом. Раньше 'own'
      // расширялся executor-OR'ом (волна cashflow M3, 6534cc8) и мастер видел
      // в «Движении денег» чужие чеки, где он лишь исполнитель строки.
      // Раскрытие дня обязано использовать тот же строгий предикат: клиент
      // шлёт ?masterId в checks.getAll, который фильтрует тем же
      // COALESCE-предикатом — поэтому список дня сходится с суммой дня.
      //
      // 155 (решение владельца 5.1) — «деньги видны на том, кто ПРИНЯЛ
      // оплату»: атрибуция по checks.accepted_by (кассир, взявший деньги),
      // fallback master_id для чеков до миграции.
      masterFilter = ` AND COALESCE(accepted_by, master_id) = $${mIdx}`;
      refundMasterFilter = ` AND COALESCE(ch.accepted_by, ch.master_id) = $${mIdx}`;
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
    // День = календарный день В ПОЯСЕ ТЕНАНТА, границы — полуинтервал
    // [from 00:00, to+1 00:00) местного времени: ночные чеки после местной
    // полуночи больше не падают во «вчера», а чек, датированный dateTo+1 (веб
    // пишет голую дату = ровно полночь), в период НЕ попадает. День отдаётся строкой 'YYYY-MM-DD'
    // (to_char), чтобы pg-драйвер не превращал DATE в JS Date с TZ-сдвигом.
    const { rows } = await this.pool.query(
      `SELECT to_char((date AT TIME ZONE $${tzIdx}::text)::date, 'YYYY-MM-DD') as day,
              COALESCE(SUM(cash_amount), 0) as cash,
              COALESCE(SUM(card_amount), 0) as card,
              COALESCE(SUM(CASE WHEN payment_method = 'warranty' THEN total_revenue ELSE 0 END), 0) as warranty,
              COALESCE(SUM(CASE WHEN payment_method = 'warranty' THEN product_cost_total + service_salary_total + COALESCE(product_salary_total, 0) ELSE 0 END), 0) as warranty_loss,
              COALESCE(SUM(CASE WHEN payment_method = 'installment' THEN GREATEST(total_revenue - cash_amount - card_amount, 0) ELSE 0 END), 0) as installment_debt,
              COALESCE(SUM(CASE WHEN payment_method IS DISTINCT FROM 'warranty' THEN total_revenue ELSE 0 END), 0) as total
       FROM checks
       WHERE tenant_id = $1
         AND date >= $2::date::timestamp AT TIME ZONE $${tzIdx}::text
         AND date < ($3::date + 1)::timestamp AT TIME ZONE $${tzIdx}::text
         AND is_deferred = false
         AND deleted_at IS NULL${masterFilter}${checkPointFilter}
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
      `SELECT to_char((p.paid_at AT TIME ZONE $${tzIdx}::text)::date, 'YYYY-MM-DD') as day,
              COALESCE(SUM(p.amount), 0) as paid,
              COALESCE(SUM(CASE WHEN p.payment_method = 'card' THEN p.amount ELSE 0 END), 0) as paid_card,
              COALESCE(SUM(CASE WHEN COALESCE(p.payment_method, 'cash') <> 'card' THEN p.amount ELSE 0 END), 0) as paid_cash
       FROM installment_payments p
       JOIN installment_plans pl ON pl.id = p.plan_id AND pl.tenant_id = $1
       ${masterId || cashFlowPointId ? 'LEFT JOIN checks ch ON ch.id = pl.check_id AND ch.deleted_at IS NULL' : ''}
       WHERE p.tenant_id = $1
         AND p.paid_at >= $2::date::timestamp AT TIME ZONE $${tzIdx}::text
         AND p.paid_at < ($3::date + 1)::timestamp AT TIME ZONE $${tzIdx}::text${paidMasterFilter}${paidPointFilter}
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
      `SELECT to_char((cr.created_at AT TIME ZONE $${tzIdx}::text)::date, 'YYYY-MM-DD') as day,
              COALESCE(SUM(cr.refund_amount), 0) as refunds
       FROM check_returns cr
       JOIN checks ch ON ch.id = cr.check_id AND ch.tenant_id = $1 AND ch.deleted_at IS NULL
       WHERE cr.tenant_id = $1
         AND cr.created_at >= $2::date::timestamp AT TIME ZONE $${tzIdx}::text
         AND cr.created_at < ($3::date + 1)::timestamp AT TIME ZONE $${tzIdx}::text${refundMasterFilter}${refundPointFilter}
       GROUP BY 1
       ORDER BY 1`,
      params,
    );

    // 155 — инкассации за период (справочная строка дня): из ЯЩИКА
    // (cash_collections) + из СЕЙФА (safe_transactions type='collection').
    // По сотруднику не атрибутируются — фильтр masterId на них не влияет.
    //
    // ФИЛИАЛ, ЯЩИК (161). Собственной колонки point_id у cash_collections нет
    // и не будет: строка жёстко привязана к shift_id, а У КАССОВОЙ СМЕНЫ
    // точка есть — филиал инкассации это филиал её смены. Раньше здесь стоял
    // комментарий «у смен точки ещё нет», и строка считалась по ВСЕМУ
    // тенанту: филиал А видел в своём «Движении денег» инкассации филиала Б и
    // читал это как деньги, вынутые из ЕГО кассы.
    // Инкассация без живой смены-источника (shift_id IS NULL) филиалу не
    // атрибутируется — та же конвенция, что у погашений рассрочки без чека.
    //
    // ФИЛИАЛ, СЕЙФ — СОЗНАТЕЛЬНО НЕ РЕЖЕТСЯ, И ЭТО НЕ ЗАБЫТО. Сейф один на
    // компанию (обоснование — в 161: баланс сейфа это running total, и точка
    // у части строк ломает сходимость остатка). Поэтому в филиальном срезе
    // сейфовая часть строки — СЕТЕВАЯ: каждый филиал видит инкассации из
    // общего сейфа целиком. Строка справочная (в total/received не входит),
    // так что «двойного счёта денег» это не создаёт, но при сравнении
    // филиалов между собой сейфовую часть надо помнить.
    const collectionParams: any[] = [tenantID, dateFrom, dateTo, tz];
    const boxCollectionPointFilter = cashFlowPointId
      ? ` AND EXISTS (SELECT 1 FROM cash_shifts cs
                       WHERE cs.id = cc.shift_id AND cs.tenant_id = $1 AND cs.point_id = $5)`
      : '';
    if (cashFlowPointId) collectionParams.push(cashFlowPointId);
    const { rows: collectionRows } = await this.pool.query(
      `SELECT day, COALESCE(SUM(amount), 0) AS collections FROM (
         SELECT to_char((cc.collected_at AT TIME ZONE $4::text)::date, 'YYYY-MM-DD') AS day, cc.amount
           FROM cash_collections cc
          WHERE cc.tenant_id = $1
            AND cc.collected_at >= $2::date::timestamp AT TIME ZONE $4::text
            AND cc.collected_at < ($3::date + 1)::timestamp AT TIME ZONE $4::text${boxCollectionPointFilter}
         UNION ALL
         SELECT to_char((created_at AT TIME ZONE $4::text)::date, 'YYYY-MM-DD') AS day, amount
           FROM safe_transactions
          WHERE tenant_id = $1 AND type = 'collection'
            AND created_at >= $2::date::timestamp AT TIME ZONE $4::text
            AND created_at < ($3::date + 1)::timestamp AT TIME ZONE $4::text
       ) c
       GROUP BY 1
       ORDER BY 1`,
      collectionParams,
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
      collections: 0,
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
      collections: 0,
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
    for (const r of collectionRows) {
      const key = dayKey(r.day);
      let existing = byKey.get(key);
      if (!existing) {
        existing = emptyDay(r.day);
        byKey.set(key, existing);
        days.push(existing);
      }
      existing.collections += parseFloat(r.collections) || 0;
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
      collections: 0,
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
      totals.collections += d.collections;
    }

    // 155 — текущие остатки «кошельков»: drawer — касса (живой expected
    // открытой смены либо размен последней закрытой), safe — сейф. Эндпоинт
    // и так под cashflow_view, поэтому отдаём всем, кто сюда дошёл.
    // ФИЛИАЛ (161): ящик у каждого филиала СВОЙ — точка уходит в getWallets.
    const wallets = await this.getWallets(tenantID, cashFlowPointId);

    return { days, totals, wallets };
  }

  /**
   * 155 — остатки кошельков тенанта. drawer при ОТКРЫТОЙ смене — живой
   * expected по формуле cash-shifts (opening + наличная выручка окна +
   * наличные погашения рассрочки − одобренные расходы окна − наличная часть
   * возвратов по чекам ВНЕ окна − инкассации смены); без открытой — carryover
   * последней закрытой (до-миграционные закрытия оставляли всё в кассе →
   * fallback closing_amount). safe = Σ deposit + Σ adjustment − Σ collection.
   *
   * ФИЛИАЛ (161) — ЯЩИК У КАЖДОГО ФИЛИАЛА СВОЙ. До 161 «одна открытая смена»
   * была ограничением ТЕНАНТА, и брать её первой попавшейся было безопасно.
   * Теперь открытых смен ровно по одной НА ФИЛИАЛ, и прежний
   * `ORDER BY opened_at DESC LIMIT 1` отдавал филиалу А ящик филиала Б —
   * вместе с наличной выручкой и расходами ВСЕЙ сети. Три правила:
   *   • смена выбирается по точке актора;
   *   • выручка и расходы окна считаются по точке САМОЙ СМЕНЫ (а не читающего)
   *     — тем же правилом, что Z-отчёт (cash-shifts.computeFigures);
   *   • перенос размена берётся у последней закрытой смены ТОГО ЖЕ филиала
   *     (зеркало cash-shifts.open: деньги, оставленные в ящике точки А, не
   *     могут стать разменом точки Б).
   *
   * РЕЖИМ «ВСЕ ТОЧКИ» (точки нет) — СУММА ящиков всех филиалов, а не пустое
   * значение: поле drawer у клиентов число, и «0» читалось бы как «касса
   * пуста». Слот филиала даёт либо живой expected своей открытой смены, либо
   * размен своей последней закрытой — то есть каждый рубль учтён РОВНО один
   * раз. Одноточечный тенант (точек нет вовсе, у смен point_id IS NULL) даёт
   * ровно один слот, поэтому его цифра БАЙТ-В-БАЙТ прежняя.
   *
   * СЕЙФ ОСТАЁТСЯ ОБЩИМ НА КОМПАНИЮ — и это не забытый фильтр, а решение
   * миграции 161: у safe_transactions точки НЕТ СОЗНАТЕЛЬНО (депозит рождается
   * при закрытии смены филиала, а инкассация из сейфа делается владельцем и
   * точки может не иметь вовсе; подсумма по филиалу перестала бы сходиться с
   * реальным остатком). Сейф физически один в кабинете — таким и показываем.
   */
  private async getWallets(tenantID: string, pointId: string | null): Promise<{ drawer: number; safe: number }> {
    const { rows: safeRows } = await this.pool.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'collection' THEN -amount ELSE amount END), 0) AS balance
         FROM safe_transactions
        WHERE tenant_id = $1`,
      [tenantID],
    );
    const safe = parseFloat(safeRows[0].balance) || 0;

    // Открытые смены В СКОУПЕ: филиал → максимум одна (уникальный индекс
    // uq_cash_shifts_one_open_per_point); без филиала (одноточечный тенант) —
    // по одной на филиал, то есть ровно одна.
    const openParams: any[] = [tenantID];
    const openPointFilter = pointFilterSql('cs', pointId, openParams);
    const { rows: openRows } = await this.pool.query(
      `SELECT cs.id, cs.point_id, cs.opened_at, cs.opening_amount
         FROM cash_shifts cs
        WHERE cs.tenant_id = $1 AND cs.status = 'open'${openPointFilter}
        ORDER BY cs.opened_at DESC`,
      openParams,
    );

    let drawer = 0;
    // Слоты, у которых ящик уже посчитан по ЖИВОЙ смене: переносить им размен
    // прошлой закрытой смены нельзя — это был бы двойной счёт тех же денег.
    // Ключ — точка (у одноточечного тенанта единственный слот с null).
    const liveSlots = new Set<string | null>();
    for (const shift of openRows) {
      const shiftPoint: string | null = shift.point_id ?? null;
      liveSlots.add(shiftPoint);
      const figParams: any[] = [tenantID, shift.opened_at, shift.id];
      // Точка — У СМЕНЫ. Обе подвыборки адресуют ОДИН плейсхолдер: имя колонки
      // в них неквалифицированное, поэтому фрагмент подходит и checks, и
      // expenses, а второй push дал бы Postgres лишний параметр.
      const figPointFilter = pointFilterSql(null, shiftPoint, figParams);
      // 164 — возвраты и погашения рассрочки адресуют ТОТ ЖЕ плейсхолдер точки
      // (значение одно, второй push дал бы Postgres лишний параметр), но с
      // другой квалификацией колонки: у возврата филиал берётся у ЧЕКА, у
      // погашения — у чека ПЛАНА. Оба — дословное зеркало
      // cash-shifts.computeFigures; пять слагаемых ящика обязаны быть
      // одинаковы здесь и там, иначе «Остаток в кассе» в «Движении денег»
      // разойдётся с ожидаемым остатком Z-отчёта, и владелец прочитает
      // расхождение как пропавшие деньги.
      const retPointFilter = shiftPoint ? ` AND ch.point_id = $${figParams.length}` : '';
      const instPointFilter = shiftPoint
        ? ` AND EXISTS (SELECT 1 FROM checks mch WHERE mch.id = pl.check_id` +
          ` AND mch.tenant_id = $1 AND mch.deleted_at IS NULL AND mch.point_id = $${figParams.length})`
        : '';
      const { rows: figRows } = await this.pool.query(
        `SELECT
           (SELECT COALESCE(SUM(cash_amount), 0) FROM checks
             WHERE tenant_id = $1 AND is_deferred = false AND deleted_at IS NULL
               AND date >= $2 AND date <= now()${figPointFilter})     AS cash_sales,
           (SELECT COALESCE(SUM(amount), 0) FROM expenses
             WHERE tenant_id = $1
               AND COALESCE(approval_status, 'approved') = 'approved'
               AND date >= $2 AND date <= now()${figPointFilter})     AS cash_expenses,
           (SELECT COALESCE(SUM(cr.refund_cash_amount), 0) FROM check_returns cr
              JOIN checks ch ON ch.id = cr.check_id AND ch.tenant_id = cr.tenant_id
             WHERE cr.tenant_id = $1
               AND cr.created_at >= $2 AND cr.created_at <= now()
               AND ch.deleted_at IS NULL
               AND NOT (ch.date >= $2 AND ch.date <= now() AND ch.is_deferred = false)${retPointFilter})
                                                                      AS cash_returns,
           (SELECT COALESCE(SUM(p.amount), 0) FROM installment_payments p
              JOIN installment_plans pl ON pl.id = p.plan_id AND pl.tenant_id = p.tenant_id
             WHERE p.tenant_id = $1
               AND p.paid_at >= $2 AND p.paid_at <= now()
               AND COALESCE(p.payment_method, 'cash') <> 'card'${instPointFilter})
                                                                      AS installment_cash,
           (SELECT COALESCE(SUM(amount), 0) FROM cash_collections
             WHERE tenant_id = $1 AND shift_id = $3)                  AS collections`,
        figParams,
      );
      const f = figRows[0];
      drawer +=
        (parseFloat(shift.opening_amount) || 0) +
        (parseFloat(f.cash_sales) || 0) +
        (parseFloat(f.installment_cash) || 0) -
        (parseFloat(f.cash_expenses) || 0) -
        (parseFloat(f.cash_returns) || 0) -
        (parseFloat(f.collections) || 0);
    }

    // Слоты без открытой смены — размен, оставленный их последней закрытой.
    // DISTINCT ON по точке даёт ровно одну строку на филиал; в Postgres
    // DISTINCT считает NULL'ы равными, поэтому одноточечный тенант (point_id
    // IS NULL у всех смен) сворачивается в один слот, как и до 161.
    //
    // В скоупе ОДНОГО филиала с уже открытой сменой переносить нечего — весь
    // результат этого запроса всё равно отсеял бы liveSlots. Пропускаем его,
    // чтобы горячий путь «Движения денег» остался в те же три запроса, что до
    // волны (без филиала состав слотов заранее неизвестен — там
    // запрос нужен всегда).
    if (!pointId || openRows.length === 0) {
      const carryParams: any[] = [tenantID];
      const carryPointFilter = pointFilterSql('cs', pointId, carryParams);
      const { rows: carryRows } = await this.pool.query(
        `SELECT DISTINCT ON (cs.point_id)
                cs.point_id,
                COALESCE(cs.carryover_amount, cs.closing_amount, 0) AS carryover
           FROM cash_shifts cs
          WHERE cs.tenant_id = $1 AND cs.status = 'closed'${carryPointFilter}
          ORDER BY cs.point_id, cs.closed_at DESC NULLS LAST`,
        carryParams,
      );
      for (const row of carryRows) {
        if (liveSlots.has(row.point_id ?? null)) continue;
        drawer += parseFloat(row.carryover) || 0;
      }
    }

    return { drawer: Math.round(drawer * 100) / 100, safe: Math.round(safe * 100) / 100 };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Owner dashboard v2 — richer aggregates (net profit, cash position,
  //  margin, deferred sum, personal records, month forecast).
  //  Cached 30s per tenant.
  // ──────────────────────────────────────────────────────────────────────

  async dashboardV2(
    tenantID: string,
    period: 'today' | 'week' | 'month' | 'year' = 'month',
    pointId: string | null = null,
  ) {
    // ФИЛИАЛ (156/160): сегмент точки — ОБЯЗАТЕЛЬНАЯ часть ключа и стоит СРАЗУ
    // ПОСЛЕ tenantID. Без него первый же запрос филиала А раздал бы свои цифры
    // филиалу Б (кеш общий на тенанта); перед tenantID — ключ ушёл бы
    // из-под префиксной инвалидации reports-cache и залипал на 30 секунд после
    // каждой продажи.
    return ttlCache.wrap(`reports:dashboard-v2:${tenantID}:${pointCacheSegment(pointId)}:${period}`, 30_000, () =>
      this.computeDashboardV2(tenantID, period, pointId),
    );
  }

  private async computeDashboardV2(
    tenantID: string,
    period: 'today' | 'week' | 'month' | 'year',
    pointId: string | null = null,
  ) {
    // E-7 — границы дня/месяца в ПОЯСЕ ТЕНАНТА (tenants.timezone, миграция
    // 157), как getFinancial/getCashFlow и shifts/salary. Раньше здесь был
    // фиксированный сдвиг +3ч: автосервису во Владивостоке «сегодня» начиналось
    // в 09:00 по местному времени, и дашборд расходился с его же кассой.
    // Границы отдаём как UTC-инстанты МЕСТНОЙ полуночи — форма не изменилась,
    // изменился только источник сдвига. Кеш dashboardV2 ключуется тенантом,
    // поэтому пояс в ключ добавлять не нужно.
    const tz = await getTenantTimezone(this.pool, tenantID);
    const now = new Date();
    const localNow = getZonedParts(now, tz);
    const locY = localNow.year;
    const locM = localNow.month - 1; // 0-based, как у Date.UTC
    const locD = localNow.day;
    const prevMonthStartDate = startOfMonthInZoneOffset(tz, -1, now);
    const monthStartDate = startOfMonthInZone(tz, now);
    const todayStart = startOfDayInZone(tz, now).toISOString();
    const monthStart = monthStartDate.toISOString();

    // Окно сравнения с прошлым месяцем — «НА ТУ ЖЕ ДАТУ» (единый хелпер с
    // графиком дашборда). Раньше месяц-к-дате (1–9 сентября) сравнивался с
    // ПОЛНЫМ августом: маржа прошлого месяца считалась по 31 дню расходов
    // против 9 дней текущего, и marginPctChange в начале месяца врал.
    // Верхняя граница текущего месяца — секунда до 1-го числа следующего, та же
    // форма, что у dashboard-chart.
    const monthEndDate = new Date(startOfMonthInZoneOffset(tz, 1, now).getTime() - 1000);
    const prevWindow = previousComparableWindow({
      tz,
      period: 'month',
      currentFrom: monthStartDate,
      currentTo: monthEndDate,
      now,
    });
    // now всегда внутри текущего месяца, поэтому окно есть; fallback на полный
    // прошлый месяц оставлен как безопасное поведение по умолчанию, а не как
    // рабочая ветка.
    const prevWindowStart = (prevWindow?.from ?? prevMonthStartDate).toISOString();
    const prevWindowEnd = (prevWindow?.to ?? new Date(monthStartDate.getTime() - 1000)).toISOString();

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
    // Формулы выручки/прибыли — из общего common/check-money-sql.ts (тот же
    // текст SQL в checks.getDashboard и в сводке по филиалам): три экрана не
    // могут разъехаться, потому что формула физически одна.
    const revenueExpr = checkRevenueExpr();
    const profitExpr = checkProfitExpr();
    const baseParams: any[] = [tenantID, todayStart, monthStart];
    const basePointFilter = pointFilterSql(null, pointId, baseParams);
    const { rows: baseRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= $2 THEN (${revenueExpr}) END), 0) AS revenue_today,
         COALESCE(COUNT(CASE WHEN date >= $2 THEN 1 END), 0) AS checks_today,
         COALESCE(SUM(CASE WHEN date >= $3 THEN (${revenueExpr}) END), 0) AS revenue_month,
         COALESCE(SUM(CASE WHEN date >= $2 THEN (${profitExpr}) END), 0) AS profit_today,
         COALESCE(SUM(CASE WHEN date >= $3 THEN (${profitExpr}) END), 0) AS profit_month,
         COALESCE(SUM(CASE WHEN date >= $2 THEN cash_amount END), 0) AS cash_today,
         COALESCE(SUM(CASE WHEN date >= $2 THEN card_amount END), 0) AS card_today,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method='warranty' THEN total_revenue END), 0) AS warranty_today,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method='warranty' THEN product_cost_total + service_salary_total + COALESCE(product_salary_total, 0) END), 0) AS warranty_loss_today,
         COALESCE(SUM(CASE WHEN date >= $2 AND payment_method='installment' THEN GREATEST(total_revenue - cash_amount - card_amount, 0) END), 0) AS installment_debt_today
       FROM checks
       WHERE tenant_id=$1 AND ${checkMoneyBaseWhere()}${basePointFilter}`,
      baseParams,
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
    //
    // Round 14 (149) — «за какой месяц»: месячные агрегаты относят расход по
    // effective-месяцу COALESCE(e.period_month, месяц e.date в поясе тенанта), а не по
    // дате факта. Равенство месяца здесь = «диапазон покрывает месяц целиком»
    // из getFinancial (агрегат всегда ровно один календарный месяц), поэтому
    // задвоения под-диапазонов, исправленного в getFinancial, тут нет by
    // construction. Выплата 5 августа «за июль» больше НЕ режет августовский
    // netProfitMonth (она уехала в июль — getFinancial за июль её видит);
    // exp_today дополнительно требует «сегодняшний» расход быть ЗА текущий
    // месяц — выплата задним числом не искажает «прибыль сегодня». Побочная
    // доводка: равенство месяца (вместо date >= monthStart без верхней
    // границы) перестало затягивать расходы, датированные БУДУЩИМИ месяцами,
    // в текущий месяц — согласовано с period-семантикой.
    const curYm = zonedMonthKey(now, tz);
    const prevYm = zonedMonthKey(prevMonthStartDate, tz);
    // Пояс уходит параметром $5 — в SQL его нельзя склеивать строкой.
    // ФИЛИАЛ (161): расход принадлежит филиалу, на котором возник
    // (expenses.point_id), поэтому netProfitToday / netProfitMonth филиала
    // вычитают ТОЛЬКО его расходы — тем же pointFilterSql, что ExpensesService
    // .getAll и getFinancial. Без фильтра «Прибыль за месяц» на главной
    // занижалась на постоянку соседнего филиала.
    // ЧЕСТНОЕ ОГРАНИЧЕНИЕ: ПЛАНОВАЯ постоянка блока netProfitAccrual ниже
    // (fixed_costs / employee_compensation) точки не имеет — это конфиг
    // тенанта, а не денежная строка. В филиальном срезе она вычитается
    // целиком, то есть accrual-прибыль филиала занижена, а не завышена. Так
    // безопаснее: завышенная прибыль — это решение потратить деньги, которых
    // нет. Кассовые netProfitToday/netProfitMonth фильтруются точно.
    // exp_prev_month РЕЖЕТСЯ ОКНОМ СРАВНЕНИЯ ЦЕЛИКОМ — обеими границами
    // ($7 = начало окна, $6 = конец), ровно как прибыль прошлого месяца
    // (prevRows ниже берёт чеки `date >= prevWindowStart AND date <= prevWindowEnd`).
    //
    // ПОЧЕМУ ПОЯВИЛАСЬ НИЖНЯЯ ГРАНИЦА. Раньше стояла только верхняя, а состав
    // задавался отнесением по месяцу (effMonth). Расход, отнесённый к прошлому
    // месяцу, но ДАТИРОВАННЫЙ раньше окна — предоплаченная в июле аренда за
    // август — проходил оба условия и падал в срез «август по 9-е» ЦЕЛЫМ
    // месяцем. Прибыль в этом окне при этом всего за девять дней, и
    // prevMarginPct получался бессмысленным: маржа прошлого месяца уезжала в
    // минус, а marginPctChange показывал владельцу фантомный рост.
    //
    // ПОЧЕМУ effMonth ПРИ ЭТОМ ОСТАЁТСЯ. Отнесение — это ответ на вопрос «за
    // какой месяц расход», и он симметричен текущей стороне сравнения
    // (exp_month тоже собирается по effMonth). Аренда за август, оплаченная
    // 5 сентября, в срез «август по 9-е» не попадает и по нижней границе, и
    // по верхней: на 9 августа её ещё не существовало. Итог — обе ноги
    // сравнения обрезаны ОДНИМ окном по дате факта, а состав расходов
    // остаётся месячно-отнесённым, как на текущей стороне.
    const effMonth = `COALESCE(e.period_month, to_char(e.date AT TIME ZONE $5::text, 'YYYY-MM'))`;
    // Фиксированные $1..$7 остаются на местах, точка кладётся ВОСЬМОЙ — иначе
    // разъехались бы все ${effMonth}-выражения выше, собранные вокруг $5.
    const expenseParams: any[] = [tenantID, todayStart, curYm, prevYm, tz, prevWindowEnd, prevWindowStart];
    const expensePointFilter = pointFilterSql('e', pointId, expenseParams);
    const { rows: expenseRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN e.date >= $2 AND ${effMonth} = $3 THEN e.amount END), 0) AS exp_today,
         COALESCE(SUM(CASE WHEN ${effMonth} = $3 THEN e.amount END), 0) AS exp_month,
         COALESCE(SUM(CASE WHEN ${effMonth} = $4 AND e.date >= $7 AND e.date <= $6 THEN e.amount END), 0) AS exp_prev_month,
         COALESCE(SUM(CASE WHEN ${effMonth} = $3 AND COALESCE(ec.is_recurring, false) = false THEN e.amount END), 0) AS exp_month_oneoff,
         COALESCE(SUM(CASE WHEN ${effMonth} = $3 AND COALESCE(ec.is_recurring, false) = true THEN e.amount END), 0) AS exp_month_recurring
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.tenant_id=$1
         AND COALESCE(e.approval_status, 'approved') = 'approved'
         AND COALESCE(ec.name, '') <> 'Зарплата'${expensePointFilter}`,
      expenseParams,
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

    // ПРЕМИИ + МОТИВАЦИЯ — третий вид зарплатного начисления (обоснование и
    // доказательство отсутствия двойного счёта — common/salary-extras-sql.ts).
    // Из profitToday/profitMonth их НЕ вычитаем: это «прибыль по чекам», и её
    // определение общее с журналом и карточкой филиала. Вычитаем ровно там, где
    // считается ЧИСТАЯ прибыль владельца, — вместе с расходами.
    const salaryExtras = await this.salaryExtrasForDashboard(tenantID, pointId, tz, {
      todayStart,
      monthStart,
      curYm,
      prevYm,
      prevWindowStart,
      prevWindowEnd,
    });

    const netProfitToday = profitToday - expToday - salaryExtras.today;
    const netProfitMonth = profitMonth - expMonth - salaryExtras.month;

    // Previous-period net profit for marginPctChange — прошлый месяц НА ТУ ЖЕ
    // ДАТУ (1–9 августа против 1–9 сентября), а не целиком.
    // Гарантия исключена из выручки и заменена на убыток в прибыли — та же
    // семантика, что в baseRows, чтобы marginPctChange считался консистентно.
    // Граница ВКЛЮЧИТЕЛЬНАЯ (`<= $3`): prevWindowEnd — секунда до следующей
    // местной полуночи, ровно как верхние границы в dashboard-chart.
    const prevParams: any[] = [tenantID, prevWindowStart, prevWindowEnd];
    const prevPointFilter = pointFilterSql(null, pointId, prevParams);
    const { rows: prevRows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(${revenueExpr}), 0) AS revenue,
         COALESCE(SUM(${profitExpr}), 0) AS profit
         FROM checks
        WHERE tenant_id=$1 AND ${checkMoneyBaseWhere()}
          AND date >= $2 AND date <= $3${prevPointFilter}`,
      prevParams,
    );
    const prevRevenue = parseFloat(prevRows[0]?.revenue) || 0;
    const prevProfit = parseFloat(prevRows[0]?.profit) || 0;
    // Обе стороны — за ОДНО И ТО ЖЕ окно: prevProfit по чекам 1–9 августа,
    // expPrevMonth по расходам, отнесённым к августу И датированным теми же
    // 1–9 августа (см. $7/$6 выше). Одна и та же обрезка с двух сторон — иначе
    // процент маржи прошлого месяца сравнивать не с чем.
    // Обе стороны сравнения маржи вычитают премии/мотивацию своего окна —
    // иначе месяц с премиями выглядел бы хуже прошлого без них по причине,
    // которой в цифрах не видно.
    const prevNet = prevProfit - expPrevMonth - salaryExtras.prevWindow;
    const marginPct = revenueMonth > 0 ? (netProfitMonth / revenueMonth) * 100 : 0;
    const prevMarginPct = prevRevenue > 0 ? (prevNet / prevRevenue) * 100 : 0;
    const marginPctChange = marginPct - prevMarginPct;

    // Spark line: 30-day net profit per day. СОЗНАТЕЛЬНО по дате факта (149):
    // period_month — месячная грануляция, дневному тренду отнесение «за месяц»
    // неприменимо; спарк остаётся кассовой дневной картинкой.
    // ФИЛИАЛ (161): у ОБЕИХ ног спарклайна — и прибыли по чекам, и расходов —
    // один и тот же филиал. Раньше из прибыли филиала вычитались расходы всей
    // сети, и линия тренда уходила в минус тем глубже, чем больше филиалов.
    // Точка кладётся ОДИН раз, оба фрагмента адресуют ОДИН плейсхолдер: второй
    // push дал бы Postgres лишний параметр, а разные значения в одном запросе
    // означали бы разные филиалы у прибыли и у расхода.
    const sparkParams: any[] = [tenantID];
    const sparkPointFilter = pointFilterSql(null, pointId, sparkParams);
    const sparkExpPointFilter = pointId ? ` AND e.point_id = $${sparkParams.length}` : '';
    const { rows: sparkRows } = await this.pool.query(
      `SELECT day, COALESCE(profit, 0) AS profit, COALESCE(exp, 0) AS expense
         FROM (
           SELECT generate_series(now()::date - interval '29 days', now()::date, '1 day')::date AS day
         ) d
         LEFT JOIN (
           SELECT date::date AS day,
                  SUM(${profitExpr}) AS profit
             FROM checks
            WHERE tenant_id=$1 AND ${checkMoneyBaseWhere()}
              AND date >= now() - interval '30 days'${sparkPointFilter}
            GROUP BY day
         ) ch USING (day)
         LEFT JOIN (
           SELECT e.date::date AS day, SUM(e.amount) AS exp
             FROM expenses e
             LEFT JOIN expense_categories ec ON ec.id = e.category_id
            WHERE e.tenant_id=$1 AND e.date >= now() - interval '30 days'
              AND COALESCE(e.approval_status, 'approved') = 'approved'
              AND COALESCE(ec.name, '') <> 'Зарплата'${sparkExpPointFilter}
            GROUP BY day
         ) ex USING (day)
         ORDER BY day`,
      sparkParams,
    );
    const marginSpark = sparkRows.map((r) => (parseFloat(r.profit) || 0) - (parseFloat(r.expense) || 0));

    // Погашения рассрочки за сегодня — по дате платежа (installment_payments,
    // 093). Информационно: деньги за прошлые продажи, в revenueToday не входят.
    // Разбивка по payment_method (119): 'card' → card, остальное → cash
    // (до-миграционные строки считаются налом — решение владельца).
    // paid = paid_cash + paid_card; installmentPaid остаётся суммой для
    // совместимости со старыми клиентами.
    // ФИЛИАЛ (156/160): у самих installment_payments точки нет (модуль
    // рассрочки правит следующая волна), поэтому филиал определяем по
    // ЧЕКУ-ИСТОЧНИКУ плана — та же атрибуция, что в getCashFlow. EXISTS, а не
    // JOIN: соединение внесло бы неоднозначность колонок amount/payment_method
    // в уже существующем запросе. Без выбранной точки предикат не добавляется.
    const instParams: any[] = [tenantID, todayStart];
    let instPointFilter = '';
    if (pointId) {
      instParams.push(pointId);
      instPointFilter = ` AND EXISTS (
           SELECT 1 FROM installment_plans pl
             JOIN checks ch ON ch.id = pl.check_id AND ch.deleted_at IS NULL
            WHERE pl.id = installment_payments.plan_id AND ch.point_id = $${instParams.length}
         )`;
    }
    const { rows: instPaidRows } = await this.pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid,
              COALESCE(SUM(CASE WHEN payment_method = 'card' THEN amount ELSE 0 END), 0) AS paid_card,
              COALESCE(SUM(CASE WHEN COALESCE(payment_method, 'cash') <> 'card' THEN amount ELSE 0 END), 0) AS paid_cash
         FROM installment_payments
        WHERE tenant_id=$1 AND paid_at >= $2${instPointFilter}`,
      instParams,
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
    // ФИЛИАЛ: незакрытые заказы — свои у каждого филиала.
    const defParams: any[] = [tenantID];
    const defPointFilter = pointFilterSql(null, pointId, defParams);
    const { rows: defRows } = await this.pool.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_revenue), 0) AS sum
         FROM checks WHERE tenant_id=$1 AND is_deferred=true AND deleted_at IS NULL${defPointFilter}`,
      defParams,
    );
    const deferredSum = {
      count: parseInt(defRows[0]?.cnt) || 0,
      sum: parseFloat(defRows[0]?.sum) || 0,
    };

    // Personal record: best day + best month all time. Гарантия исключена из
    // выручки (ITEM 2), поэтому рекорд считается по реальной выручке.
    // ФИЛИАЛ: рекорд — рекорд ЭТОГО автосервиса, иначе маленький филиал вечно
    // смотрел бы на недостижимую планку соседа.
    const bestDayParams: any[] = [tenantID];
    const bestDayPointFilter = pointFilterSql(null, pointId, bestDayParams);
    const { rows: bestDayRows } = await this.pool.query(
      `SELECT date::date AS day, SUM(${revenueExpr}) AS revenue
         FROM checks WHERE tenant_id=$1 AND ${checkMoneyBaseWhere()}${bestDayPointFilter}
         GROUP BY day ORDER BY revenue DESC LIMIT 1`,
      bestDayParams,
    );
    const bestMonthParams: any[] = [tenantID];
    const bestMonthPointFilter = pointFilterSql(null, pointId, bestMonthParams);
    const { rows: bestMonthRows } = await this.pool.query(
      `SELECT to_char(date_trunc('month', date), 'YYYY-MM') AS ym, SUM(${revenueExpr}) AS revenue
         FROM checks WHERE tenant_id=$1 AND ${checkMoneyBaseWhere()}${bestMonthPointFilter}
         GROUP BY ym ORDER BY revenue DESC LIMIT 1`,
      bestMonthParams,
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
    const daysInMonth = new Date(Date.UTC(locY, locM + 1, 0)).getUTCDate();
    const dayOfMonth = Math.max(locD, 1);
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
    // Премии/мотивация месяца — ФАКТ, а не план: они уже начислены, поэтому не
    // амортизируются долей месяца (как разовые расходы). Терм обязателен и
    // здесь: без него инвариант «нет планового конфига → mtd.netProfit ===
    // netProfitMonth» сломался бы ровно на сумму премий.
    const mtdSalaryExtras = salaryExtras.month;
    const mtdNetProfit =
      checkProfitMTD -
      mtdPlannedFixed -
      mtdStaffFixed -
      mtdStaffPctTurnover -
      mtdStaffPctProfit -
      mtdOneOff -
      mtdRecurringExcess -
      mtdSalaryExtras;

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
    // Премии и мотивация — ongoing, а не сунк: мастера продолжат зарабатывать
    // их до конца месяца, поэтому прогноз берёт их по run-rate (как непокрытую
    // постоянку), а не один раз (как разовые расходы).
    const projSalaryExtras = mtdSalaryExtras * runRateFactor;
    const projNetProfit =
      projCheckProfit -
      plannedFixedMonthly -
      staffFixedMonthly -
      projStaffPctTurnover -
      projStaffPctProfit -
      projOneOff -
      projRecurringExcess -
      projSalaryExtras;

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
        // Премии деньгами + мотивация месяца — реальные выплаты мастерам,
        // которых нет ни в чековой прибыли, ни в расходах.
        salaryExtras: r0(mtdSalaryExtras),
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
        // Премии/мотивация — ongoing, поэтому run-rate (в отличие от разовых).
        salaryExtras: r0(projSalaryExtras),
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
  async clientsNewVsReturning(tenantID: string, params: { from: string; to: string }, pointId: string | null = null) {
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
    // ФИЛИАЛ (156/160): когорта «новые / вернувшиеся» считается по ЧЕКАМ этого
    // филиала. Сам СОСТАВ базы клиентов точкой здесь не режется — это
    // маркетинговый счётчик заведённых записей, а база клиентов по решению
    // владельца общая (её раздельный режим живёт в ClientsService и
    // управляется tenants.points_shared_clients).
    const cohortParams: any[] = [tenantID, params.from, params.to];
    const cohortPointFilter = pointFilterSql('ch', pointId, cohortParams);
    const { rows } = await this.pool.query(
      `WITH window_checks AS (
         -- Чеки периода + дата ЗАВЕДЕНИЯ клиента (created_at) для когорты.
         SELECT ch.client_id, ch.total_revenue, ch.payment_method, cl.created_at AS client_created_at
           FROM checks ch
           JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = $1
          WHERE ch.tenant_id=$1 AND ch.is_deferred=false
            AND ch.deleted_at IS NULL
            AND ch.client_id IS NOT NULL
            AND ch.date::date BETWEEN $2::date AND $3::date${cohortPointFilter}
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
      cohortParams,
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
  async alerts(tenantID: string, pointId: string | null = null) {
    // ФИЛИАЛ (156/160): сегмент точки сразу после tenantID — иначе алерты
    // одного филиала раздались бы всем (кеш общий на тенанта), а сегмент перед
    // тенантом вывел бы ключ из-под префиксной инвалидации.
    return ttlCache.wrap(`reports:alerts:${tenantID}:${pointCacheSegment(pointId)}`, 30_000, () =>
      this.computeAlerts(tenantID, pointId),
    );
  }

  private async computeAlerts(tenantID: string, pointId: string | null = null) {
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

    // Late masters today (schedule_entries with late_status = late_major today).
    // «Сегодня» — календарный день В ПОЯСЕ ТЕНАНТА: иначе владивостокскому
    // автосервису опоздания подсвечивались бы по московскому дню и до 09:00
    // местного времени показывались вчерашние.
    const { rows: lateMasters } = await this.pool.query(
      `SELECT u.full_name FROM schedule_entries se
        JOIN users u ON u.id = se.user_id
       WHERE se.tenant_id=$1
         AND se.date = (now() AT TIME ZONE $2::text)::date
         AND se.late_status = 'late_major'
       LIMIT 5`,
      [tenantID, await getTenantTimezone(this.pool, tenantID)],
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
    // ФИЛИАЛ: возврат относится к филиалу СВОЕГО чека (у check_returns точки
    // нет — модуль возвратов правит следующая волна, атрибуция через ch).
    // Остальные алерты (склад, отзывы, гарантии, опоздания) точки в своих
    // таблицах пока не имеют и остаются сетевыми — это осознанно, а не забыто.
    const retParams: any[] = [tenantID];
    const retPointFilter = pointFilterSql('ch', pointId, retParams);
    const { rows: rets } = await this.pool.query(
      `SELECT cr.id, ch.number AS check_number, cr.created_at
         FROM check_returns cr
         JOIN checks ch ON ch.id = cr.check_id
        WHERE cr.tenant_id=$1 AND cr.created_at >= now() - interval '1 day'${retPointFilter}
        ORDER BY cr.created_at DESC LIMIT 5`,
      retParams,
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
  async bestDayOfWeek(tenantID: string, params: { from: string; to: string }, pointId: string | null = null) {
    const from = this.safeDate(params?.from, '');
    const to = this.safeDate(params?.to, '');
    if (!from || !to) {
      return { days: [], best: 0, worst: 0 };
    }
    params = { from, to };
    // ФИЛИАЛ: «лучший день недели» — про загрузку ЭТОГО автосервиса.
    const dowParams: any[] = [tenantID, params.from, params.to];
    const dowPointFilter = pointFilterSql(null, pointId, dowParams);
    const { rows } = await this.pool.query(
      // Выручка дня недели — общий модуль формул: гарантийная суббота денег не
      // принесла, и планировать по ней загрузку нельзя. Счётчик чеков (cnt)
      // гарантию сохраняет — это загрузка поста, а не деньги.
      `SELECT EXTRACT(DOW FROM date)::int AS weekday,
              COALESCE(SUM(${checkRevenueExpr()}), 0) AS revenue,
              COUNT(*) AS cnt
         FROM checks
        WHERE tenant_id=$1 AND ${checkMoneyBaseWhere()}
          AND date::date BETWEEN $2::date AND $3::date${dowPointFilter}
        GROUP BY weekday
        ORDER BY weekday`,
      dowParams,
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
  async retention(tenantID: string, period: 'week' | 'month' | 'year' = 'month', pointId: string | null = null) {
    const interval = period === 'week' ? '7 days' : period === 'year' ? '365 days' : '30 days';
    // ФИЛИАЛ (156/160): удержание считается по чекам ЭТОГО филиала — и окно
    // активности, и пожизненные визиты. Иначе филиал с одним клиентом получал
    // бы «возвращаемость» соседа. Фильтр уходит В ОБА CTE: разные базы
    // визитов дали бы долю returning > 100 %.
    const retParams: any[] = [tenantID];
    const retPointFilter = pointFilterSql(null, pointId, retParams);
    const { rows } = await this.pool.query(
      `WITH visits AS (
         -- LTV — через общий модуль формул: «сколько клиент принёс денег» не
         -- может включать гарантийные визиты, по которым он не платил ничего.
         SELECT client_id, COUNT(*) AS visit_count, SUM(${checkRevenueExpr()}) AS ltv,
                MIN(date) AS first_date, MAX(date) AS last_date
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL
            AND deleted_at IS NULL${retPointFilter}
          GROUP BY client_id
       ),
       window_clients AS (
         SELECT DISTINCT client_id
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false
            AND deleted_at IS NULL
            AND date >= now() - interval '${interval}'
            AND client_id IS NOT NULL${retPointFilter}
       )
       SELECT
         COUNT(*) AS total_in_window,
         COUNT(*) FILTER (WHERE v.visit_count > 1) AS returning,
         COALESCE(AVG(v.ltv), 0) AS avg_ltv,
         COALESCE(AVG(EXTRACT(EPOCH FROM (v.last_date - v.first_date)) / 86400 / NULLIF(v.visit_count - 1, 0)), 0) AS avg_days_between
       FROM window_clients wc
       JOIN visits v ON v.client_id = wc.client_id`,
      retParams,
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

  async getMarketingReport(tenantID: string, query: { from?: string; to?: string }, pointId: string | null = null) {
    const from = this.safeDate(query?.from, this.firstOfMonth());
    const to = this.safeDate(query?.to, this.todayISO());

    // ФИЛИАЛ (156/160): всё, что считается ПО ЧЕКАМ (привлечение, удержание,
    // выручка, тренды, воронка звонков), режется точкой. Отзывы и лояльность
    // своей точки в таблицах ещё не имеют и остаются сетевыми — отмечено
    // явно, чтобы не приняли за забытый фильтр.
    const [acquisition, retention, calls, reviews, loyalty, revenue, trends] = await Promise.all([
      this.marketingAcquisition(tenantID, from, to, pointId).catch(() => ReportsService.EMPTY_ACQUISITION),
      this.retentionForWindow(tenantID, from, to, pointId).catch(() => ReportsService.EMPTY_RETENTION),
      this.marketingCalls(tenantID, from, to, pointId).catch(() => ReportsService.EMPTY_CALLS),
      this.periodReviews(tenantID, from, to).catch(() => ReportsService.EMPTY_REVIEWS),
      this.marketingLoyalty(tenantID, from, to).catch(() => ReportsService.EMPTY_LOYALTY),
      this.marketingRevenue(tenantID, from, to, pointId).catch(() => ReportsService.EMPTY_REVENUE),
      this.marketingTrends(tenantID, from, to, pointId).catch(() => ReportsService.EMPTY_TRENDS),
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
  private async marketingAcquisition(tenantID: string, from: string, to: string, pointId: string | null = null) {
    const base = await this.clientsNewVsReturning(tenantID, { from, to }, pointId);

    // ФИЛИАЛ: выручка по источникам — по чекам ЭТОГО филиала. Сам список
    // новых клиентов точкой не режется (база клиентов общая, см.
    // clientsNewVsReturning): клиент, заведённый на филиале А, остаётся
    // «новым за период» и для сети, а денег без чека он и так не приносит.
    const srcParams: any[] = [tenantID, from, to];
    const srcPointFilter = pointFilterSql('ch', pointId, srcParams);
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
        AND ch.date::date BETWEEN $2::date AND $3::date${srcPointFilter}
       GROUP BY COALESCE(NULLIF(btrim(cl.source), ''), 'Без источника')
       ORDER BY count DESC, revenue DESC`,
      srcParams,
    );

    // Cohort of NEW clients bucketed by the ISO WEEK they were ADDED TO THE BASE
    // (clients.created_at — v3.0.1 ФИЧА 5, was «first ever check»), with the
    // revenue of their in-window checks. Lets the client draw "how many new
    // clients were added each week and what they spent". date_trunc('week') →
    // Monday-start ISO weeks.
    const cohParams: any[] = [tenantID, from, to];
    const cohPointFilter = pointFilterSql('ch', pointId, cohParams);
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
        AND ch.date::date BETWEEN $2::date AND $3::date${cohPointFilter}
       GROUP BY date_trunc('week', nc.created_date)
       ORDER BY date_trunc('week', nc.created_date)`,
      cohParams,
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
  private async retentionForWindow(tenantID: string, from: string, to: string, pointId: string | null = null) {
    // ФИЛИАЛ (156/160): фильтр уходит В ОБА CTE — разные базы визитов дали бы
    // долю returning больше 100 %.
    const winParams: any[] = [tenantID, from, to];
    const winPointFilter = pointFilterSql(null, pointId, winParams);
    const { rows } = await this.pool.query(
      `WITH visits AS (
         -- LTV — через общий модуль формул (см. retention выше): гарантийный
         -- визит денег клиенту не стоил и в его пожизненную ценность не идёт.
         SELECT client_id, COUNT(*) AS visit_count, SUM(${checkRevenueExpr()}) AS ltv,
                MIN(date) AS first_date, MAX(date) AS last_date
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL
            AND deleted_at IS NULL${winPointFilter}
          GROUP BY client_id
       ),
       window_clients AS (
         SELECT DISTINCT client_id
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false
            AND deleted_at IS NULL
            AND date::date BETWEEN $2::date AND $3::date
            AND client_id IS NOT NULL${winPointFilter}
       )
       SELECT
         COUNT(*) AS total_in_window,
         COUNT(*) FILTER (WHERE v.visit_count > 1) AS returning,
         COALESCE(AVG(v.ltv), 0) AS avg_ltv,
         COALESCE(AVG(EXTRACT(EPOCH FROM (v.last_date - v.first_date)) / 86400 / NULLIF(v.visit_count - 1, 0)), 0) AS avg_days_between
       FROM window_clients wc
       JOIN visits v ON v.client_id = wc.client_id`,
      winParams,
    );
    const r = rows[0];
    const total = parseInt(r?.total_in_window) || 0;
    const returning = parseInt(r?.returning) || 0;

    // Repeat-purchase distribution: among clients active in the window, how many
    // have made 1 / 2 / 3 / 4 / 5+ lifetime (non-deferred) visits. Fixed bucket
    // labels ('1'..'4','5+') so the client can render a stable histogram; an
    // empty bucket is simply absent from the array.
    const distParams: any[] = [tenantID, from, to];
    const distPointFilter = pointFilterSql(null, pointId, distParams);
    const { rows: distRows } = await this.pool.query(
      `WITH visits AS (
         SELECT client_id, COUNT(*) AS visit_count
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL
            AND deleted_at IS NULL${distPointFilter}
          GROUP BY client_id
       ),
       window_clients AS (
         SELECT DISTINCT client_id
           FROM checks
          WHERE tenant_id=$1 AND is_deferred=false
            AND deleted_at IS NULL
            AND date::date BETWEEN $2::date AND $3::date
            AND client_id IS NOT NULL${distPointFilter}
       )
       SELECT
         CASE WHEN v.visit_count >= 5 THEN '5+' ELSE v.visit_count::text END AS bucket,
         COUNT(*) AS clients
       FROM window_clients wc
       JOIN visits v ON v.client_id = wc.client_id
       GROUP BY CASE WHEN v.visit_count >= 5 THEN '5+' ELSE v.visit_count::text END
       ORDER BY MIN(v.visit_count)`,
      distParams,
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
  private async marketingCalls(tenantID: string, from: string, to: string, pointId: string | null = null) {
    const funnel = await this.getCallFunnel(tenantID, { dateFrom: from, dateTo: to }, pointId);

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
  private async marketingRevenue(tenantID: string, from: string, to: string, pointId: string | null = null) {
    // ФИЛИАЛ (156/160): выручка по источникам и по мастерам — деньги ЭТОГО
    // филиала, иначе разрез «по мастеру» показал бы чужих сотрудников.
    const srcParams: any[] = [tenantID, from, to];
    const srcPointFilter = pointFilterSql('ch', pointId, srcParams);
    const { rows: bySourceRows } = await this.pool.query(
      `SELECT
         COALESCE(NULLIF(btrim(cl.source), ''), 'Без источника') AS source,
         COUNT(*)                       AS checks,
         COALESCE(SUM(ch.total_revenue), 0) AS revenue
       FROM checks ch
       LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = $1
      WHERE ch.tenant_id=$1 AND ch.is_deferred=false AND ch.deleted_at IS NULL
        AND ch.payment_method IS DISTINCT FROM 'warranty'
        AND ch.date::date BETWEEN $2::date AND $3::date${srcPointFilter}
      GROUP BY COALESCE(NULLIF(btrim(cl.source), ''), 'Без источника')
      ORDER BY revenue DESC`,
      srcParams,
    );

    const mstParams: any[] = [tenantID, from, to];
    const mstPointFilter = pointFilterSql('ch', pointId, mstParams);
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
        AND ch.date::date BETWEEN $2::date AND $3::date${mstPointFilter}
      GROUP BY ch.master_id, u.full_name
      ORDER BY revenue DESC`,
      mstParams,
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
    pointId: string | null = null,
  ): Promise<MarketingTrendPoint[]> {
    // ФИЛИАЛ (156/160): все чековые CTE (пожизненные визиты, выручка,
    // возвращаемость) режутся точкой одним и тем же предикатом — иначе
    // возвращаемость филиала считалась бы от сетевой базы визитов. Звонки и
    // отзывы своей точки в таблицах ещё не имеют и остаются сетевыми.
    const trendParams: any[] = [tenantID, from, to, granularity];
    // Один и тот же параметр в двух написаниях: часть CTE читает checks без
    // алиаса, часть — под алиасом ch. Плейсхолдер общий, значение кладётся
    // ровно один раз.
    let trendPointFilter = '';
    let trendPointFilterCh = '';
    if (pointId) {
      trendParams.push(pointId);
      trendPointFilter = ` AND point_id = $${trendParams.length}`;
      trendPointFilterCh = ` AND ch.point_id = $${trendParams.length}`;
    }
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
          WHERE tenant_id=$1 AND is_deferred=false AND client_id IS NOT NULL AND deleted_at IS NULL${trendPointFilter}
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
            AND date::date BETWEEN $2::date AND $3::date${trendPointFilter}
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
                AND ch.date::date BETWEEN $2::date AND $3::date${trendPointFilterCh}
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
      trendParams,
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

  private async marketingTrends(tenantID: string, from: string, to: string, pointId: string | null = null) {
    const [weekly, monthly] = await Promise.all([
      this.marketingTrendSeries(tenantID, from, to, 'week', pointId),
      this.marketingTrendSeries(tenantID, from, to, 'month', pointId),
    ]);
    return { weekly, monthly };
  }

  async returnsSummaryForDashboard(tenantID: string, pointId: string | null = null) {
    const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString();
    // ФИЛИАЛ (156/160): у check_returns своей точки нет — филиал берём с
    // ЧЕКА-ИСТОЧНИКА (та же атрибуция, что в getCashFlow и алертах). EXISTS,
    // а не JOIN: запрос агрегирует по одной таблице, соединение зря
    // размножило бы строки при возможных множественных возвратах.
    const retParams: any[] = [tenantID, todayStart];
    let retPointFilter = '';
    if (pointId) {
      retParams.push(pointId);
      retPointFilter = ` AND EXISTS (
           SELECT 1 FROM checks ch
            WHERE ch.id = check_returns.check_id AND ch.point_id = $${retParams.length}
         )`;
    }
    const { rows } = await this.pool.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(refund_amount), 0) AS sum
         FROM check_returns
        WHERE tenant_id=$1 AND created_at >= $2${retPointFilter}`,
      retParams,
    );
    return {
      returnsToday: parseInt(rows[0]?.cnt) || 0,
      returnsAmount: parseFloat(rows[0]?.sum) || 0,
    };
  }
}
