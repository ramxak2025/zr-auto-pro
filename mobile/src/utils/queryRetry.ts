/**
 * queryRetry — transient-failure retry policy for TanStack Query (queries only).
 *
 * ROOT-CAUSE FIX (2026-06-18): the previous policy retried a transient
 * failure only TWICE (≈1.5s of backoff: 500ms + 1000ms) before surfacing a
 * hard «Не удалось загрузить» error card. A backend redeploy recreates the
 * single backend container and produces a 5–15s+ window where every /api
 * request returns 502. 1.5s ≪ 15s, so screens errored out mid-deploy, and a
 * manual «Повторить» fired inside the same window re-ran the identical 1.5s
 * policy → 502 again → the literal "повторить не помогает", in EVERY section
 * at once (the whole backend is briefly down).
 *
 * Fix: for TRANSIENT failures only — network errors (no `response`),
 * timeouts, and any 5xx (502/503/504) — retry up to MAX_TRANSIENT_RETRIES
 * with capped exponential backoff + jitter, so coverage (~31s) comfortably
 * outlasts a realistic deploy window. 4xx are DETERMINISTIC (403 master on an
 * owner endpoint, 404 deleted entity, 400 validation) and are NEVER retried —
 * retrying only doubles the spinner for an answer that cannot change.
 *
 * Pure module: NO react-native / react-query runtime imports, so it is
 * unit-testable under the default node jest environment.
 *
 * NOTE: this governs QUERIES only. Mutations keep their own policy
 * (networkMode 'always', fail-fast) — a retried mutation risks duplicate
 * writes to касса/склад/зарплата and must never be widened here.
 */

/**
 * Max transient retries IN ADDITION to the initial attempt. 6 retries with
 * the capped backoff below ≈ 1+2+4+8+8+8 = 31s of coverage.
 */
export const MAX_TRANSIENT_RETRIES = 6;

/** Backoff ceiling — a single retry never waits longer than this. */
export const RETRY_DELAY_CAP_MS = 8_000;

/**
 * A 4xx response — deterministic, never retried. Network errors and 5xx are
 * NOT deterministic (the server may recover), so they fall through to the
 * retry path.
 */
export function isDeterministicClientError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * React Query `retry` predicate. Retries transient failures up to
 * MAX_TRANSIENT_RETRIES; never retries a 4xx.
 *
 * `failureCount` is the number of failures SO FAR (TanStack passes the
 * pre-increment count and decides BEFORE sleeping), so `failureCount < MAX`
 * yields exactly MAX retries after the initial attempt.
 */
export function shouldRetryTransient(failureCount: number, error: unknown): boolean {
  if (isDeterministicClientError(error)) return false;
  return failureCount < MAX_TRANSIENT_RETRIES;
}

/**
 * Capped exponential backoff with ±25% jitter. Base doubles 1s→2s→4s→8s and
 * caps at RETRY_DELAY_CAP_MS; the jitter de-synchronises the ~10–15 queries
 * that fan out at deploy time so they don't all hammer the recovering backend
 * in lockstep (thundering herd).
 *
 * @param attempt 0-based retry index (TanStack passes the pre-increment count)
 * @param rand    injectable RNG for deterministic tests (defaults Math.random)
 */
export function transientRetryDelay(attempt: number, rand: () => number = Math.random): number {
  const safeAttempt = attempt < 0 ? 0 : attempt;
  const base = Math.min(1000 * 2 ** safeAttempt, RETRY_DELAY_CAP_MS);
  const jitter = 0.75 + rand() * 0.5; // 0.75–1.25
  return Math.round(base * jitter);
}
