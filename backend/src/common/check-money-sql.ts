/**
 * Денежные выражения по строке `checks` — ОДИН источник формулы для дашборда
 * (checks.getDashboard), дашборда v2 (reports.computeDashboardV2) и сводки по
 * филиалам (points.summaryForTenant).
 *
 * ЗАЧЕМ ОБЩИЙ МОДУЛЬ, А НЕ КОПИПАСТА: правило «гарантия — не выручка, а
 * убыток» (ITEM 2 / money-audit C2) уже трижды переписывалось, и каждый раз
 * копию где-то забывали — прибыль на одном экране расходилась с другим. Пока
 * формула живёт в одном месте, расхождение невозможно by construction.
 *
 * СЕМАНТИКА (решение владельца, менять только вместе со всеми потребителями):
 *   • ВЫРУЧКА — гарантийный чек (payment_method='warranty') даёт 0: работа по
 *     гарантии денег в кассу не приносит.
 *   • ПРИБЫЛЬ — у гарантийного чека вместо сохранённого (положительного)
 *     checks.profit берётся РЕАЛЬНЫЙ убыток −(закупка запчастей + выплата
 *     мастеру за работу + его товарная комиссия). product_salary_total
 *     начисляется и по гарантии, поэтому без него убыток занижен, а прибыль
 *     завышена.
 *   • БАЗА СТРОК — только проведённые живые чеки: is_deferred=false AND
 *     deleted_at IS NULL. Драфт денег ещё не родил, корзина их уже забрала.
 */

/** Префикс алиаса таблицы: '' или 'ch.'. */
function prefix(alias?: string): string {
  return alias ? `${alias}.` : '';
}

/**
 * Выручка строки чека: 0 у гарантийного, иначе total_revenue.
 * Оборачивать в SUM(...) — COALESCE(...,0) остаётся на стороне вызывающего.
 */
export function checkRevenueExpr(alias?: string): string {
  const p = prefix(alias);
  return `CASE WHEN ${p}payment_method IS DISTINCT FROM 'warranty' THEN ${p}total_revenue ELSE 0 END`;
}

/**
 * Прибыль строки чека: сохранённый profit, а у гарантийного — отрицательный
 * реальный убыток (запчасти + зарплата мастера + его товарная комиссия).
 */
export function checkProfitExpr(alias?: string): string {
  const p = prefix(alias);
  return (
    `CASE WHEN ${p}payment_method = 'warranty' ` +
    `THEN -(${p}product_cost_total + ${p}service_salary_total + COALESCE(${p}product_salary_total, 0)) ` +
    `ELSE ${p}profit END`
  );
}

/** Предикат «строка чека реально несёт деньги»: не драфт и не в корзине. */
export function checkMoneyBaseWhere(alias?: string): string {
  const p = prefix(alias);
  return `${p}is_deferred = false AND ${p}deleted_at IS NULL`;
}
