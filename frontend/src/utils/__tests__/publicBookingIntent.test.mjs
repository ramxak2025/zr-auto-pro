import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPublicBookingIntent,
  dispatchPublicBookingIntent,
  parsePublicBookingIntent,
  recoverPublicBookingIntent,
} from '../publicBookingIntent.js';

const requestId = '50d7f0e8-fefa-4c38-8933-5e9648f3889f';
const serviceId = '4e20cd2a-304c-4aec-8aac-c22b00d35493';
const token = 'A'.repeat(43);
const slug = 'autexa-service';
const key = `autexa.public-booking.recovery.v1:${slug}`;
const body = (name = 'Alex') => ({
  requestId,
  recoveryToken: token,
  serviceIds: [serviceId],
  startsAt: '2026-10-09T10:00:00.000Z',
  name,
  phone: '+79990000000',
  consentVersion: 'v1',
  consentAccepted: true,
});

function fakeEnvironment({ failWrite = false } = {}) {
  const values = new Map();
  const storage = {
    async getItem(name) {
      return values.get(name) ?? null;
    },
    async setItem(name, value) {
      if (failWrite) throw new Error('quota');
      values.set(name, value);
    },
    async removeItem(name) {
      values.delete(name);
    },
  };
  const tails = new Map();
  const locks = {
    request(name, _options, callback) {
      const prior = tails.get(name) ?? Promise.resolve();
      let release;
      const next = new Promise((resolve) => {
        release = resolve;
      });
      tails.set(
        name,
        prior.then(() => next),
      );
      return prior.then(async () => {
        try {
          return await callback({ name });
        } finally {
          release();
        }
      });
    },
  };
  return { storage, locks, values };
}

function parseReceipt(response, expectedId) {
  if (
    ![200, 201].includes(response.status) ||
    response.data?.requestId !== expectedId ||
    response.data?.status !== 'pending'
  )
    return null;
  return { requestId: expectedId, status: 'pending' };
}

const dispatch = (env, options = {}) =>
  dispatchPublicBookingIntent({
    slug,
    key,
    storage: env.storage,
    locks: env.locks,
    body: options.body ?? body(),
    ...(options.saved ? { saved: options.saved } : {}),
    parseReceipt,
    ...(options.send
      ? { send: options.send }
      : { send: async () => ({ status: 201, data: { requestId, status: 'pending' } }) }),
    ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
    ...(options.onPersisted ? { onPersisted: options.onPersisted } : {}),
  });

test('slug A→B→A cannot revive a stale dispatch lease', async () => {
  const env = fakeEnvironment();
  let generation = 1;
  const captured = generation;
  let entered;
  const enteredLock = new Promise((resolve) => {
    entered = resolve;
  });
  let unlock;
  const lockGate = new Promise((resolve) => {
    unlock = resolve;
  });
  const locks = {
    request: async (_key, _opts, callback) => {
      entered();
      await lockGate;
      return callback({});
    },
  };
  let sends = 0;
  const promise = dispatchPublicBookingIntent({
    slug,
    key,
    storage: env.storage,
    locks,
    body: body(),
    parseReceipt,
    isCurrent: () => generation === captured,
    send: async () => {
      sends += 1;
      return { status: 201, data: { requestId, status: 'pending' } };
    },
  });
  await enteredLock;
  generation += 1; // A→B
  generation += 1; // B→A is still a different captured lease
  unlock();
  await assert.rejects(promise, { code: 'LEASE_CHANGED' });
  assert.equal(sends, 0);
});

test('only a first proven correctable rejection clears; rejection after ambiguity keeps immutable intent', async () => {
  const first = fakeEnvironment();
  await assert.rejects(
    dispatch(first, {
      send: async () => {
        throw { response: { status: 409, data: { code: 'SLOT_UNAVAILABLE' } } };
      },
    }),
    { definitiveRejected: true },
  );
  assert.equal(first.values.has(key), false);

  const ambiguous = fakeEnvironment();
  await assert.rejects(
    dispatch(ambiguous, {
      send: async () => {
        throw new Error('network timeout');
      },
    }),
  );
  const saved = parsePublicBookingIntent(ambiguous.values.get(key), slug);
  await assert.rejects(
    dispatch(ambiguous, {
      saved,
      send: async () => {
        throw { response: { status: 409, data: { code: 'SLOT_UNAVAILABLE' } } };
      },
    }),
  );
  assert.equal(parsePublicBookingIntent(ambiguous.values.get(key), slug).requestId, requestId);
});

test('unpublished landing does not block capability recovery; completed receipt is minimized', async () => {
  const env = fakeEnvironment();
  await assert.rejects(
    dispatch(env, {
      send: async () => {
        throw new Error('timeout');
      },
    }),
  );
  const saved = parsePublicBookingIntent(env.values.get(key), slug);
  let recovered = false;
  const result = await recoverPublicBookingIntent({
    slug,
    key,
    storage: env.storage,
    locks: env.locks,
    requestId,
    recoveryToken: token,
    recover: async () => {
      recovered = true;
      return { status: 200, data: { status: 'completed', result: {} } };
    },
    parseRecovery: () => ({ status: 'completed', result: { requestId, status: 'pending' } }),
  });
  assert.equal(recovered, true);
  assert.equal(result.status, 'completed');
  assert.equal(parsePublicBookingIntent(env.values.get(key), slug).body, null);
  assert.equal(saved.requestId, requestId);
});

test('storage failure and overlapping tabs fail closed without duplicate POST', async () => {
  const failed = fakeEnvironment({ failWrite: true });
  let failedSends = 0;
  await assert.rejects(
    dispatch(failed, {
      send: async () => {
        failedSends += 1;
      },
    }),
    { code: 'STORAGE_UNAVAILABLE' },
  );
  assert.equal(failedSends, 0);

  const env = fakeEnvironment();
  let releaseSend;
  const sendGate = new Promise((resolve) => {
    releaseSend = resolve;
  });
  let sends = 0;
  const first = dispatch(env, {
    send: async () => {
      sends += 1;
      await sendGate;
      return { status: 201, data: { requestId, status: 'pending' } };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = dispatch(env, { body: body('Other') });
  releaseSend();
  await first;
  await assert.rejects(second, { code: 'PENDING_EXISTS' });
  assert.equal(sends, 1);
});

test('202 and a mismatched response UUID remain ambiguous and explicit new intent clears only its acknowledged record', async () => {
  for (const response of [
    { status: 202, data: { requestId, status: 'pending' } },
    { status: 201, data: { requestId: '0dc96341-8955-40b8-86e2-c51694000517', status: 'pending' } },
  ]) {
    const env = fakeEnvironment();
    const outcome = await dispatch(env, { send: async () => response });
    assert.equal(outcome.kind, 'ambiguous');
    assert.equal(parsePublicBookingIntent(env.values.get(key), slug).body !== null, true);
  }
  const env = fakeEnvironment();
  const result = await dispatch(env);
  assert.equal(result.kind, 'confirmed');
  await clearPublicBookingIntent({ slug, key, storage: env.storage, locks: env.locks, requestId });
  assert.equal(env.values.has(key), false);
});
