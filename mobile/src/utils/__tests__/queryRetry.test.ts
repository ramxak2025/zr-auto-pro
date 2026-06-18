import {
  MAX_TRANSIENT_RETRIES,
  RETRY_DELAY_CAP_MS,
  isDeterministicClientError,
  shouldRetryTransient,
  transientRetryDelay,
} from '../queryRetry';

// Axios-shaped errors. The interceptor in src/api/axios.ts wraps a
// no-response (network/timeout) failure into a plain Error WITHOUT a
// `response` field, and leaves a real HTTP error with `response.status`.
const httpError = (status: number) => ({ response: { status } });
const networkError = () => new Error('Нет соединения с сервером');
const timeoutError = () => Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });

describe('isDeterministicClientError', () => {
  it('treats 4xx as deterministic', () => {
    expect(isDeterministicClientError(httpError(400))).toBe(true);
    expect(isDeterministicClientError(httpError(401))).toBe(true);
    expect(isDeterministicClientError(httpError(403))).toBe(true);
    expect(isDeterministicClientError(httpError(404))).toBe(true);
    expect(isDeterministicClientError(httpError(429))).toBe(true);
    expect(isDeterministicClientError(httpError(499))).toBe(true);
  });

  it('treats 5xx / network / timeout as NON-deterministic (transient)', () => {
    expect(isDeterministicClientError(httpError(500))).toBe(false);
    expect(isDeterministicClientError(httpError(502))).toBe(false);
    expect(isDeterministicClientError(httpError(503))).toBe(false);
    expect(isDeterministicClientError(httpError(504))).toBe(false);
    expect(isDeterministicClientError(networkError())).toBe(false);
    expect(isDeterministicClientError(timeoutError())).toBe(false);
  });

  it('is safe against null/undefined errors', () => {
    expect(isDeterministicClientError(null)).toBe(false);
    expect(isDeterministicClientError(undefined)).toBe(false);
    expect(isDeterministicClientError({})).toBe(false);
  });
});

describe('shouldRetryTransient', () => {
  it('NEVER retries a 4xx, regardless of failureCount', () => {
    expect(shouldRetryTransient(0, httpError(403))).toBe(false);
    expect(shouldRetryTransient(0, httpError(404))).toBe(false);
    expect(shouldRetryTransient(5, httpError(400))).toBe(false);
  });

  it('retries a 502 deploy-window failure up to MAX_TRANSIENT_RETRIES', () => {
    for (let i = 0; i < MAX_TRANSIENT_RETRIES; i++) {
      expect(shouldRetryTransient(i, httpError(502))).toBe(true);
    }
    // Once we have failed MAX times, stop.
    expect(shouldRetryTransient(MAX_TRANSIENT_RETRIES, httpError(502))).toBe(false);
    expect(shouldRetryTransient(MAX_TRANSIENT_RETRIES + 1, httpError(502))).toBe(false);
  });

  it('retries network errors (no response) and timeouts', () => {
    expect(shouldRetryTransient(0, networkError())).toBe(true);
    expect(shouldRetryTransient(0, timeoutError())).toBe(true);
    expect(shouldRetryTransient(MAX_TRANSIENT_RETRIES - 1, networkError())).toBe(true);
  });

  it('covers a realistic 502 window: 6 retries outlast ~15s', () => {
    // Sum the slept delays (worst-case jitter is bounded by the cap anyway).
    let total = 0;
    for (let attempt = 0; attempt < MAX_TRANSIENT_RETRIES; attempt++) {
      // Use rand=()=>0.5 → jitter factor 1.0 → exact base delay.
      total += transientRetryDelay(attempt, () => 0.5);
    }
    // 1000+2000+4000+8000+8000+8000 = 31000ms ≫ a 15s deploy window.
    expect(total).toBe(31_000);
    expect(total).toBeGreaterThan(15_000);
  });
});

describe('transientRetryDelay', () => {
  it('doubles then caps at RETRY_DELAY_CAP_MS (jitter neutralised)', () => {
    const noJitter = () => 0.5; // factor 1.0
    expect(transientRetryDelay(0, noJitter)).toBe(1_000);
    expect(transientRetryDelay(1, noJitter)).toBe(2_000);
    expect(transientRetryDelay(2, noJitter)).toBe(4_000);
    expect(transientRetryDelay(3, noJitter)).toBe(RETRY_DELAY_CAP_MS);
    expect(transientRetryDelay(4, noJitter)).toBe(RETRY_DELAY_CAP_MS);
    expect(transientRetryDelay(10, noJitter)).toBe(RETRY_DELAY_CAP_MS);
  });

  it('applies ±25% jitter within bounds', () => {
    // rand=0 → factor 0.75 (lower bound); rand→1 → factor 1.25 (upper bound).
    expect(transientRetryDelay(0, () => 0)).toBe(750);
    expect(transientRetryDelay(0, () => 0.999999)).toBe(Math.round(1000 * (0.75 + 0.999999 * 0.5)));
    // For any rand in [0,1) the result stays within [0.75x, 1.25x] of base.
    for (const r of [0, 0.1, 0.33, 0.5, 0.77, 0.99]) {
      const d = transientRetryDelay(2, () => r);
      expect(d).toBeGreaterThanOrEqual(4000 * 0.75);
      expect(d).toBeLessThanOrEqual(4000 * 1.25);
    }
  });

  it('clamps negative attempts to 0', () => {
    expect(transientRetryDelay(-1, () => 0.5)).toBe(1_000);
  });
});
