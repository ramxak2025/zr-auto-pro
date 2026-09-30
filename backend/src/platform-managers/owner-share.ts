/**
 * Доля владельца платформы от платной оплаты менеджера (миграция 173).
 *
 * Чистая функция без обращения к БД: одна и та же арифметика нужна и продлению
 * подписки (снимок в subscription_payments), и тестам. Деньги считаем в ЦЕЛЫХ
 * КОПЕЙКАХ, а не в float-рублях: 1234.56 * 60 / 100 в JS даёт 740.7359999999999,
 * и округлять «на глаз» нельзя, потому что сумма долга менеджера — учёт, а не
 * отображение.
 */

/** Доля владельца по умолчанию, %, если у менеджера она не задана. */
export const DEFAULT_OWNER_SHARE_PERCENT = 60;

/**
 * Сколько из `amount` рублей причитается владельцу при доле `percent` %.
 *
 * Возвращает null (доли нет), когда:
 *   • `isFree` — бесплатное продление денег не приносит;
 *   • `amount` не конечное число или ≤ 0 — нечего делить;
 *   • `percent` не задан, не конечен или вне 0..100 — менеджера нет / данные битые.
 *
 * Иначе — рубли с двумя знаками (округление копейки «половина вверх»):
 *   computeOwnerShare(1000, 60, false)    === 600
 *   computeOwnerShare(1234.56, 60, false) === 740.74
 */
export function computeOwnerShare(
  amount: number | null | undefined,
  percent: number | null | undefined,
  isFree: boolean,
): number | null {
  if (isFree) return null;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return null;

  // Сумма — в копейки, процент — в сотые доли процента (NUMERIC(5,2) хранит их ровно).
  const kopecks = Math.round(amount * 100);
  const basisPoints = Math.round(percent * 100);
  return Math.round((kopecks * basisPoints) / 10000) / 100;
}
