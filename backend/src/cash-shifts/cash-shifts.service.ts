import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { PushService } from '../push/push.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CollectCashDto } from './dto/collect-cash.dto';
import { actorPointId, pointFilterSql } from '../common/point-scope';
import { assignedToPointSql } from '../users/user-points-sql';

/** Any pg connection we can run a query on — the Pool or a checked-out client. */
type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/** Parse a NUMERIC/text money value to a JS number (NULL/garbage → 0). */
function num(v: unknown): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals — money is stored NUMERIC(14,2); avoids 0.1+0.2 drift. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Money for push bodies: без копеек, с русским разделителем тысяч. */
function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

/** Разбивка окна смены «по принявшим оплату» (155). */
export interface AcceptorTotal {
  userId: string | null;
  name: string | null;
  cashSales: number;
  cardSales: number;
  checksCount: number;
}

/**
 * Кассовая смена / Z-отчёт / Инкассация.
 *
 * The Z-report reconciles the PHYSICAL cash drawer against recorded activity
 * for one shift window [opened_at, closed_at ?? now()]. It is built by READING
 * the existing `checks` / `expenses` tables — this service never writes to them.
 *
 * Aggregation (mirrors reports.getCashFlow so the numbers tie out with the
 * existing «Касса по дням» screen):
 *   • cashSales  = SUM(checks.cash_amount)  WHERE is_deferred=false in window
 *   • cardSales  = SUM(checks.card_amount)  WHERE is_deferred=false in window
 *   A split-payment check (paymentMethod='cash_card') stores its cash portion in
 *   cash_amount and its card portion in card_amount, so summing each column
 *   counts only the matching tender — splits are handled for free. A RETURNED
 *   check already had its cash_amount/card_amount reduced in place by
 *   returns.service (cash drawn down first, then card), so refunds are netted
 *   out automatically; a fully-returned check contributes 0.
 *
 *   • cashExpenses = SUM(expenses.amount) for APPROVED expenses in window.
 *     Expenses carry no tender flag, so for drawer reconciliation we treat
 *     every approved expense as paid from the till (cash out). Salary payouts
 *     are NOT excluded here (unlike the P&L report) because cash physically
 *     leaving the drawer must reduce the expected balance.
 *
 *   • collectionsTotal = SUM(cash_collections.amount) for this shift_id.
 *
 *   • cashReturns (164) — НАЛИЧНАЯ часть возвратов, ОФОРМЛЕННЫХ В ЭТОМ ОКНЕ
 *     (check_returns.created_at), но по чекам, которые в окно НЕ попадают.
 *     ЗАЧЕМ ЭТОТ ТЕРМ. Возврат уменьшает cash_amount НА ИСХОДНОМ ЧЕКЕ, а чек
 *     датирован днём ПРОДАЖИ. Пока продажа и возврат в одном окне, вычет уже
 *     сидит в cashSales (и второй раз его вычитать нельзя — отсюда условие
 *     «чек НЕ в окне»). Возврат же по чеку ПРОШЛОЙ смены уезжал вычетом в
 *     закрытую смену: деньги из ящика выдали сегодня, а сегодняшний ожидаемый
 *     остаток о них не знал → фантомная НЕДОСТАЧА и пуш директору о
 *     расхождении. Дата факта здесь — та же, по которой возвраты показывает
 *     «Движение денег» (reports.getCashFlow, строка refunds).
 *     Филиал берётся У ЧЕКА: своей точки у возврата нет и не нужно.
 *
 *   • installmentCash (164) — погашения рассрочки, принятые НАЛИЧНЫМИ в окне
 *     (installment_payments.paid_at, payment_method <> 'card'). Это живые
 *     деньги, физически положенные в ящик, но чек-источник датирован днём
 *     продажи, поэтому в cashSales их нет вовсе: Z-отчёт каждый день показывал
 *     ИЗЛИШЕК на сумму принятых погашений. Филиал — по чеку плана, тем же
 *     предикатом, что в «Движении денег» (paidPointFilter).
 *
 *   expected = opening + cashSales + installmentCash − cashExpenses
 *              − cashReturns − collectionsTotal
 *   difference = closing (фактический нал) − expected   (>0 излишек, <0 недостача)
 *
 * ФИЛИАЛЫ (161). Кассовая смена — СВОЯ у каждого филиала (решение владельца):
 * у каждой точки свой денежный ящик, и Z-отчёт обязан сходиться по ящику, а не
 * по сети. Поэтому:
 *   • cash_shifts.point_id — филиал, на котором смену ОТКРЫЛИ;
 *   • окно Z-отчёта (продажи + наличные расходы) режется точкой САМОЙ СМЕНЫ,
 *     а не текущей точкой читающего: Z-отчёт — исторический документ, он не
 *     имеет права меняться от того, кто и откуда его открыл;
 *   • «одна открытая смена» стала «одна открытая НА ФИЛИАЛ» — частичный
 *     уникальный индекс переехал на (tenant_id, COALESCE(point_id, нулевой
 *     uuid)) в миграции 161 (см. её комментарий: NULL сам с собой не
 *     конфликтует, поэтому одноточечный тенант без суррогата потерял бы
 *     защиту);
 *   • размен переносится ВНУТРИ филиала: следующая смена точки А стартует с
 *     остатка предыдущей смены точки А.
 *
 * СЕЙФ ОСТАЁТСЯ ОДИН НА КОМПАНИЮ — сознательно. Баланс сейфа считается как
 * Σdeposit + Σadjustment − Σcollection по insert-only ленте: депозит рождается
 * при закрытии смены (филиал известен), а инкассация ИЗ сейфа делается
 * владельцем и филиала может не иметь вовсе (тенант без филиалов). Точка у ЧАСТИ
 * строк означала бы, что подсуммы по филиалам не сходятся с реальным
 * остатком, — а это либо запрет законной инкассации, либо «лишние» деньги в
 * филиале. Один сейф на кабинет — и физически так, и арифметически безопасно.
 */
@Injectable()
export class CashShiftsService {
  private readonly logger = new Logger('CashShiftsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private push: PushService,
  ) {}

  // ─── Row mapping ───────────────────────────────────────────────────────
  private mapShift(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      openedBy: r.opened_by ?? null,
      openedByName: r.opened_by_name ?? null,
      openedAt: r.opened_at,
      openingAmount: num(r.opening_amount),
      closedBy: r.closed_by ?? null,
      closedByName: r.closed_by_name ?? null,
      closedAt: r.closed_at ?? null,
      closingAmount: r.closing_amount === null || r.closing_amount === undefined ? null : num(r.closing_amount),
      expectedAmount: r.expected_amount === null || r.expected_amount === undefined ? null : num(r.expected_amount),
      difference: r.difference === null || r.difference === undefined ? null : num(r.difference),
      status: r.status,
      note: r.note ?? null,
      createdAt: r.created_at,
      // 161 — филиал, на котором смену открыли (null у одноточечного тенанта).
      pointId: r.point_id ?? null,
      // 155 — пересменка: null на сменах, закрытых до миграции.
      toSafeAmount: r.to_safe_amount === null || r.to_safe_amount === undefined ? null : num(r.to_safe_amount),
      carryoverAmount: r.carryover_amount === null || r.carryover_amount === undefined ? null : num(r.carryover_amount),
    };
  }

  private mapSafeTransaction(r: any) {
    return {
      id: r.id,
      type: r.type,
      amount: num(r.amount),
      shiftId: r.shift_id ?? null,
      actorId: r.actor_id ?? null,
      actorName: r.actor_name ?? null,
      note: r.note ?? null,
      createdAt: r.created_at,
    };
  }

  private mapCollection(r: any) {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      shiftId: r.shift_id,
      amount: num(r.amount),
      collectedBy: r.collected_by ?? null,
      collectedByName: r.collected_by_name ?? null,
      collectedAt: r.collected_at,
      note: r.note ?? null,
      createdAt: r.created_at,
    };
  }

  // ─── Single-row fetch with opener/closer names ─────────────────────────
  private async fetchShiftRow(
    db: Queryable,
    tenantID: string,
    id: string,
    pointId: string | null = null,
  ): Promise<any | null> {
    const params: unknown[] = [id, tenantID];
    const pointFilter = pointFilterSql('cs', pointId, params);
    const { rows } = await db.query(
      `SELECT cs.*, ob.full_name AS opened_by_name, cb.full_name AS closed_by_name
         FROM cash_shifts cs
         LEFT JOIN users ob ON ob.id = cs.opened_by AND ob.tenant_id = cs.tenant_id
         LEFT JOIN users cb ON cb.id = cs.closed_by AND cb.tenant_id = cs.tenant_id
        WHERE cs.id = $1 AND cs.tenant_id = $2${pointFilter}`,
      params,
    );
    return rows[0] ?? null;
  }

  /**
   * Live aggregation over the shift window. `windowEnd` is the closed_at of a
   * closed shift or now() for an open one. Tenant-scoped on every query.
   */
  /**
   * 161 — `pointId` приходит ОТ СМЕНЫ (cash_shifts.point_id), а не от актора:
   * Z-отчёт филиала А обязан считать только чеки и расходы филиала А, и обязан
   * считать их одинаково у кассира, у владельца и через месяц в истории.
   */
  private async computeFigures(
    db: Queryable,
    tenantID: string,
    shiftId: string,
    openedAt: string,
    windowEnd: string,
    pointId: string | null,
  ): Promise<{
    cashSales: number;
    cardSales: number;
    totalRevenue: number;
    checksCount: number;
    cashExpenses: number;
    cashReturns: number;
    installmentCash: number;
    collectionsTotal: number;
    perAcceptor: AcceptorTotal[];
  }> {
    // Sales — mirror reports.getCashFlow exactly: only non-deferred checks,
    // sum cash_amount / card_amount columns (split & return aware). Window is
    // an inclusive timestamptz range on checks.date (the field getCashFlow and
    // the dashboard report on; a draft closed mid-shift has its date rewritten
    // to the activation moment, so it lands in the right window).
    const salesParams: unknown[] = [tenantID, openedAt, windowEnd];
    const salesPoint = pointFilterSql(null, pointId, salesParams);
    const { rows: salesRows } = await db.query(
      `SELECT COALESCE(SUM(cash_amount), 0)    AS cash_sales,
              COALESCE(SUM(card_amount), 0)    AS card_sales,
              COALESCE(SUM(total_revenue), 0)  AS total_revenue,
              COUNT(*)                         AS checks_count
         FROM checks
        WHERE tenant_id = $1 AND is_deferred = false AND deleted_at IS NULL
          AND date >= $2 AND date <= $3${salesPoint}`,
      salesParams,
    );

    // Cash expenses — every APPROVED expense in the window is treated as cash
    // out of the drawer (expenses carry no tender flag). NULL approval_status
    // is legacy-approved.
    const expParams: unknown[] = [tenantID, openedAt, windowEnd];
    const expPoint = pointFilterSql(null, pointId, expParams);
    const { rows: expRows } = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS cash_expenses
         FROM expenses
        WHERE tenant_id = $1
          AND COALESCE(approval_status, 'approved') = 'approved'
          AND date >= $2 AND date <= $3${expPoint}`,
      expParams,
    );

    // ВОЗВРАТЫ ПО ДАТЕ ФАКТА (164). Вычитаем только те, чей чек-источник НЕ
    // попадает в окно смены ТЕМ ЖЕ предикатом, что выборка продаж выше
    // (дата в окне + не драфт + не в корзине + тот же филиал): иначе возврат,
    // оформленный в день продажи, вычелся бы ДВАЖДЫ — один раз реверсом
    // cash_amount внутри cashSales, второй раз этой строкой.
    // `ch.deleted_at IS NULL` во внешнем условии — симметрия с «Движением
    // денег»: у чека в корзине деньги уже сняты реверсом footprint'а, и
    // вычитать их ещё раз из ящика нельзя.
    const retParams: unknown[] = [tenantID, openedAt, windowEnd];
    const retPoint = pointFilterSql('ch', pointId, retParams);
    const { rows: retRows } = await db.query(
      `SELECT COALESCE(SUM(cr.refund_cash_amount), 0) AS cash_returns
         FROM check_returns cr
         JOIN checks ch ON ch.id = cr.check_id AND ch.tenant_id = cr.tenant_id
        WHERE cr.tenant_id = $1
          AND cr.created_at >= $2 AND cr.created_at <= $3
          AND ch.deleted_at IS NULL
          AND NOT (ch.date >= $2 AND ch.date <= $3 AND ch.is_deferred = false)${retPoint}`,
      retParams,
    );

    // ПОГАШЕНИЯ РАССРОЧКИ НАЛИЧНЫМИ (164) — живые деньги, принятые в ящик в
    // этом окне. Строки до миграции 119 (payment_method NULL) считаются налом —
    // то же решение владельца, что в reports.getCashFlow (paid_cash).
    // Филиал — через чек плана: собственной точки у платежа нет, и платёж без
    // живого чека-источника филиалу не атрибутируется (симметрия с «Движением
    // денег»).
    const instParams: unknown[] = [tenantID, openedAt, windowEnd];
    let instPoint = '';
    if (pointId) {
      instParams.push(pointId);
      instPoint =
        ` AND EXISTS (SELECT 1 FROM checks ch WHERE ch.id = pl.check_id` +
        ` AND ch.tenant_id = $1 AND ch.deleted_at IS NULL AND ch.point_id = $${instParams.length})`;
    }
    const { rows: instRows } = await db.query(
      `SELECT COALESCE(SUM(p.amount), 0) AS installment_cash
         FROM installment_payments p
         JOIN installment_plans pl ON pl.id = p.plan_id AND pl.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1
          AND p.paid_at >= $2 AND p.paid_at <= $3
          AND COALESCE(p.payment_method, 'cash') <> 'card'${instPoint}`,
      instParams,
    );

    // Инкассация — keyed by shift_id (always created during this shift).
    const { rows: colRows } = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS collections
         FROM cash_collections
        WHERE tenant_id = $1 AND shift_id = $2`,
      [tenantID, shiftId],
    );

    // 155 — разбивка «по принявшим оплату»: accepted_by с fallback на
    // master_id (чеки до миграции). Оба NULL → строка userId=null
    // («Не распределено»).
    const accParams: unknown[] = [tenantID, openedAt, windowEnd];
    const accPoint = pointFilterSql('c', pointId, accParams);
    const { rows: accRows } = await db.query(
      `SELECT COALESCE(c.accepted_by, c.master_id)     AS user_id,
              u.full_name                              AS name,
              COALESCE(SUM(c.cash_amount), 0)          AS cash_sales,
              COALESCE(SUM(c.card_amount), 0)          AS card_sales,
              COUNT(*)                                 AS checks_count
         FROM checks c
         LEFT JOIN users u ON u.id = COALESCE(c.accepted_by, c.master_id) AND u.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.is_deferred = false AND c.deleted_at IS NULL
          AND c.date >= $2 AND c.date <= $3${accPoint}
        GROUP BY 1, 2
        ORDER BY cash_sales DESC, name ASC NULLS LAST`,
      accParams,
    );

    return {
      cashSales: num(salesRows[0].cash_sales),
      cardSales: num(salesRows[0].card_sales),
      totalRevenue: num(salesRows[0].total_revenue),
      checksCount: parseInt(salesRows[0].checks_count, 10) || 0,
      cashExpenses: num(expRows[0].cash_expenses),
      cashReturns: num(retRows[0].cash_returns),
      installmentCash: num(instRows[0].installment_cash),
      collectionsTotal: num(colRows[0].collections),
      perAcceptor: accRows.map((r: any) => ({
        userId: r.user_id ?? null,
        name: r.name ?? null,
        cashSales: num(r.cash_sales),
        cardSales: num(r.card_sales),
        checksCount: parseInt(r.checks_count, 10) || 0,
      })),
    };
  }

  /**
   * ОЖИДАЕМЫЙ НАЛ В ЯЩИКЕ — ЕДИНСТВЕННОЕ МЕСТО ФОРМУЛЫ. Её считают два пути
   * (живой Z-отчёт в assembleReport и заморозка при close), и разъехавшиеся
   * копии означали бы, что кассир закрывает смену по одной цифре, а отчёт
   * показывает другую.
   */
  private static expectedCash(
    opening: number,
    f: {
      cashSales: number;
      installmentCash: number;
      cashExpenses: number;
      cashReturns: number;
      collectionsTotal: number;
    },
  ): number {
    return round2(opening + f.cashSales + f.installmentCash - f.cashExpenses - f.cashReturns - f.collectionsTotal);
  }

  /**
   * Build the full Z-report for a shift row. For an OPEN shift everything is
   * computed live (expected = live, factual/difference = null). For a CLOSED
   * shift the headline expected/factual/difference are the values FROZEN at
   * close (a Z-report must stay a stable historical document), while the
   * breakdown is recomputed over the now-frozen window.
   */
  private async assembleReport(db: Queryable, tenantID: string, shiftRow: any) {
    const isClosed = shiftRow.status === 'closed';
    const windowEnd =
      isClosed && shiftRow.closed_at ? new Date(shiftRow.closed_at).toISOString() : new Date().toISOString();
    const openedAt = new Date(shiftRow.opened_at).toISOString();

    // Точка — У СМЕНЫ: Z-отчёт не зависит от того, кто и из какого филиала
    // его открыл.
    const figures = await this.computeFigures(
      db,
      tenantID,
      shiftRow.id,
      openedAt,
      windowEnd,
      shiftRow.point_id ?? null,
    );

    const { rows: colRows } = await db.query(
      `SELECT cc.*, u.full_name AS collected_by_name
         FROM cash_collections cc
         LEFT JOIN users u ON u.id = cc.collected_by AND u.tenant_id = cc.tenant_id
        WHERE cc.tenant_id = $1 AND cc.shift_id = $2
        ORDER BY cc.collected_at ASC`,
      [tenantID, shiftRow.id],
    );

    // 155 — фактическая сдача по сотрудникам (пусто, если смену закрыли одной
    // общей суммой) + текущий баланс сейфа.
    const { rows: setRows } = await db.query(
      `SELECT s.user_id, u.full_name AS name, s.expected_amount, s.actual_amount
         FROM cash_shift_settlements s
         LEFT JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 AND s.shift_id = $2
        ORDER BY s.actual_amount DESC, name ASC NULLS LAST`,
      [tenantID, shiftRow.id],
    );
    const safeBalance = await this.safeBalance(tenantID, db);

    const opening = num(shiftRow.opening_amount);
    const expectedLive = CashShiftsService.expectedCash(opening, figures);

    let expectedAmount: number;
    let factualAmount: number | null;
    let difference: number | null;
    if (isClosed) {
      expectedAmount =
        shiftRow.expected_amount === null || shiftRow.expected_amount === undefined
          ? expectedLive
          : num(shiftRow.expected_amount);
      factualAmount =
        shiftRow.closing_amount === null || shiftRow.closing_amount === undefined ? null : num(shiftRow.closing_amount);
      difference =
        shiftRow.difference === null || shiftRow.difference === undefined
          ? factualAmount !== null
            ? round2(factualAmount - expectedAmount)
            : null
          : num(shiftRow.difference);
    } else {
      expectedAmount = expectedLive;
      factualAmount = null;
      difference = null;
    }

    return {
      shift: this.mapShift(shiftRow),
      cashSales: figures.cashSales,
      cardSales: figures.cardSales,
      totalRevenue: figures.totalRevenue,
      cashExpenses: figures.cashExpenses,
      // 164 — отдельные строки Z-отчёта: выдано из ящика по возвратам прошлых
      // смен и принято в ящик по рассрочке. Обе уже учтены в expectedAmount.
      cashReturns: figures.cashReturns,
      installmentCash: figures.installmentCash,
      collectionsTotal: figures.collectionsTotal,
      checksCount: figures.checksCount,
      openingAmount: opening,
      expectedAmount,
      factualAmount,
      difference,
      collections: colRows.map((r) => this.mapCollection(r)),
      windowStart: openedAt,
      windowEnd,
      perAcceptor: figures.perAcceptor,
      settlements: setRows.map((r: any) => ({
        userId: r.user_id ?? null,
        name: r.name ?? null,
        expectedAmount: num(r.expected_amount),
        actualAmount: num(r.actual_amount),
      })),
      safeBalance,
    };
  }

  /**
   * 155 — баланс сейфа: Σ deposit + Σ adjustment − Σ collection.
   * 161 — ОСТАЁТСЯ ТЕНАНТНЫМ (обоснование — в шапке файла): сейф один на
   * компанию, а частичная точка у insert-only ленты ломает арифметику остатка.
   */
  private async safeBalance(tenantID: string, db: Queryable = this.pool): Promise<number> {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'collection' THEN -amount ELSE amount END), 0) AS balance
         FROM safe_transactions
        WHERE tenant_id = $1`,
      [tenantID],
    );
    return round2(num(rows[0].balance));
  }

  // ─── Open ──────────────────────────────────────────────────────────────
  async open(user: JwtPayload, dto: OpenShiftDto) {
    // «НИЧЬИХ» КАССОВЫХ СМЕН НЕ БЫВАЕТ. Смена без филиала считала бы Z-отчёт по
    // чекам ВСЕЙ сети — и те же чеки попали бы во второй раз в Z-отчёт филиала,
    // где они и были пробиты. Двойной пересчёт денежного ящика недопустим.
    //
    // 163: смена открывается в ФИЛИАЛЕ СЕССИИ кассира — он выбран при входе,
    // поэтому вопроса «в каком филиале открываем» больше не существует и
    // отказа «Выберите филиал» здесь нет. Одноточечный тенант (филиалов нет
    // вовсе) получает null и ведёт себя ровно как прежде.
    const pointId = actorPointId(user);

    // App-level guard (fast, friendly error). Партиальный уникальный индекс
    // uq_cash_shifts_one_open_per_point — race-proof backstop ниже. Проверка
    // НА ФИЛИАЛ: смена филиала Б больше не мешает открыть смену филиала А.
    const existingParams: unknown[] = [user.tenantID];
    const existingPoint = pointFilterSql(null, pointId, existingParams);
    const { rows: existing } = await this.pool.query(
      `SELECT id FROM cash_shifts WHERE tenant_id = $1 AND status = 'open'${existingPoint} LIMIT 1`,
      existingParams,
    );
    if (existing.length > 0) {
      throw new ConflictException({ message: 'Смена уже открыта' });
    }

    // 155 — без openingAmount стартуем с размена, оставленного последней
    // закрытой сменой. Смены, закрытые до миграции (carryover_amount IS NULL),
    // оставляли ВСЁ в кассе → fallback closing_amount; смен не было → 0.
    let opening: number;
    if (dto.openingAmount === undefined || dto.openingAmount === null) {
      // 161 — размен переносится ВНУТРИ филиала: деньги, оставленные в ящике
      // точки А, не могут стать разменом точки Б.
      const lastParams: unknown[] = [user.tenantID];
      const lastPoint = pointFilterSql(null, pointId, lastParams);
      const { rows: lastRows } = await this.pool.query(
        `SELECT COALESCE(carryover_amount, closing_amount, 0) AS carryover
           FROM cash_shifts
          WHERE tenant_id = $1 AND status = 'closed'${lastPoint}
          ORDER BY closed_at DESC NULLS LAST
          LIMIT 1`,
        lastParams,
      );
      opening = round2(num(lastRows[0]?.carryover));
    } else {
      opening = round2(num(dto.openingAmount));
    }
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO cash_shifts (tenant_id, opened_by, opening_amount, status, note, point_id)
         VALUES ($1, $2, $3, 'open', $4, $5)
         RETURNING id`,
        [user.tenantID, user.userID, opening, dto.note ?? null, pointId],
      );
      const row = await this.fetchShiftRow(this.pool, user.tenantID, rows[0].id);
      return this.assembleReport(this.pool, user.tenantID, row);
    } catch (err: any) {
      // 23505 = unique_violation on the partial index → a concurrent open won.
      if (err?.code === '23505') {
        throw new ConflictException({ message: 'Смена уже открыта' });
      }
      this.logger.error(`Cash shift open error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    }
  }

  // ─── Close ─────────────────────────────────────────────────────────────
  async close(user: JwtPayload, id: string, dto: CloseShiftDto) {
    const client = await this.pool.connect();
    // Итоги закрытия — для пуша директорам ПОСЛЕ коммита.
    let closedFigures: {
      cashSales: number;
      cardSales: number;
      toSafe: number;
      carryover: number;
      difference: number;
    } | null = null;
    try {
      await client.query('BEGIN');
      // Lock the row so two concurrent closes can't both compute & write.
      // 161 — плюс фильтр филиала: кассир точки А не должен закрыть смену
      // точки Б по прямому обращению к API (id смены он мог увидеть раньше,
      // до перевода на другой филиал). Филиала нет только у одноточечного тенанта — там фильтра нет.
      const lockParams: unknown[] = [id, user.tenantID];
      const lockPoint = pointFilterSql(null, actorPointId(user), lockParams);
      const { rows } = await client.query(
        `SELECT * FROM cash_shifts WHERE id = $1 AND tenant_id = $2${lockPoint} FOR UPDATE`,
        lockParams,
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Смена не найдена' });
      }
      const shift = rows[0];
      if (shift.status !== 'open') {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Смена уже закрыта' });
      }

      const closedAt = new Date().toISOString();
      const openedAt = new Date(shift.opened_at).toISOString();
      const figures = await this.computeFigures(client, user.tenantID, id, openedAt, closedAt, shift.point_id ?? null);

      const opening = num(shift.opening_amount);
      const expected = CashShiftsService.expectedCash(opening, figures);
      const closing = round2(num(dto.closingAmount));
      const difference = round2(closing - expected);

      // 155 — пересменка: часть нала уходит в сейф, остаток — размен на
      // завтра. Без toSafeAmount (старые клиенты) всё остаётся в кассе.
      const toSafe = round2(num(dto.toSafeAmount ?? 0));
      if (toSafe < 0 || toSafe > closing) {
        await client.query('ROLLBACK');
        throw new BadRequestException({
          message: `Сумма в сейф (${fmtMoney(toSafe)} ₽) не может превышать фактический нал (${fmtMoney(closing)} ₽)`,
        });
      }
      const carryover = round2(closing - toSafe);

      // 155 — сдача по сотрудникам: Σ actual обязана сойтись с фактическим
      // налом (допуск копейка на float-арифметику клиента).
      const settlements = dto.settlements ?? [];
      if (settlements.length > 0) {
        const actualSum = round2(settlements.reduce((sum, s) => sum + num(s.actualAmount), 0));
        if (Math.abs(actualSum - closing) > 0.01) {
          await client.query('ROLLBACK');
          throw new BadRequestException({
            message: `Сумма сдач по сотрудникам (${fmtMoney(actualSum)} ₽) не совпадает с фактическим налом (${fmtMoney(closing)} ₽)`,
          });
        }
      }

      await client.query(
        `UPDATE cash_shifts
            SET status = 'closed',
                closed_by = $1,
                closed_at = $2,
                closing_amount = $3,
                expected_amount = $4,
                difference = $5,
                to_safe_amount = $6,
                carryover_amount = $7,
                note = COALESCE($8, note)
          WHERE id = $9 AND tenant_id = $10`,
        [user.userID, closedAt, closing, expected, difference, toSafe, carryover, dto.note ?? null, id, user.tenantID],
      );

      if (toSafe > 0) {
        await client.query(
          `INSERT INTO safe_transactions (tenant_id, type, amount, shift_id, actor_id)
           VALUES ($1, 'deposit', $2, $3, $4)`,
          [user.tenantID, toSafe, id, user.userID],
        );
      }

      if (settlements.length > 0) {
        // expected — расчётный НАЛ этого сотрудника по окну смены (perAcceptor);
        // сотрудник вне разбивки сдаёт «сверх расчёта» → expected 0.
        const expectedByUser = new Map(figures.perAcceptor.map((a) => [a.userId, a.cashSales]));
        for (const s of settlements) {
          await client.query(
            `INSERT INTO cash_shift_settlements (tenant_id, shift_id, user_id, expected_amount, actual_amount)
             VALUES ($1, $2, $3, $4, $5)`,
            [user.tenantID, id, s.userId, round2(expectedByUser.get(s.userId) ?? 0), round2(num(s.actualAmount))],
          );
        }
      }

      await client.query('COMMIT');
      closedFigures = { cashSales: figures.cashSales, cardSales: figures.cardSales, toSafe, carryover, difference };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ConflictException) {
        throw err;
      }
      this.logger.error(`Cash shift close error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }

    // Fire-and-forget ПОСЛЕ коммита: пуш не задерживает ответ и не роняет закрытие.
    if (closedFigures) {
      void this.fireShiftClosedPush(user, closedFigures);
    }

    const row = await this.fetchShiftRow(this.pool, user.tenantID, id);
    if (!row) throw new NotFoundException({ message: 'Смена не найдена' });
    return this.assembleReport(this.pool, user.tenantID, row);
  }

  // ─── Current open shift (or null) with live Z-report ───────────────────
  /** Открытая смена МОЕГО филиала (или null). Без филиалов — любая открытая. */
  async current(tenantID: string, actor?: JwtPayload) {
    const params: unknown[] = [tenantID];
    const pointFilter = pointFilterSql('cs', actorPointId(actor), params);
    const { rows } = await this.pool.query(
      `SELECT cs.*, ob.full_name AS opened_by_name, cb.full_name AS closed_by_name
         FROM cash_shifts cs
         LEFT JOIN users ob ON ob.id = cs.opened_by AND ob.tenant_id = cs.tenant_id
         LEFT JOIN users cb ON cb.id = cs.closed_by AND cb.tenant_id = cs.tenant_id
        WHERE cs.tenant_id = $1 AND cs.status = 'open'${pointFilter}
        ORDER BY cs.opened_at DESC
        LIMIT 1`,
      params,
    );
    if (rows.length === 0) return null;
    return this.assembleReport(this.pool, tenantID, rows[0]);
  }

  // ─── Z-report for a specific shift ─────────────────────────────────────
  /**
   * Z-отчёт конкретной смены. 161 — читать можно только смены СВОЕГО филиала
   * (у тенанта без филиалов — любые): id смены чужого филиала не должен отдавать
   * его выручку по прямому обращению к API в обход списка.
   */
  async report(tenantID: string, id: string, actor?: JwtPayload) {
    const row = await this.fetchShiftRow(this.pool, tenantID, id, actorPointId(actor));
    if (!row) throw new NotFoundException({ message: 'Смена не найдена' });
    return this.assembleReport(this.pool, tenantID, row);
  }

  // ─── Paginated list, newest first ──────────────────────────────────────
  /** История смен МОЕГО филиала. 161 — total и страница режутся одинаково. */
  async list(tenantID: string, query: any, actor?: JwtPayload) {
    const page = Math.max(parseInt(query?.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query?.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const pointId = actorPointId(actor);

    const countParams: unknown[] = [tenantID];
    const countPoint = pointFilterSql('cs', pointId, countParams);
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*) AS total FROM cash_shifts cs WHERE cs.tenant_id = $1${countPoint}`,
      countParams,
    );
    const total = parseInt(countRows[0].total, 10) || 0;

    const listParams: unknown[] = [tenantID];
    const listPoint = pointFilterSql('cs', pointId, listParams);
    const limitIdx = listParams.length + 1;
    listParams.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT cs.*, ob.full_name AS opened_by_name, cb.full_name AS closed_by_name
         FROM cash_shifts cs
         LEFT JOIN users ob ON ob.id = cs.opened_by AND ob.tenant_id = cs.tenant_id
         LEFT JOIN users cb ON cb.id = cs.closed_by AND cb.tenant_id = cs.tenant_id
        WHERE cs.tenant_id = $1${listPoint}
        ORDER BY cs.opened_at DESC
        LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
      listParams,
    );

    return { data: rows.map((r) => this.mapShift(r)), total, page, limit };
  }

  // ─── Инкассация ────────────────────────────────────────────────────────
  async collect(user: JwtPayload, id: string, dto: CollectCashDto) {
    let shiftPointId: string | null = null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Фильтр филиала — как в close(): инкассировать чужой ящик нельзя.
      const lockParams: unknown[] = [id, user.tenantID];
      const lockPoint = pointFilterSql(null, actorPointId(user), lockParams);
      const { rows } = await client.query(
        `SELECT status, point_id FROM cash_shifts WHERE id = $1 AND tenant_id = $2${lockPoint} FOR UPDATE`,
        lockParams,
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Смена не найдена' });
      }
      if (rows[0].status !== 'open') {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Инкассация возможна только при открытой смене' });
      }
      // Филиал события = филиал СМЕНЫ (см. fireCollectionPush): читаем его тем
      // же локирующим SELECT, чтобы не ходить в базу второй раз после коммита.
      shiftPointId = (rows[0].point_id as string | null) ?? null;

      const amount = round2(num(dto.amount));
      if (!(amount > 0)) {
        await client.query('ROLLBACK');
        throw new BadRequestException({ message: 'Сумма инкассации должна быть положительной' });
      }

      await client.query(
        `INSERT INTO cash_collections (tenant_id, shift_id, amount, collected_by, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.tenantID, id, amount, user.userID, dto.note ?? null],
      );

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(`Cash collection error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }

    // Echo the refreshed Z-report so the UI sees the new collections total +
    // recomputed expected balance immediately.
    const report = await this.report(user.tenantID, id, user);
    // 'cash_collection' кассирам: сколько забрали из ящика и что осталось.
    void this.fireCollectionPush(user, round2(num(dto.amount)), 'кассы', report.expectedAmount, shiftPointId);
    return report;
  }

  // ─── Сейф (155) ────────────────────────────────────────────────────────
  async safe(tenantID: string) {
    const balance = await this.safeBalance(tenantID);
    const { rows } = await this.pool.query(
      `SELECT st.*, u.full_name AS actor_name
         FROM safe_transactions st
         LEFT JOIN users u ON u.id = st.actor_id AND u.tenant_id = st.tenant_id
        WHERE st.tenant_id = $1
        ORDER BY st.created_at DESC
        LIMIT 100`,
      [tenantID],
    );
    return { balance, transactions: rows.map((r) => this.mapSafeTransaction(r)) };
  }

  /** Инкассация владельцем ИЗ СЕЙФА — не требует открытой смены. */
  async safeCollect(user: JwtPayload, dto: CollectCashDto) {
    const amount = round2(num(dto.amount));
    if (!(amount > 0)) {
      throw new BadRequestException({ message: 'Сумма инкассации должна быть положительной' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Баланс сейфа — агрегат по insert-only таблице, FOR UPDATE его не
      // защищает; advisory-xact-lock сериализует конкурентные инкассации.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('safe:' || $1::text))`, [user.tenantID]);

      const balance = await this.safeBalance(user.tenantID, client);
      if (amount > balance) {
        await client.query('ROLLBACK');
        throw new BadRequestException({
          message: `В сейфе только ${fmtMoney(balance)} ₽ — нельзя инкассировать ${fmtMoney(amount)} ₽`,
        });
      }

      await client.query(
        `INSERT INTO safe_transactions (tenant_id, type, amount, actor_id, note)
         VALUES ($1, 'collection', $2, $3, $4)`,
        [user.tenantID, amount, user.userID, dto.note ?? null],
      );

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Safe collection error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }

    const state = await this.safe(user.tenantID);
    void this.fireCollectionPush(user, amount, 'сейфа', state.balance);
    return state;
  }

  // ─── Пуши (155) — best-effort, всегда после коммита ────────────────────

  /** 'cash_shift_closed' — всем активным директорам тенанта, кроме актора. */
  private async fireShiftClosedPush(
    actor: JwtPayload,
    f: { cashSales: number; cardSales: number; toSafe: number; carryover: number; difference: number },
  ): Promise<void> {
    try {
      const { rows } = await this.pool.query(
        `SELECT id FROM users
          WHERE tenant_id = $1 AND role = 'director'
            AND is_active = true AND dismissed_at IS NULL AND purged_at IS NULL
            AND id <> $2`,
        [actor.tenantID, actor.userID],
      );
      const diffPart =
        f.difference === 0
          ? 'Без расхождений'
          : `Расхождение: ${f.difference > 0 ? '+' : ''}${fmtMoney(f.difference)} ₽`;
      const body =
        `Нал: ${fmtMoney(f.cashSales)} ₽, карта: ${fmtMoney(f.cardSales)} ₽. ` +
        `В сейф: ${fmtMoney(f.toSafe)} ₽, размен: ${fmtMoney(f.carryover)} ₽. ${diffPart}`;
      await Promise.all(
        rows.map((r: { id: string }) =>
          this.push.sendToUserInTenant(r.id, actor.tenantID, 'cash_shift_closed', 'Касса закрыта', body, {
            type: 'cash_shift_closed',
          }),
        ),
      );
    } catch (err) {
      this.logger.error(`cash_shift_closed push failed: ${err}`);
    }
  }

  /**
   * 'cash_collection' — эффективным кассирам, кроме актора.
   *
   * ВОЛНА 4 — ПОЛУЧАТЕЛИ РЕЖУТСЯ ФИЛИАЛОМ СОБЫТИЯ. Пуш несёт сумму изъятия и
   * ОСТАТОК ДЕНЕЖНОГО ЯЩИКА: в сети из пяти автосервисов кассир точки А читал
   * чужие остатки как свои и сверял ящик по чужой цифре. Филиал берём У СМЕНЫ,
   * а не у актора: инкассировать может владелец, сидящий в другом филиале или
   * у тенанта без филиалов — адресаты определяются местом, откуда ушли деньги.
   *
   * Инкассация ИЗ СЕЙФА приходит с pointId = null сознательно: сейф один на
   * компанию (обоснование — в шапке файла и в миграции 161), его остаток
   * общий, и получатели остаются тенантными, как было.
   */
  private async fireCollectionPush(
    actor: JwtPayload,
    amount: number,
    source: 'кассы' | 'сейфа',
    rest: number,
    pointId: string | null = null,
  ): Promise<void> {
    try {
      const cashierIds = await this.getCashierUserIds(actor.tenantID, pointId);
      const body = `Инкассация ${fmtMoney(amount)} ₽ из ${source}. Остаток: ${fmtMoney(rest)} ₽`;
      await Promise.all(
        cashierIds
          .filter((uid) => uid !== actor.userID)
          .map((uid) =>
            this.push.sendToUserInTenant(uid, actor.tenantID, 'cash_collection', 'Инкассация', body, {
              type: 'cash_collection',
            }),
          ),
      );
    } catch (err) {
      this.logger.error(`cash_collection push failed: ${err}`);
    }
  }

  /**
   * Эффективные кассиры тенанта — SQL-зеркало checks.getCashierUserIds +
   * allowlist tenants.payment_acceptors (155): непустой список = принимают
   * ТОЛЬКО перечисленные (+ owner-class всегда); NULL/пустой = по матрице
   * роли (accept_payment). Дублируется локально, чтобы не тянуть ChecksService.
   *
   * `pointId` (волна 4) режет получателей филиалом ТЕМ ЖЕ предикатом
   * назначений, что график и пуш «пришёл/ушёл» (assignedToPointSql): без
   * назначений сотрудник считается работающим везде — безопасный дефолт 156.
   * null = филиала у события нет (сейф один на компанию) → тенант целиком.
   */
  private async getCashierUserIds(tenantID: string, pointId: string | null = null): Promise<string[]> {
    const { rows: tRows } = await this.pool.query(`SELECT payment_acceptors FROM tenants WHERE id = $1`, [tenantID]);
    const raw = tRows[0]?.payment_acceptors;
    const acceptors = Array.isArray(raw) ? raw.filter((v: unknown): v is string => typeof v === 'string') : [];

    if (acceptors.length > 0) {
      const params: unknown[] = [tenantID, acceptors];
      const pointFilter = assignedToPointSql('u', '$1', pointId, params);
      const { rows } = await this.pool.query(
        `SELECT u.id FROM users u
          WHERE u.tenant_id = $1
            AND u.is_active = true AND u.dismissed_at IS NULL AND u.purged_at IS NULL
            AND (u.id::text = ANY($2::text[]) OR u.role IN ('director', 'superadmin'))${pointFilter}`,
        params,
      );
      return rows.map((r: { id: string }) => String(r.id));
    }

    const params: unknown[] = [tenantID];
    const pointFilter = assignedToPointSql('u', '$1', pointId, params);
    const { rows } = await this.pool.query(
      `SELECT u.id
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1
          AND u.is_active = true
          AND u.dismissed_at IS NULL
          AND u.purged_at IS NULL
          AND (
            u.role IN ('director', 'superadmin')
            OR (r.matrix IS NOT NULL AND (r.matrix->'checks'->>'acceptPayment')::boolean IS TRUE)
            OR (r.matrix IS NULL AND u.role = 'admin')
          )${pointFilter}`,
      params,
    );
    return rows.map((r: { id: string }) => String(r.id));
  }
}
