import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { PushService } from '../push/push.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ScheduleService } from '../schedule/schedule.service';
import { AuditService } from '../tenants/audit.service';
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
    // 153 — аудит денежных корректировок (отмена выплаты / сторно / правка
    // штрафа). Пишется ТРАНЗАКЦИОННО (logTx) — паттерн editClosedCheck (#61):
    // закоммиченная денежная правка не может остаться без аудит-строки.
    private audit: AuditService,
  ) {}

  /**
   * 153 — имя актора для денормализованной колонки admin_audit_log.actor_name.
   * Читается ВНУТРИ транзакции корректировки (тот же client), лучшая попытка:
   * пропавший пользователь просто даёт NULL, аудит-строка не срывается.
   */
  private async actorNameTx(client: PoolClient, actorId: string): Promise<string | null> {
    const { rows } = await client.query('SELECT full_name FROM users WHERE id = $1 LIMIT 1', [actorId]);
    return rows[0]?.full_name ?? null;
  }

  /**
   * 153 review-fix (п.1) — экранирует спецсимволы шаблона LIKE (\, %, _):
   * имя сотрудника участвует в префикс-матче описания расхода
   * (reversePayment) как ЛИТЕРАЛ, а не как шаблон.
   */
  private static escapeLike(value: string): string {
    return value.replace(/([\\%_])/g, '\\$1');
  }

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
    // Верхняя отсечка LEAST(dateTo, сегодня): будущие размеченные дни месяца
    // сменами НЕ считаются (клиенты шлют полный календарный месяц). Бизнес-
    // «сегодня» — Europe/Moscow, как в getToday / shift-auto-close.
    const { rows } = await this.pool.query(
      `SELECT user_id, COUNT(*)::int AS worked
         FROM schedule_entries
        WHERE tenant_id = $1 AND date >= $2::date
          AND date <= LEAST($3::date, (now() AT TIME ZONE 'Europe/Moscow')::date)
          AND ${filter.sql}
        GROUP BY user_id`,
      [tenantID, dateFrom, dateTo],
    );
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.user_id as string, parseInt(r.worked, 10) || 0);
    return map;
  }

  /** Бизнес-таймзона продукта (UTC+3, без летнего времени) — как BUSINESS_TZ
   *  в reports.service. */
  private static readonly BUSINESS_TZ = 'Europe/Moscow';
  private static readonly DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

  /**
   * SQL-предикат зарплатного периода [dateFrom..dateTo] для timestamptz-колонки
   * `col` (значения — параметры $2/$3). Строка `YYYY-MM-DD` трактуется как
   * МОСКОВСКИЙ календарный день: полуинтервал [from 00:00 МСК, to+1 00:00 МСК)
   * — паттерн reports.service (BUSINESS_TZ). Раньше границы строились кастом
   * `::date + 1` в СЕРВЕРНОЙ TZ (UTC в контейнере) с ВКЛЮЧЁННОЙ верхней
   * полуночью: чеки/начисления 00:00–03:00 МСК первого дня уезжали в соседний
   * период, а момент ровно to+1 00:00 попадал в оба смежных периода. Полный
   * timestamp в параметре — прежняя семантика 1:1 (guard, чтобы не менять
   * поведение нестандартных клиентов).
   */
  private static periodPredicate(col: string, dateFrom: string, dateTo: string): string {
    const lower = SalaryService.DATE_ONLY_RE.test(dateFrom)
      ? `${col} >= $2::date::timestamp AT TIME ZONE '${SalaryService.BUSINESS_TZ}'`
      : `${col} >= $2`;
    const upper = SalaryService.DATE_ONLY_RE.test(dateTo)
      ? `${col} < ($3::date + 1)::timestamp AT TIME ZONE '${SalaryService.BUSINESS_TZ}'`
      : `${col} <= ($3::date + 1)::timestamptz`;
    return `${lower} AND ${upper}`;
  }

  /**
   * Round 16 (баг 2) — SQL-выражение месяца-отнесения премии: НАЗНАЧЕННЫЙ
   * период (`period_month_year`, 'YYYY-MM'), fallback — месяц created_at МСК.
   * Зеркало атрибуции выплат (149: COALESCE(period_month, to_char(created_at
   * МСК))). Раньше премии относились к месяцу по created_at: премия «за июль»,
   * выданная 3 августа, жила в августе — и в списке (getAll), и в карточке
   * (getEmployeeMonth). Формат-guard (`~ '^\d{4}-\d{2}$'`): строка не по маске
   * (легаси/чужой клиент, колонка TEXT без CHECK) падает в fallback по
   * created_at, а не выпадает из ВСЕХ месяцев разом.
   */
  private static premiumMonthExpr(alias: string): string {
    return (
      `COALESCE(CASE WHEN ${alias}.period_month_year ~ '^\\d{4}-\\d{2}$' THEN ${alias}.period_month_year END, ` +
      `to_char(${alias}.created_at AT TIME ZONE '${SalaryService.BUSINESS_TZ}', 'YYYY-MM'))`
    );
  }

  /**
   * Round 16 (HIGH + MEDIUM, деньги) — предикат принадлежности ПОМЕСЯЧНО-
   * относимой строки (премия / выплата salary_payout / legacy salary_payment)
   * запрошенному диапазону [dateFrom..dateTo] в getAll. $2 = dateFrom,
   * $3 = dateTo (date-only 'YYYY-MM-DD') — те же плейсхолдеры, что periodPredicate.
   * Зеркало reports.getFinancial (149 / R15) и карточки getEmployeeMonth,
   * приведённое к семантике ДЕНЕГ:
   *
   *   • строка с ЯВНЫМ периодом (`periodCol` ~ 'YYYY-MM') включается ТОЛЬКО
   *     когда диапазон покрывает её месяц «по сегодняшний день»: dateFrom ≤ 1-е
   *     число месяца, месяц уже НАЧАЛСЯ (1-е ≤ сегодня-МСК — будущие месяцы не
   *     притягиваются) И dateTo ≥ LEAST(последнее число, сегодня-МСК). Значит
   *     ПОЛНЫЙ календарный месяц (моб. дефолт monthBounds = [1-е..последнее],
   *     веб-инициализация) И «месяц-к-дате» (веб-пресет «Месяц» = [1-е, сегодня])
   *     — ВКЛЮЧАЮТ месяц; «неделя»/«день», НЕ начинающиеся с 1-го, — НЕТ.
   *     Раньше getAll разворачивал ЛЮБОЙ диапазон в целые месяцы
   *     (getMonthYearsForRange → IN) и узкий срез, задевший границу месяца, тянул
   *     премии/выплаты ДВУХ ЦЕЛЫХ месяцев (баг MEDIUM: 2 полных месяца премий на
   *     недельном виде).
   *
   *     Про clamp к «сегодня» (в reports.getFinancial верх = чистое
   *     `последнее ≤ dateTo` без clamp): reports считает ПРИБЫЛЬ — там честно
   *     прятать период-строку из НЕПОЛНОГО месяца до его конца (касса покрывает
   *     по дате факта). Здесь — ОСТАТОК ЗАРПЛАТЫ: «недосписанная» принятая
   *     выплата задирает остаток и открывает путь к ПОВТОРНОЙ выдаче (баг HIGH).
   *     Клиенты смотрят ТЕКУЩИЙ месяц как [1-е, сегодня] ещё до его конца — значит
   *     принятая сегодня выплата ОБЯЗАНА списываться уже сейчас. Clamp верхней
   *     границы к «сегодня» делает [1-е, сегодня] «полным месяцем-к-дате» →
   *     выплата списана, остаток честный; задвоения нет (узкие срезы всё равно
   *     исключены — они не начинаются с 1-го).
   *
   *   • строка БЕЗ явного периода (`periodCol` NULL / не по маске) относится по
   *     ДАТЕ ФАКТА (`factCol`, московский полуинтервал periodPredicate) — узкий
   *     срез видит ровно те начисления, что реально произошли в его дни.
   *
   * Для ПОЛНОГО календарного месяца оба рукава сводятся к равенству
   * effective-месяца (как premiumMonthExpr = $3 и COALESCE(period_month, …) = $3
   * в getEmployeeMonth) — суммы СПИСКА и КАРТОЧКИ совпадают до копейки (инвариант
   * HIGH: getAll.remaining == getEmployeeMonth.remaining). CASE-guard в mfirst:
   * period_month_year — TEXT без CHECK, мусор → to_date(NULL) → рукав assigned
   * гаснет, строка уходит в fallback по дате факта (а не роняет запрос).
   */
  private static periodMonthMembership(periodCol: string, factCol: string, dateFrom: string, dateTo: string): string {
    const tz = SalaryService.BUSINESS_TZ;
    const validPeriod = `${periodCol} ~ '^\\d{4}-\\d{2}$'`;
    const mfirst = `to_date(CASE WHEN ${validPeriod} THEN ${periodCol} || '-01' END, 'YYYY-MM-DD')`;
    const mlast = `(${mfirst} + interval '1 month' - interval '1 day')::date`;
    const today = `(now() AT TIME ZONE '${tz}')::date`;
    const assigned =
      `${validPeriod} AND $2::date <= ${mfirst} AND ${mfirst} <= ${today} ` +
      `AND $3::date >= LEAST(${mlast}, ${today})`;
    const byFact =
      `(${periodCol} IS NULL OR ${periodCol} !~ '^\\d{4}-\\d{2}$') ` +
      `AND ${SalaryService.periodPredicate(factCol, dateFrom, dateTo)}`;
    return `((${assigned}) OR (${byFact}))`;
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
    // Единые границы периода для ВСЕХ компонент зарплаты (чеки / премии /
    // штрафы / мотивация) — московский полуинтервал, см. periodPredicate.
    const period = (col: string) => SalaryService.periodPredicate(col, dateFrom, dateTo);
    // Помесячно-относимые компоненты (payments / premiums / принятые payouts)
    // выбираются через periodMonthMembership (полный месяц-к-дате включает,
    // узкий срез — нет), а не разворотом диапазона в целые месяцы.
    const monthMember = (periodCol: string, factCol: string) =>
      SalaryService.periodMonthMembership(periodCol, factCol, dateFrom, dateTo);

    // Round 16 (баг 3) — месяц, на который резолвится ОТОБРАЖАЕМЫЙ процент:
    // последний месяц запрошенного периода (клиенты шлют календарный месяц —
    // это он и есть). Fallback — текущий месяц, если dateTo нестандартный.
    const rateMonth = /^\d{4}-\d{2}/.test(dateTo)
      ? dateTo.slice(0, 7)
      : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

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
            AND ${period('ch.date')}
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
            AND ${period('ch.date')}
          GROUP BY ch.master_id
       )
       SELECT u.id as master_id, u.full_name as master_name,
              COALESCE(h.salary_percent, u.salary_percent, 0) as salary_percent,
              COALESCE(h.product_salary_percent, u.product_salary_percent, 0) as product_salary_percent,
              COALESCE(svc.service_earnings, 0) as service_earnings,
              COALESCE(prod.product_earnings, 0) as product_earnings,
              COALESCE(svc.service_earnings, 0) + COALESCE(prod.product_earnings, 0) as total_earnings,
              COALESCE(prod.total_revenue, 0) as total_revenue,
              COALESCE(prod.check_count, 0) as check_count
         FROM users u
         -- Round 16 (баг 3) — процент в СПИСКЕ = effective-ставка запрошенного
         -- месяца (последняя строка master_rate_history с month <= rateMonth;
         -- NULL-колонка/нет строк → текущие users.*) — ровно как в карточке
         -- getEmployeeMonth (150) и в запекании чеков (checks.service, LATERAL).
         -- Начисления НЕ пересчитываются — они суммируются из ЗАПЕЧЁННЫХ
         -- salary_amount/product_salary_total (setRate прошлого месяца сам
         -- перепекает его чеки, recomputeMonthSalary) — правка только убирает
         -- рассинхрон «список показывает старый процент, карточка — новый».
         LEFT JOIN LATERAL (
           SELECT mrh.salary_percent, mrh.product_salary_percent
             FROM master_rate_history mrh
            WHERE mrh.tenant_id = u.tenant_id AND mrh.user_id = u.id AND mrh.month <= $4
            ORDER BY mrh.month DESC
            LIMIT 1
         ) h ON true
         LEFT JOIN svc ON svc.earner_id = u.id
         LEFT JOIN prod ON prod.earner_id = u.id
        WHERE u.tenant_id = $1 AND u.role IN ('master', 'admin')
        ORDER BY total_earnings DESC`,
      [tenantID, dateFrom, dateTo, rateMonth],
    );

    // Query payments for all masters in the period.
    // 153 review-fix — контракт совместимости со СТАРЫМИ сборками: их
    // SalaryNotificationContext ищет «неподтверждённую» выплату именно в этом
    // payments[] и НЕ знает про reversed_at — сторнированная строка зациклила
    // бы confirm-модал навсегда (сервер отвечает 400 на каждый confirm).
    // Reversed-строки отсюда исключаем: массив потребляет ТОЛЬКО контекст
    // подтверждения (проверено: карточка месяца — getEmployeeMonth, web-история
    // — getPayments; обе продолжают отдавать reversed зачёркнутыми).
    // + confirmed_at: раньше поля в getAll не было вовсе — клиентский фильтр
    // `!p.confirmedAt` был истинным ВСЕГДА, и уже подтверждённая выплата
    // всплывала модалом до конца месяца (pre-existing gap, review п.3).
    // Round 16 (MEDIUM) — отнесение legacy-выплат по periodMonthMembership
    // (month_year — назначенный месяц; date — дата факта fallback), а не
    // month_year IN (целые месяцы диапазона). Раньше недельный/дневной срез,
    // задевший границу месяца, тянул выплаты ЦЕЛЫХ месяцев — веб-суммы за
    // неделю/день задваивались. Полный месяц (и месяц-к-дате) по-прежнему
    // включает выплаты этого месяца — до копейки как getEmployeeMonth.
    const { rows: paymentRows } = await this.pool.query(
      `SELECT sp.*, u.full_name as user_name, c.full_name as creator_name,
              spc.confirmed_at
       FROM salary_payments sp
       LEFT JOIN users u ON u.id = sp.user_id
       LEFT JOIN users c ON c.id = sp.created_by
       LEFT JOIN salary_payment_confirmations spc ON spc.payment_id = sp.id AND spc.user_id = sp.user_id
       WHERE sp.tenant_id = $1 AND sp.reversed_at IS NULL
         AND ${monthMember('sp.month_year', 'sp.date')}
       ORDER BY sp.date DESC LIMIT 500`,
      [tenantID, dateFrom, dateTo],
    );

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
        // 153 review-fix — без confirmed_at фильтр «не подтверждена»
        // (`!confirmedAt`) на клиенте был истинным всегда.
        confirmedAt: p.confirmed_at ?? null,
        createdAt: p.created_at,
        // 153 — сторно: reversed-строки отфильтрованы в SQL выше (compat со
        // старыми сборками); поле остаётся в контракте (здесь всегда null),
        // paidAmount ниже страхуется по нему же (belt-and-braces).
        reversedAt: p.reversed_at ?? null,
        reversalReason: p.reversal_reason ?? null,
      });
    }

    // Premiums for the period — both cash and rate_bonus rows.
    // Round 16 (баг 2 + MEDIUM) — атрибуция по periodMonthMembership: премия с
    // НАЗНАЧЕННЫМ месяцем (period_month_year) относится к нему и включается,
    // только когда диапазон покрывает этот месяц-к-дате; премия БЕЗ периода — по
    // дате факта (created_at МСК). Раньше — premiumMonthExpr IN (целые месяцы
    // диапазона): узкий срез, задевший границу месяца, тянул премии ДВУХ целых
    // месяцев (баг MEDIUM). Полный месяц (и месяц-к-дате) по-прежнему включает
    // премию этого месяца — до копейки как getEmployeeMonth (премия «за июль»,
    // выданная в августе, живёт в июле; в августовском/недельном срезе её нет).
    const { rows: premRows } = await this.pool.query(
      `SELECT sp.*, u.full_name as user_name, a.full_name as awarder_name
       FROM salary_premiums sp
       LEFT JOIN users u ON u.id = sp.user_id
       LEFT JOIN users a ON a.id = sp.awarded_by
       WHERE sp.tenant_id = $1
         AND ${monthMember('sp.period_month_year', 'sp.created_at')}`,
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
         AND ${period('pen.date')}`,
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
    // remainingAmount stay byte-identical to before this feature. Same period
    // convention as the checks / premiums queries above (periodPredicate —
    // московский полуинтервал). Attributed by employee_id = the credited
    // master, mirroring how product revenue is attributed to checks.master_id.
    const { rows: motivationRows } = await this.pool.query(
      `SELECT employee_id, COALESCE(SUM(amount), 0) AS amount
         FROM motivation_accruals
        WHERE tenant_id = $1
          AND employee_id IS NOT NULL
          AND ${period('accrued_at')}
        GROUP BY employee_id`,
      [tenantID, dateFrom, dateTo],
    );
    const motivationByUser: Record<string, number> = {};
    for (const m of motivationRows) {
      motivationByUser[m.employee_id] = parseFloat(m.amount) || 0;
    }

    // Round 16 (HIGH — путь к ДВОЙНОЙ выплате) — ПРИНЯТЫЕ выплаты нового
    // confirm-flow (salary_payouts) как «выплачено». До этого getAll вычитал из
    // остатка ТОЛЬКО legacy salary_payments, а мобилка платит ИСКЛЮЧИТЕЛЬНО через
    // createPayout → decidePayout (пишет РАСХОД, а не строку salary_payments):
    // принятая выплата НЕ уменьшала remainingAmount списка → он показывал полный
    // остаток → кнопка «Выдать · остаток» (R16) давала ПОВТОРНУЮ выдачу.
    // Считаем ТОЛЬКО status='accepted' (pending/rejected/cancelled исключены —
    // точным зеркалом карточки getEmployeeMonth, где paidAmount =
    // acceptedPayoutsAmount + legacyPaidAmount). Отнесение по месяцу —
    // periodMonthMembership(period_month, created_at): выплата «за июль»,
    // принятая в августе, списывает остаток ИЮЛЯ (как в карточке), а не августа;
    // полный месяц-к-дате списывает, узкий срез — нет.
    const { rows: acceptedPayoutRows } = await this.pool.query(
      `SELECT p.employee_id, COALESCE(SUM(p.amount), 0) AS accepted_amount
         FROM salary_payouts p
        WHERE p.tenant_id = $1
          AND p.status = 'accepted'
          AND ${monthMember('p.period_month', 'p.created_at')}
        GROUP BY p.employee_id`,
      [tenantID, dateFrom, dateTo],
    );
    const acceptedPayoutsByUser: Record<string, number> = {};
    for (const r of acceptedPayoutRows) {
      acceptedPayoutsByUser[r.employee_id] = parseFloat(r.accepted_amount) || 0;
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
      // 153 — сторнированные legacy-выплаты НЕ считаются выплаченными: долг
      // перед сотрудником восстанавливается, а история остаётся видимой.
      const legacyPaidAmount = masterPayments.reduce((sum: number, p: any) => sum + (p.reversedAt ? 0 : p.amount), 0);
      // Round 16 (HIGH) — paidAmount = ПРИНЯТЫЕ salary_payouts + legacy
      // salary_payments, точным зеркалом getEmployeeMonth. Раньше учитывались
      // только legacy → принятые выплаты не списывались → двойная выдача.
      const acceptedPayoutsAmount = acceptedPayoutsByUser[masterId] || 0;
      const paidAmount = acceptedPayoutsAmount + legacyPaidAmount;
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
      // 153 — сторно (история остаётся, суммы исключают).
      reversedAt: r.reversed_at ?? null,
      reversalReason: r.reversal_reason ?? null,
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

    // Денежный путь: выплата и её зеркальный расход пишутся АТОМАРНО — одна
    // транзакция, как в новом flow decidePayout. Раньше два независимых INSERT
    // на this.pool: падение между ними оставляло выплату без расхода — долг
    // сотруднику уменьшался, а «Движение денег» / netProfit расход не видели.
    const client = await this.pool.connect();
    let payment: any;
    try {
      await client.query('BEGIN');

      // 1. Insert salary payment
      const { rows: paymentRows } = await client.query(
        `INSERT INTO salary_payments (tenant_id, user_id, amount, month_year, type, comment, created_by, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         RETURNING *`,
        [tenantID, dto.userId, dto.amount, dto.monthYear, dto.type || 'salary', dto.comment || null, createdBy],
      );
      payment = paymentRows[0];

      // 2. Find or create "Зарплата" expense category for this tenant
      let categoryId: string;
      const { rows: catRows } = await client.query(
        `SELECT id FROM expense_categories WHERE tenant_id = $1 AND name = 'Зарплата' LIMIT 1`,
        [tenantID],
      );
      if (catRows.length > 0) {
        categoryId = catRows[0].id;
      } else {
        const { rows: newCatRows } = await client.query(
          `INSERT INTO expense_categories (name, tenant_id) VALUES ('Зарплата', $1) RETURNING id`,
          [tenantID],
        );
        categoryId = newCatRows[0].id;
      }

      // Format month_year for description (e.g., "2026-02" -> "Февраль 2026")
      const [year, month] = dto.monthYear.split('-');
      const monthName = SalaryService.MONTH_NAMES[parseInt(month, 10) - 1] || dto.monthYear;
      const description = `Зарплата: ${userName} за ${monthName} ${year}`;

      // 4. Create expense record + прямая связь выплата → расход (153):
      //    сторно (reversePayment) компенсирует расход по expense_id, а не
      //    best-effort-матчем. Обе строки — в одной транзакции.
      const { rows: expRows } = await client.query(
        `INSERT INTO expenses (category_id, amount, description, date, user_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [categoryId, dto.amount, description, payment.date, createdBy, tenantID],
      );
      await client.query(`UPDATE salary_payments SET expense_id = $1 WHERE id = $2`, [expRows[0].id, payment.id]);

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
    // Tenant-scoped sender: the recipient traces back to `dto.userId` (client
    // input). The tenant check above stays, but the boundary is now also part
    // of the device lookup — a foreign recipient resolves to zero tokens.
    this.push.sendToUserInTenant(payment.user_id, tenantID, 'salary', `${title} начислена`, `Сумма: ${formatted} ₽`, {
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
    this.push.sendToUserInTenant(dto.userId, tenantID, 'salary', 'Премия начислена', body, {
      kind: 'premium',
      premiumId: p.id,
    });

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
      // Round 16 (баг 2) — тот же месяц-отнесения, что в getAll /
      // getEmployeeMonth (period_month_year, fallback created_at МСК): раньше
      // строгое равенство period_month_year теряло премии без периода
      // (легаси-строки NULL не попадали ни в один месяц).
      conds.push(`${SalaryService.premiumMonthExpr('sp')}=$${idx++}`);
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
    this.push.sendToUserInTenant(dto.userId, tenantID, 'penalty', 'Штраф наложен', `${formatted} ₽ — ${comment}`, {
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

  /**
   * Удаление штрафа. Пересчёт автоматический: штраф нигде не запечён, суммы
   * finesAmount/penaltiesAmount считаются на лету — удалённая строка просто
   * исчезает из следующей выборки. Round 15 (153): + транзакционный аудит со
   * снапшотом (кто/когда/что было) — паттерн editClosedCheck.
   */
  async deletePenalty(id: string, tenantID: string, actorId: string | null = null) {
    const client = await this.pool.connect();
    let employeeId: string | null = null;
    let amountLabel = '';
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT pen.*, u.full_name AS user_name
           FROM salary_penalties pen
           LEFT JOIN users u ON u.id = pen.user_id
          WHERE pen.id = $1 AND pen.tenant_id = $2
          FOR UPDATE OF pen`,
        [id, tenantID],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Штраф не найден' });
      }
      const penalty = rows[0];
      employeeId = penalty.user_id ?? null;
      amountLabel = (parseFloat(penalty.amount) || 0).toLocaleString('ru-RU');

      await client.query('DELETE FROM salary_penalties WHERE id=$1 AND tenant_id=$2', [id, tenantID]);

      if (actorId) {
        await this.audit.logTx(
          client,
          { userId: actorId, name: await this.actorNameTx(client, actorId) },
          'salary_penalty_delete',
          {
            targetType: 'salary_penalty',
            targetId: id,
            targetName: penalty.user_name ?? null,
            detail: {
              tenantId: tenantID,
              before: {
                amount: parseFloat(penalty.amount) || 0,
                description: penalty.description,
                date: penalty.date,
                userId: penalty.user_id,
              },
            },
          },
        );
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

    // Симметрия с «Штраф наложен»: отмена штрафа не должна быть молчаливой.
    if (employeeId) {
      this.push.sendToUserInTenant(employeeId, tenantID, 'penalty', 'Штраф отменён', `${amountLabel} ₽ — штраф снят`, {
        kind: 'penalty',
        penaltyId: id,
      });
    }

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
      'SELECT sp.user_id, sp.reversed_at FROM salary_payments sp WHERE sp.id=$1 AND sp.tenant_id=$2 LIMIT 1',
      [paymentId, tenantID],
    );
    if (paymentRows.length === 0) throw new NotFoundException({ message: 'Выплата не найдена' });
    // 153 — сторнированную выплату подтверждать нечего (денег больше «не было»).
    if (paymentRows[0].reversed_at) {
      throw new BadRequestException({ message: 'Выплата отменена владельцем' });
    }
    const ownerId = paymentRows[0].user_id as string;
    if (ownerId !== userID) {
      throw new BadRequestException({ message: 'Подтвердить может только получатель выплаты' });
    }

    // 153 review-fix (п.6) — read-then-act выше гоняется со сторно владельца:
    // между пре-чеком и INSERT выплату могли reversed, и подтверждение легло
    // бы на «отменённые» деньги. INSERT сделан УСЛОВНЫМ (INSERT … SELECT …
    // WHERE строка платежа жива AND reversed_at IS NULL) — авторитетный guard
    // в самом INSERT; пре-чеки выше остаются ради дружелюбных ошибок
    // (NotFound / «только получатель»).
    const { rows } = await this.pool.query(
      `INSERT INTO salary_payment_confirmations (payment_id, user_id)
       SELECT sp.id, $2
         FROM salary_payments sp
        WHERE sp.id = $1 AND sp.tenant_id = $3 AND sp.user_id = $2
          AND sp.reversed_at IS NULL
       ON CONFLICT (payment_id, user_id) DO NOTHING
       RETURNING confirmed_at`,
      [paymentId, userID, tenantID],
    );
    if (rows.length > 0) {
      return { paymentId, userId: userID, confirmedAt: rows[0].confirmed_at };
    }
    // rowCount=0 — либо уже подтверждена (конфликт: отдаём ПЕРВЫЙ момент,
    // канонический «да, получил»), либо строку сторнировали в гонке.
    const { rows: existing } = await this.pool.query(
      'SELECT confirmed_at FROM salary_payment_confirmations WHERE payment_id=$1 AND user_id=$2',
      [paymentId, userID],
    );
    if (existing.length > 0) {
      return { paymentId, userId: userID, confirmedAt: existing[0].confirmed_at };
    }
    throw new BadRequestException({ message: 'Выплата отменена владельцем' });
  }

  async getMy(tenantID: string, userID: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    // Вс: getDay()=0 — «date − getDay() + 1» дал бы ПОНЕДЕЛЬНИК СЛЕДУЮЩЕЙ
    // недели (week-суммы = 0 всё воскресенье). ISO-неделя: Вс = 7-й день —
    // та же формула, что в checks.service.getDashboard.
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 1).toISOString();
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
    dto: { employeeId: string; type: 'salary' | 'advance'; amount: number; comment?: string; periodMonth?: string },
  ) {
    if (!dto || !dto.employeeId) {
      throw new BadRequestException({ message: 'employeeId обязателен' });
    }
    const type = dto.type === 'advance' ? 'advance' : 'salary';
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({ message: 'Сумма выплаты должна быть положительной' });
    }
    // 149 — «за какой месяц» выплата ('YYYY-MM'). NULL = месяц выписки (МСК) —
    // прежнее поведение. DTO уже отвалидировал формат; belt-and-braces здесь.
    const periodMonth = dto.periodMonth && /^\d{4}-\d{2}$/.test(dto.periodMonth) ? dto.periodMonth : null;

    // Tenant-isolation: the recipient must belong to the caller's tenant.
    const { rows: userRows } = await this.pool.query('SELECT full_name FROM users WHERE id=$1 AND tenant_id=$2', [
      dto.employeeId,
      tenantID,
    ]);
    if (userRows.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });

    const comment = dto.comment ? String(dto.comment).trim() || null : null;
    const { rows } = await this.pool.query(
      `INSERT INTO salary_payouts (tenant_id, employee_id, type, amount, status, comment, created_by, period_month)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
       RETURNING *`,
      [tenantID, dto.employeeId, type, amount, comment, createdBy, periodMonth],
    );
    const p = rows[0];
    p.user_name = userRows[0].full_name;

    // Push the employee to confirm receipt. Category 'salary' respects the
    // employee's «Уведомления» toggle. Fire-and-forget (push is never source
    // of truth).
    const title = type === 'advance' ? 'Аванс к выплате' : 'Зарплата к выплате';
    const formatted = amount.toLocaleString('ru-RU');
    this.push.sendToUserInTenant(
      dto.employeeId,
      tenantID,
      'salary',
      title,
      `Сумма: ${formatted} ₽ — подтвердите получение`,
      {
        kind: 'payout',
        payoutId: p.id,
        payoutType: type,
        action: 'decide',
      },
    );

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
        // FOR UPDATE **OF p** — обязательно адресный лок. Голый `FOR UPDATE`
        // здесь пытается залочить и nullable-сторону LEFT JOIN (users), а
        // Postgres это запрещает в рантайме: «FOR UPDATE cannot be applied to
        // the nullable side of an outer join» → 500 на КАЖДОМ решении по
        // выплате (Sentry AUTEXA-BACKEND-Q). По смыслу лочить нужно ровно
        // строку выплаты — её мы и меняем; имя сотрудника читается только для
        // текста расхода и пуша. Страж от рецидива —
        // test/sql-for-update-outer-join.test.cjs.
        `SELECT p.*, u.full_name AS employee_name
           FROM salary_payouts p
           LEFT JOIN users u ON u.id = p.employee_id
          WHERE p.id = $1 AND p.tenant_id = $2
          FOR UPDATE OF p`,
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
        // 149 — период выплаты («за какой месяц») пробрасывается в расход.
        const expense = await this.expenses.recordSalaryExpense(
          tenantID,
          {
            amount: parseFloat(payout.amount) || 0,
            description,
            date: new Date().toISOString(),
            createdBy: payout.created_by ?? null,
            periodMonth: (payout.period_month as string | null) ?? null,
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
    // DELIBERATELY sendToUserCategory, not sendToUserInTenant: the recipient is
    // `payout.created_by`, read from a row already locked under
    // `tenant_id = $2` (never client input), and it may legitimately be a
    // TENANT-LESS platform superadmin — whom a `users.tenant_id = $tenant`
    // join would silently drop, turning a security nicety into a lost
    // notification.
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
   * by the controller. `monthYear` filters by the ASSIGNED month (149):
   * COALESCE(period_month, месяц created_at МСК) — выплата «за июль»,
   * выписанная в августе, попадает в июльский фильтр.
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
      conds.push(
        `COALESCE(p.period_month, to_char(p.created_at AT TIME ZONE '${SalaryService.BUSINESS_TZ}', 'YYYY-MM')) = $${idx++}`,
      );
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

  // ── Round 15 (153) — корректировки владельцем ошибочных выплат/штрафов ─────
  //
  // Все методы: гейт 'salary_payouts_manage' (контроллер), транзакция с
  // адресным локом FOR UPDATE OF <alias> (урок decidePayout / 1fc3e2b),
  // ТРАНЗАКЦИОННЫЙ аудит admin_audit_log (паттерн editClosedCheck — денежная
  // правка не может закоммититься без аудит-строки).

  /**
   * Отмена выплаты владельцем — pending И accepted (решение: строка не
   * удаляется, а помечается cancelled; UI показывает зачёркнутой с причиной).
   *
   * Деньги: у accepted-выплаты есть зеркальный расход (категория «Зарплата»,
   * expense_id). Expenses без soft-delete (ExpensesService.remove — hard
   * DELETE), поэтому сторно = УДАЛЕНИЕ строки расхода с ПОЛНЫМ снапшотом в
   * аудит (кто/когда/что было — восстановимо из detail). Прибыль НЕ меняется
   * (категория «Зарплата» исключена из P&L по имени) — меняются касса и лента
   * расходов. «Выплачено/остаток» пересчитываются сами: суммы считают только
   * status='accepted'. FK salary_payouts.expense_id ON DELETE SET NULL —
   * порядок (сначала DELETE расхода, потом UPDATE статуса) безопасен.
   */
  async cancelPayout(payoutId: string, tenantID: string, actorId: string, reason?: string) {
    try {
      return await this.cancelPayoutAttempt(payoutId, tenantID, actorId, reason);
    } catch (err: any) {
      // 153 review-fix (п.5) — FK-дедлок (40P01) с ручным удалением того же
      // расхода из «Расходов»: их DELETE держит лок на expenses и ждёт наш лок
      // salary_payouts (FK expense_id ON DELETE SET NULL обновляет нашу
      // строку), мы — наоборот. Жертва получает 40P01 с откатом ВСЕЙ
      // транзакции; после коммита соперника expense_id уже NULL — один
      // авторетрай проходит чисто (с честным expenseCompensated=false).
      if (err?.code === '40P01') {
        return await this.cancelPayoutAttempt(payoutId, tenantID, actorId, reason);
      }
      throw err;
    }
  }

  private async cancelPayoutAttempt(payoutId: string, tenantID: string, actorId: string, reason?: string) {
    const reasonClean = reason ? String(reason).trim().slice(0, 500) || null : null;
    const client = await this.pool.connect();
    let result: any;
    let employeeName = 'Сотрудник';
    let employeeId: string | null = null;
    let wasAccepted = false;
    // 153 review-fix (п.4) — честный флаг для клиента (как у reversePayment):
    // false ТОЛЬКО когда у ПРИНЯТОЙ выплаты зеркальный расход не нашёлся
    // (удалили руками раньше / FK обнулил) — владелец проверяет «Расходы»
    // сам. У pending расхода не было — компенсировать нечего, флаг true.
    let expenseCompensated = true;
    let amountLabel = '';
    let typeLabel = 'Зарплата';
    try {
      await client.query('BEGIN');
      const { rows: lockRows } = await client.query(
        `SELECT p.*, u.full_name AS employee_name
           FROM salary_payouts p
           LEFT JOIN users u ON u.id = p.employee_id
          WHERE p.id = $1 AND p.tenant_id = $2
          FOR UPDATE OF p`,
        [payoutId, tenantID],
      );
      if (lockRows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Выплата не найдена' });
      }
      const payout = lockRows[0];
      employeeName = payout.employee_name || employeeName;
      employeeId = payout.employee_id ?? null;
      wasAccepted = payout.status === 'accepted';
      typeLabel = payout.type === 'advance' ? 'Аванс' : 'Зарплата';
      amountLabel = (parseFloat(payout.amount) || 0).toLocaleString('ru-RU');

      if (payout.status === 'cancelled') {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Выплата уже отменена' });
      }
      if (payout.status === 'rejected') {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Выплата отклонена сотрудником — отменять нечего' });
      }

      // Сторно расхода принятой выплаты. Снапшот удаляемой строки уходит в
      // аудит; если расход уже удалили вручную в «Расходах» (FK SET NULL или
      // отсутствующая строка) — отмена продолжается, факт фиксируется.
      let expenseSnapshot: Record<string, unknown> | null = null;
      if (wasAccepted && payout.expense_id) {
        const { rows: expRows } = await client.query(
          `DELETE FROM expenses WHERE id = $1 AND tenant_id = $2
           RETURNING id, category_id, amount, description, date, period_month`,
          [payout.expense_id, tenantID],
        );
        if (expRows.length > 0) {
          const e = expRows[0];
          expenseSnapshot = {
            id: e.id,
            categoryId: e.category_id,
            amount: parseFloat(e.amount) || 0,
            description: e.description,
            date: e.date,
            periodMonth: e.period_month ?? null,
          };
        }
      }
      expenseCompensated = !wasAccepted || expenseSnapshot !== null;

      const { rows: upd } = await client.query(
        `UPDATE salary_payouts
            SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4
          WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'accepted')
          RETURNING *`,
        [payoutId, tenantID, actorId, reasonClean],
      );
      if (upd.length === 0) {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Выплата уже обработана' });
      }
      result = upd[0];

      await this.audit.logTx(
        client,
        { userId: actorId, name: await this.actorNameTx(client, actorId) },
        'salary_payout_cancel',
        {
          targetType: 'salary_payout',
          targetId: payoutId,
          targetName: employeeName,
          detail: {
            tenantId: tenantID,
            before: {
              status: payout.status,
              type: payout.type,
              amount: parseFloat(payout.amount) || 0,
              comment: payout.comment ?? null,
              periodMonth: payout.period_month ?? null,
              decidedAt: payout.decided_at ?? null,
              expenseId: payout.expense_id ?? null,
            },
            expense: expenseSnapshot,
            expenseCompensated,
            reason: reasonClean,
          },
        },
      );

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

    result.user_name = employeeName;

    // Post-commit side-effects. Удалённый расход двигает кассу/ленту расходов
    // (прибыль — нет: «Зарплата» вне P&L) — сброс серверных кэшей отчётов +
    // пуш другим устройствам обновить денежные экраны.
    if (wasAccepted) {
      invalidateReportsForTenant(tenantID);
      this.push.sendDataToTenant(tenantID, actorId, { type: 'cash-changed', tenantId: tenantID }).catch(() => {
        /* best-effort */
      });
    }
    // Сотруднику — честное уведомление (он видел выплату / принимал её).
    // 153 review-fix (п.2в) — data.type: листенер SalaryNotificationContext
    // матчит по нему (как data.type='cash-changed' в App.tsx) и
    // пересинхронизирует confirm-модал, пока тот открыт на устройстве.
    if (employeeId) {
      const note = reasonClean ? ` — ${reasonClean}` : '';
      this.push.sendToUserInTenant(
        employeeId,
        tenantID,
        'salary',
        'Выплата отменена',
        `${typeLabel} ${amountLabel} ₽ отменена владельцем${note}`,
        { type: 'payout-cancelled', kind: 'payout', payoutId, status: 'cancelled' },
      );
    }

    // 153 review-fix (п.4) — клиент показывает «проверьте Расходы», когда
    // расход принятой выплаты не нашёлся (симметрично reversePayment).
    return { ...this.mapPayout(result), expenseCompensated };
  }

  /**
   * Правка PENDING-выплаты (сумма/комментарий). ПРИНЯТУЮ выплату править
   * НЕЛЬЗЯ — только отменить и создать заново: у неё уже есть зеркальный
   * расход и подтверждение сотрудника; «тихая» правка суммы сделала бы расход
   * и подтверждение ложью. Отмена+новая выплата проще и честнее — оба шага
   * оставляют аудит-след и новое подтверждение сотрудника.
   */
  async updatePendingPayout(
    payoutId: string,
    tenantID: string,
    actorId: string,
    dto: { amount?: number; comment?: string },
  ) {
    const hasAmount = dto.amount !== undefined;
    const hasComment = dto.comment !== undefined;
    if (!hasAmount && !hasComment) {
      throw new BadRequestException({ message: 'Укажите сумму или комментарий' });
    }
    let amount: number | undefined;
    if (hasAmount) {
      amount = Number(dto.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException({ message: 'Сумма выплаты должна быть положительной' });
      }
      if (amount > 100_000_000) throw new BadRequestException({ message: 'Сумма слишком велика' });
    }
    const comment = hasComment ? String(dto.comment).trim().slice(0, 500) || null : undefined;

    const client = await this.pool.connect();
    let result: any;
    let employeeName = 'Сотрудник';
    let employeeId: string | null = null;
    let amountChanged = false;
    try {
      await client.query('BEGIN');
      const { rows: lockRows } = await client.query(
        `SELECT p.*, u.full_name AS employee_name
           FROM salary_payouts p
           LEFT JOIN users u ON u.id = p.employee_id
          WHERE p.id = $1 AND p.tenant_id = $2
          FOR UPDATE OF p`,
        [payoutId, tenantID],
      );
      if (lockRows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Выплата не найдена' });
      }
      const payout = lockRows[0];
      employeeName = payout.employee_name || employeeName;
      employeeId = payout.employee_id ?? null;
      if (payout.status !== 'pending') {
        await client.query('ROLLBACK');
        throw new BadRequestException({
          message: 'Изменить можно только выплату со статусом «Ожидает». Принятую — отмените и создайте заново.',
        });
      }

      const sets: string[] = [];
      const vals: any[] = [];
      let i = 1;
      if (hasAmount) {
        sets.push(`amount = $${i++}`);
        vals.push(amount);
        amountChanged = (parseFloat(payout.amount) || 0) !== amount;
      }
      if (comment !== undefined) {
        sets.push(`comment = $${i++}`);
        vals.push(comment);
      }
      vals.push(payoutId, tenantID);
      const { rows: upd } = await client.query(
        `UPDATE salary_payouts SET ${sets.join(', ')}
          WHERE id = $${i++} AND tenant_id = $${i} AND status = 'pending'
          RETURNING *`,
        vals,
      );
      if (upd.length === 0) {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Выплата уже обработана' });
      }
      result = upd[0];

      await this.audit.logTx(
        client,
        { userId: actorId, name: await this.actorNameTx(client, actorId) },
        'salary_payout_update',
        {
          targetType: 'salary_payout',
          targetId: payoutId,
          targetName: employeeName,
          detail: {
            tenantId: tenantID,
            before: { amount: parseFloat(payout.amount) || 0, comment: payout.comment ?? null },
            after: { amount: parseFloat(result.amount) || 0, comment: result.comment ?? null },
          },
        },
      );

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

    result.user_name = employeeName;

    // Сотрудник видел старую сумму в пуше «подтвердите» — сообщаем новую.
    if (employeeId && amountChanged) {
      const formatted = (parseFloat(result.amount) || 0).toLocaleString('ru-RU');
      this.push.sendToUserInTenant(
        employeeId,
        tenantID,
        'salary',
        'Сумма выплаты изменена',
        `Новая сумма: ${formatted} ₽ — подтвердите получение`,
        { kind: 'payout', payoutId, payoutType: result.type, action: 'decide' },
      );
    }

    return this.mapPayout(result);
  }

  /**
   * Сторно LEGACY-выплаты (salary_payments, 012 — расход писался сразу при
   * создании). Строка НЕ удаляется: reversed_at/reversed_by/reversal_reason,
   * суммы «выплачено» её исключают (getAll / getEmployeeMonth), UI зачёркивает.
   *
   * Компенсация зеркального расхода:
   *   1) У НОВЫХ выплат есть прямая связь expense_id (153) — удаляем по ней.
   *   2) У исторических строк связи не было — best-effort-матч: расход
   *      категории «Зарплата» с ТОЙ ЖЕ суммой, датой в окне ±1 сек от даты
   *      выплаты (createPayment писал расход датой выплаты; окно покрывает
   *      µs→ms-огрубление timestamptz при проходе через node-postgres) И
   *      описанием «Зарплата: <имя сотрудника>…» (review-fix: без имени один
   *      «подходящий» расход мог оказаться зарплатой ДРУГОГО сотрудника).
   *      РОВНО ОДИН кандидат → удаляем; НОЛЬ (расход уже удалили вручную /
   *      сотрудника переименовали) → сторно продолжается с флагом
   *      expenseCompensated=false; БОЛЬШЕ ОДНОГО → честный отказ (не
   *      угадываем деньги): владелец удаляет нужный расход вручную и
   *      повторяет отмену.
   * Прибыль не меняется (категория «Зарплата» вне P&L) — меняются касса и
   * лента расходов.
   */
  async reversePayment(paymentId: string, tenantID: string, actorId: string, reason?: string) {
    try {
      return await this.reversePaymentAttempt(paymentId, tenantID, actorId, reason);
    } catch (err: any) {
      // 153 review-fix (п.5) — FK-дедлок (40P01) с ручным удалением расхода:
      // симметрично cancelPayout (см. комментарий там). После отката соперник
      // закоммитил DELETE, FK обнулил expense_id — авторетрай проходит с
      // expenseCompensated=false.
      if (err?.code === '40P01') {
        return await this.reversePaymentAttempt(paymentId, tenantID, actorId, reason);
      }
      throw err;
    }
  }

  private async reversePaymentAttempt(paymentId: string, tenantID: string, actorId: string, reason?: string) {
    const reasonClean = reason ? String(reason).trim().slice(0, 500) || null : null;
    const client = await this.pool.connect();
    let result: any;
    let expenseCompensated = false;
    let employeeName = 'Сотрудник';
    let employeeId: string | null = null;
    let amountLabel = '';
    try {
      await client.query('BEGIN');
      const { rows: lockRows } = await client.query(
        `SELECT sp.*, u.full_name AS user_name
           FROM salary_payments sp
           LEFT JOIN users u ON u.id = sp.user_id
          WHERE sp.id = $1 AND sp.tenant_id = $2
          FOR UPDATE OF sp`,
        [paymentId, tenantID],
      );
      if (lockRows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Выплата не найдена' });
      }
      const payment = lockRows[0];
      employeeName = payment.user_name || employeeName;
      employeeId = payment.user_id ?? null;
      amountLabel = (parseFloat(payment.amount) || 0).toLocaleString('ru-RU');
      if (payment.reversed_at) {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Выплата уже отменена' });
      }

      let expenseSnapshot: Record<string, unknown> | null = null;
      if (payment.expense_id) {
        const { rows: expRows } = await client.query(
          `DELETE FROM expenses WHERE id = $1 AND tenant_id = $2
           RETURNING id, category_id, amount, description, date`,
          [payment.expense_id, tenantID],
        );
        if (expRows.length > 0) {
          const e = expRows[0];
          expenseSnapshot = {
            id: e.id,
            categoryId: e.category_id,
            amount: parseFloat(e.amount) || 0,
            description: e.description,
            date: e.date,
          };
          expenseCompensated = true;
        }
      } else if (payment.user_name) {
        // Историческая строка без expense_id — детерминированный матч,
        // СУЖЕННЫЙ ПО ИМЕНИ (153 review-fix, п.1). Раньше матч по
        // сумма+категория+±1с+LIKE 'Зарплата:%' при «ровно одном НЕВЕРНОМ
        // кандидате» удалял расход ДРУГОГО сотрудника: свой расход удалили
        // руками раньше, а в окне ±1с висит зарплата соседа той же суммы.
        // createPayment всегда пишет описание «Зарплата: <имя> за <месяц>
        // <год>» (см. description выше) — матчим по префиксу с именем
        // (LIKE-спецсимволы имени экранированы). Переименованный/удалённый
        // сотрудник → 0 кандидатов → честный expenseCompensated=false
        // (безопаснее, чем угадывать чужие деньги).
        const { rows: candidates } = await client.query(
          `SELECT e.id FROM expenses e
             JOIN expense_categories c ON c.id = e.category_id
            WHERE e.tenant_id = $1 AND c.tenant_id = $1 AND c.name = 'Зарплата'
              AND e.amount = $2
              AND e.date >= $3::timestamptz - interval '1 second'
              AND e.date <= $3::timestamptz + interval '1 second'
              AND e.description LIKE 'Зарплата: ' || $4 || '%'
            FOR UPDATE OF e`,
          [tenantID, payment.amount, payment.date, SalaryService.escapeLike(payment.user_name)],
        );
        if (candidates.length > 1) {
          await client.query('ROLLBACK');
          throw new BadRequestException({
            message:
              'Найдено несколько подходящих расходов «Зарплата» — удалите нужный расход вручную в разделе «Расходы» и повторите отмену',
          });
        }
        if (candidates.length === 1) {
          const { rows: expRows } = await client.query(
            `DELETE FROM expenses WHERE id = $1 AND tenant_id = $2
             RETURNING id, category_id, amount, description, date`,
            [candidates[0].id, tenantID],
          );
          const e = expRows[0];
          expenseSnapshot = {
            id: e.id,
            categoryId: e.category_id,
            amount: parseFloat(e.amount) || 0,
            description: e.description,
            date: e.date,
          };
          expenseCompensated = true;
        }
      }

      const { rows: upd } = await client.query(
        `UPDATE salary_payments
            SET reversed_at = now(), reversed_by = $3, reversal_reason = $4
          WHERE id = $1 AND tenant_id = $2 AND reversed_at IS NULL
          RETURNING *`,
        [paymentId, tenantID, actorId, reasonClean],
      );
      if (upd.length === 0) {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Выплата уже отменена' });
      }
      result = upd[0];

      await this.audit.logTx(
        client,
        { userId: actorId, name: await this.actorNameTx(client, actorId) },
        'salary_payment_reverse',
        {
          targetType: 'salary_payment',
          targetId: paymentId,
          targetName: employeeName,
          detail: {
            tenantId: tenantID,
            before: {
              amount: parseFloat(payment.amount) || 0,
              monthYear: payment.month_year,
              type: payment.type,
              comment: payment.comment ?? null,
              date: payment.date,
            },
            expense: expenseSnapshot,
            expenseCompensated,
            reason: reasonClean,
          },
        },
      );

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

    // Расход исчез из кассы/ленты — сброс кэшей + пуш другим устройствам.
    invalidateReportsForTenant(tenantID);
    this.push.sendDataToTenant(tenantID, actorId, { type: 'cash-changed', tenantId: tenantID }).catch(() => {
      /* best-effort */
    });
    // 153 review-fix (п.2в) — data.type: листенер SalaryNotificationContext
    // матчит по нему и пересинхронизирует confirm-модал (см. cancelPayout).
    if (employeeId) {
      const note = reasonClean ? ` — ${reasonClean}` : '';
      this.push.sendToUserInTenant(
        employeeId,
        tenantID,
        'salary',
        'Выплата отменена',
        `Выплата ${amountLabel} ₽ отменена владельцем${note}`,
        { type: 'payment-reversed', kind: 'payment', paymentId, reversed: true },
      );
    }

    return {
      id: result.id,
      reversedAt: result.reversed_at,
      reversalReason: result.reversal_reason ?? null,
      expenseCompensated,
      message: expenseCompensated
        ? 'Выплата отменена, связанный расход сторнирован'
        : 'Выплата отменена. Связанный расход не найден — проверьте раздел «Расходы» вручную',
    };
  }

  /**
   * Правка штрафа (сумма/причина). Штраф — standalone-вычет: он НЕ запечён ни
   * в чеках, ни в расходах — penaltiesAmount/finesAmount суммируются на лету
   * (getAll / getEmployeeMonth), поэтому правка не требует никакого пересчёта:
   * следующая выборка отдаёт новые суммы. Семантика вычета сохранена 1:1.
   */
  async updatePenalty(id: string, tenantID: string, actorId: string, dto: { amount?: number; reason?: string }) {
    const hasAmount = dto.amount !== undefined;
    const hasReason = dto.reason !== undefined;
    if (!hasAmount && !hasReason) {
      throw new BadRequestException({ message: 'Укажите сумму или причину' });
    }
    let amount: number | undefined;
    if (hasAmount) {
      amount = Number(dto.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException({ message: 'Сумма штрафа должна быть положительной' });
      }
      if (amount > 100_000_000) throw new BadRequestException({ message: 'Сумма слишком велика' });
    }
    let reason: string | undefined;
    if (hasReason) {
      reason = String(dto.reason).trim().slice(0, 500);
      // Причина обязательна (NOT NULL + non-blank CHECK, 100) — пустую не даём.
      if (!reason) throw new BadRequestException({ message: 'Укажите причину штрафа' });
    }

    const client = await this.pool.connect();
    let result: any;
    let employeeName = 'Сотрудник';
    let employeeId: string | null = null;
    try {
      await client.query('BEGIN');
      const { rows: lockRows } = await client.query(
        `SELECT pen.*, u.full_name AS user_name
           FROM salary_penalties pen
           LEFT JOIN users u ON u.id = pen.user_id
          WHERE pen.id = $1 AND pen.tenant_id = $2
          FOR UPDATE OF pen`,
        [id, tenantID],
      );
      if (lockRows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Штраф не найден' });
      }
      const penalty = lockRows[0];
      employeeName = penalty.user_name || employeeName;
      employeeId = penalty.user_id ?? null;

      const sets: string[] = [];
      const vals: any[] = [];
      let i = 1;
      if (hasAmount) {
        sets.push(`amount = $${i++}`);
        vals.push(amount);
      }
      if (reason !== undefined) {
        sets.push(`description = $${i++}`);
        vals.push(reason);
      }
      vals.push(id, tenantID);
      const { rows: upd } = await client.query(
        `UPDATE salary_penalties SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
        vals,
      );
      result = upd[0];
      result.user_name = employeeName;

      await this.audit.logTx(
        client,
        { userId: actorId, name: await this.actorNameTx(client, actorId) },
        'salary_penalty_update',
        {
          targetType: 'salary_penalty',
          targetId: id,
          targetName: employeeName,
          detail: {
            tenantId: tenantID,
            before: { amount: parseFloat(penalty.amount) || 0, description: penalty.description },
            after: { amount: parseFloat(result.amount) || 0, description: result.description },
          },
        },
      );

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

    // Сотрудник получал пуш «Штраф наложен» со старыми данными — сообщаем правку.
    if (employeeId) {
      const formatted = (parseFloat(result.amount) || 0).toLocaleString('ru-RU');
      this.push.sendToUserInTenant(
        employeeId,
        tenantID,
        'penalty',
        'Штраф изменён',
        `${formatted} ₽ — ${result.description}`,
        { kind: 'penalty', penaltyId: id },
      );
    }

    return this.mapPenalty(result);
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
      // 149 — «за какой месяц» ('YYYY-MM'); null = месяц выписки (МСК).
      periodMonth: (r.period_month as string | null) ?? null,
      // 153 — отмена владельцем: строка остаётся (UI зачёркивает с причиной),
      // из «выплачено» исключена (суммируется только status='accepted').
      cancelledAt: r.cancelled_at ?? null,
      cancelledBy: r.cancelled_by ?? undefined,
      cancelReason: r.cancel_reason ?? null,
    };
  }

  /**
   * Round 14 (149) — «Выплата вне программы»: владелец фиксирует выплату
   * получателю БЕЗ аккаунта в системе (маркетолог, уборщица) — свободное имя,
   * сумма, месяц отнесения. Пишется сразу approved-расходом под категорией
   * «Выплаты вне программы» (НЕ «Зарплата» — та исключена из P&L по имени), с
   * period_month → прибыль назначенного месяца уменьшается, касса — по дате
   * факта. Подтверждения получателя нет — он не пользователь системы.
   */
  async createOutsidePayout(
    tenantID: string,
    createdBy: string,
    dto: { recipientName: string; amount: number; periodMonth: string; comment?: string; date?: string },
  ) {
    const recipientName = (dto.recipientName ?? '').trim();
    if (!recipientName) throw new BadRequestException({ message: 'Имя получателя обязательно' });
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({ message: 'Сумма выплаты должна быть положительной' });
    }
    if (amount > 100_000_000) throw new BadRequestException({ message: 'Сумма слишком велика' });
    if (!/^\d{4}-\d{2}$/.test(dto.periodMonth ?? '')) {
      throw new BadRequestException({ message: 'Месяц отнесения обязателен (формат YYYY-MM)' });
    }
    return this.expenses.recordOutsideProgramPayout(tenantID, {
      recipientName,
      amount,
      periodMonth: dto.periodMonth,
      comment: dto.comment ?? null,
      date: dto.date ?? null,
      createdBy,
    });
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
    // Half-open [monthStart, nextMonthStart) по бизнес-таймзоне продукта —
    // Europe/Moscow (UTC+3, без летнего времени). Раньше границы строились в
    // чистом UTC: чеки/начисления 00:00–03:00 МСК первого числа уезжали в
    // соседний месяц относительно остальных зарплатных экранов.
    const MSK_OFFSET_MS = 3 * 60 * 60 * 1000; // Europe/Moscow = UTC+3
    const monthStart = new Date(Date.UTC(year, mon - 1, 1) - MSK_OFFSET_MS).toISOString();
    const nextMonthStart = new Date(Date.UTC(year, mon, 1) - MSK_OFFSET_MS).toISOString();

    const { rows: userRows } = await this.pool.query(
      `SELECT full_name, COALESCE(salary_percent, 0) AS salary_percent,
              COALESCE(product_salary_percent, 0) AS product_salary_percent
         FROM users WHERE id = $1 AND tenant_id = $2`,
      [employeeId, tenantID],
    );
    if (userRows.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });
    const user = userRows[0];

    // 150 — effective-проценты ЗАПРОШЕННОГО месяца: последняя строка истории
    // ставок с month <= запрошенного ('YYYY-MM' сравнивается лексикографически
    // корректно); NULL-колонка строки или отсутствие строк → текущие users.*.
    // Прошлый месяц с исторической ставкой 40% показывает 40%, даже если сейчас
    // ставка 50%.
    const { rows: rateRows } = await this.pool.query(
      `SELECT salary_percent, product_salary_percent
         FROM master_rate_history
        WHERE tenant_id = $1 AND user_id = $2 AND month <= $3
        ORDER BY month DESC
        LIMIT 1`,
      [tenantID, employeeId, monthYear],
    );
    const effSalaryPercent =
      rateRows.length > 0 && rateRows[0].salary_percent !== null
        ? parseFloat(rateRows[0].salary_percent) || 0
        : parseFloat(user.salary_percent) || 0;
    const effProductSalaryPercent =
      rateRows.length > 0 && rateRows[0].product_salary_percent !== null
        ? parseFloat(rateRows[0].product_salary_percent) || 0
        : parseFloat(user.product_salary_percent) || 0;

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

    // Premiums ASSIGNED to the month (cash premiums add to earnings).
    // Round 16 (баг 2) — отнесение по premiumMonthExpr (period_month_year,
    // fallback месяц created_at МСК) — зеркало payouts ниже (149). Раньше —
    // по created_at: премия «за июль», выданная 3 августа, жила в августовской
    // карточке, а июльская её не видела.
    const { rows: premRows } = await this.pool.query(
      `SELECT sp.*, u.full_name AS user_name, a.full_name AS awarder_name
         FROM salary_premiums sp
         LEFT JOIN users u ON u.id = sp.user_id
         LEFT JOIN users a ON a.id = sp.awarded_by
        WHERE sp.tenant_id = $1 AND sp.user_id = $2
          AND ${SalaryService.premiumMonthExpr('sp')} = $3
        ORDER BY sp.created_at DESC`,
      [tenantID, employeeId, monthYear],
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

    // Payouts ASSIGNED to the month (any status). Accepted ones count as paid.
    // 149 — отнесение по COALESCE(period_month, месяц created_at МСК): выплата
    // «за июль», выписанная 5 августа, живёт в июльской карточке (и вычитается
    // из июльского «к выплате»), а не в августовской.
    const { rows: payoutRows } = await this.pool.query(
      `SELECT p.*, u.full_name AS user_name, c.full_name AS creator_name
         FROM salary_payouts p
         LEFT JOIN users u ON u.id = p.employee_id
         LEFT JOIN users c ON c.id = p.created_by
        WHERE p.tenant_id = $1 AND p.employee_id = $2
          AND COALESCE(p.period_month, to_char(p.created_at AT TIME ZONE '${SalaryService.BUSINESS_TZ}', 'YYYY-MM')) = $3
        ORDER BY p.created_at DESC`,
      [tenantID, employeeId, monthYear],
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
      // 153 — сторно: строка видна (зачёркнутой), из сумм исключена.
      reversedAt: p.reversed_at ?? null,
      reversalReason: p.reversal_reason ?? null,
    }));
    // 153 — сторнированные выплаты не уменьшают долг месяца.
    const legacyPaidAmount = payments.reduce((sum, p) => sum + (p.reversedAt ? 0 : p.amount || 0), 0);

    const totalEarnings = serviceEarnings + productEarnings + premiumsAmount + motivationAmount;
    const paidAmount = acceptedPayoutsAmount + legacyPaidAmount;

    return {
      userId: employeeId,
      userName: user.full_name,
      month: monthYear,
      // 150 — проценты, ДЕЙСТВОВАВШИЕ в запрошенном месяце (история ставок,
      // fallback текущие users.*), а не всегда-текущие.
      salaryPercent: effSalaryPercent,
      productSalaryPercent: effProductSalaryPercent,
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
