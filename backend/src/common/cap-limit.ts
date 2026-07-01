/**
 * Sanitise a caller-supplied page-size (`?limit=`) query param (audit round 7,
 * item 8).
 *
 * Historically every getAll did `parseInt(query.limit) || <default>` — which
 * happily accepts `?limit=100000000` and lets one request drag an entire table
 * (plus its JOINs) through the connection pool. This helper keeps the exact
 * same defaulting behaviour (absent / zero / negative / garbage → `def`) and
 * adds ONE change: a hard ceiling.
 *
 * Ceilings are deliberately generous per endpoint — e.g. products/services use
 * 10 000 because the mobile warehouse picker legitimately fetches the full
 * catalogue today. Tightening below real usage would break live clients.
 */
export function capLimit(raw: unknown, def: number, max: number): number {
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}
