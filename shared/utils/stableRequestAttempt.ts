export interface StableRequestAttempt {
  fingerprint: string;
  requestId: string;
}

/** Reuse an idempotency key only for the exact same submitted payload. */
export function resolveStableRequestAttempt<T>(
  payload: T,
  previous: StableRequestAttempt | null,
  createRequestId: () => string,
): { kind: 'ready'; attempt: StableRequestAttempt } | { kind: 'payload-changed' } {
  const fingerprint = JSON.stringify(payload);
  if (previous && previous.fingerprint !== fingerprint) return { kind: 'payload-changed' };
  return {
    kind: 'ready',
    attempt: previous ?? { fingerprint, requestId: createRequestId() },
  };
}

/** Server-side 4xx validation is a confirmed rejection; transport/5xx and 409
 * remain ambiguous and must keep the original payload/key for reconciliation. */
export function isAmbiguousRequestFailure(error: { response?: { status?: number } } | null | undefined): boolean {
  const status = error?.response?.status;
  return status == null || status === 409 || status >= 500 || status < 400;
}
