/**
 * Russian-language helpers for rendering "N days remaining" on warranty
 * chips inside the cash screen.
 *
 * Why the local module:
 *   The active-warranty section under the selected-client card on the
 *   cash screen needs to format `daysLeft` in a way that reads natural
 *   to a Russian-speaking master:
 *
 *     • daysLeft <= 0      → "истекла"      (gracefully degraded — should
 *                                            be filtered by backend, but
 *                                            we don't crash if it slips)
 *     • 1 .. 30 days       → "ещё 12 дней"
 *     • >30 days, no rest  → "ещё 2 месяца"
 *     • >30 days, w/ rest  → "ещё 2 месяца 5 дней"
 *
 *   Russian declension is gender-aware and number-aware:
 *     1   → день / месяц
 *     2-4 → дня / месяца   (except 12..14 → дней / месяцев)
 *     5-9 → дней / месяцев
 *     0   → дней / месяцев
 *
 * Pure functions, side-effect free, deterministic — easy to unit-test
 * and reuse from other screens if active warranties are ever surfaced
 * elsewhere (e.g. client detail, dashboard alerts).
 */

/** Pluralise "день" by the Russian rules. n must be a non-negative integer. */
export function declensionDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

/** Pluralise "месяц" by the Russian rules. n must be a non-negative integer. */
export function declensionMonths(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'месяц';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'месяца';
  return 'месяцев';
}

/**
 * Human-readable "time left" label for a warranty.
 * Approximates a month as 30 days — close enough for the cash screen
 * chip (the backend already computes the exact `daysLeft`, this is
 * just a presentational rollup).
 */
export function formatDaysLeft(days: number): string {
  if (days <= 0) return 'истекла';
  if (days < 31) return `ещё ${days} ${declensionDays(days)}`;
  const months = Math.floor(days / 30);
  const rest = days % 30;
  if (rest === 0) return `ещё ${months} ${declensionMonths(months)}`;
  return `ещё ${months} ${declensionMonths(months)} ${rest} ${declensionDays(rest)}`;
}
