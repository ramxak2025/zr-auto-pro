import { isAmbiguousRequestFailure, resolveStableRequestAttempt } from '../../../../shared/utils/stableRequestAttempt';

describe('resolveStableRequestAttempt', () => {
  it('reuses the request id for an exact retry and blocks a changed payload', () => {
    const createId = jest.fn(() => 'attempt-1');
    const first = resolveStableRequestAttempt({ items: [{ id: 'line-1', qty: 1 }] }, null, createId);
    expect(first.kind).toBe('ready');
    if (first.kind !== 'ready') throw new Error('expected first attempt to be ready');

    const retry = resolveStableRequestAttempt({ items: [{ id: 'line-1', qty: 1 }] }, first.attempt, createId);
    expect(retry).toEqual(first);
    expect(createId).toHaveBeenCalledTimes(1);

    expect(resolveStableRequestAttempt({ items: [{ id: 'line-1', qty: 2 }] }, first.attempt, createId)).toEqual({
      kind: 'payload-changed',
    });
    expect(createId).toHaveBeenCalledTimes(1);
  });

  it('starts a new key only after the caller clears a completed intent', () => {
    const first = resolveStableRequestAttempt({ date: '2026-10-08' }, null, () => 'attempt-1');
    const deliberateNewIntent = resolveStableRequestAttempt({ date: '2026-10-08' }, null, () => 'attempt-2');
    expect(first.kind === 'ready' && first.attempt.requestId).toBe('attempt-1');
    expect(deliberateNewIntent.kind === 'ready' && deliberateNewIntent.attempt.requestId).toBe('attempt-2');
  });

  it('distinguishes confirmed 4xx rejections from ambiguous transport failures', () => {
    expect(isAmbiguousRequestFailure({ response: { status: 400 } })).toBe(false);
    expect(isAmbiguousRequestFailure({ response: { status: 422 } })).toBe(false);
    expect(isAmbiguousRequestFailure({ response: { status: 409 } })).toBe(true);
    expect(isAmbiguousRequestFailure({ response: { status: 503 } })).toBe(true);
    expect(isAmbiguousRequestFailure({})).toBe(true);
  });
});
