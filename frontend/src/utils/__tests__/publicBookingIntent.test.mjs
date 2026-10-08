import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPublicBookingIntent,
  dispatchAndReadCurrentPublicBooking,
  dispatchPublicBookingIntent,
  parsePublicBookingIntent,
  recoverPublicBookingIntent,
  validatePublicBookingDto,
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

test('actual DTO preflight blocks invalid name, phone, and comment before durable claim', async () => {
  const env = fakeEnvironment();
  let sends = 0;
  for (const invalid of [
    body('x'.repeat(101)),
    { ...body(), name: 'Alex\u0001' },
    { ...body(), phone: '123456789' },
    { ...body(), phone: '123456789012345678901234567890123' },
    { ...body(), comment: '<script>' },
    { ...body(), comment: 'x'.repeat(1001) },
  ]) {
    assert.ok(validatePublicBookingDto(invalid));
    await assert.rejects(
      dispatch(env, {
        body: invalid,
        send: async () => {
          sends += 1;
          return { status: 201, data: { requestId, status: 'pending' } };
        },
      }),
      { code: 'INVALID_REQUEST' },
    );
  }
  assert.equal(sends, 0);
  assert.equal(env.values.has(key), false);
});

test('first flattened DTO 400 and typed booking-disabled 404 clear; rejection after an ambiguous send does not', async () => {
  for (const rejection of [
    { response: { status: 400, data: { message: 'phone must match regular expression' } } },
    { response: { status: 404, data: { code: 'BOOKING_DISABLED', message: 'disabled' } } },
  ]) {
    const env = fakeEnvironment();
    await assert.rejects(dispatch(env, { send: async () => Promise.reject(rejection) }), { definitiveRejected: true });
    assert.equal(env.values.has(key), false);
  }

  const env = fakeEnvironment();
  await assert.rejects(dispatch(env, { send: async () => Promise.reject(new Error('timeout')) }));
  const saved = parsePublicBookingIntent(env.values.get(key), slug);
  await assert.rejects(
    dispatch(env, {
      saved,
      send: async () => Promise.reject({ response: { status: 400, data: { message: 'name is too long' } } }),
    }),
  );
  assert.equal(parsePublicBookingIntent(env.values.get(key), slug).requestId, requestId);
});

test('lost initial response then retry reads current capability status, not historical ledger receipt', async () => {
  const env = fakeEnvironment();
  await assert.rejects(dispatch(env, { send: async () => Promise.reject(new Error('lost response')) }));
  const saved = parsePublicBookingIntent(env.values.get(key), slug);
  const historicalAcknowledgement = { requestId, status: 'pending' };
  const currentReceipt = { requestId, status: 'confirmed', startsAt: '2026-10-09T11:00:00.000Z' };
  let posts = 0;
  let gets = 0;
  const result = await dispatchAndReadCurrentPublicBooking({
    dispatch: () =>
      dispatchPublicBookingIntent({
        slug,
        key,
        storage: env.storage,
        locks: env.locks,
        body: saved.body,
        saved,
        parseReceipt: (response, expectedId) =>
          response.status === 201 && response.data.requestId === expectedId ? response.data : null,
        send: async () => {
          posts += 1;
          return { status: 201, data: historicalAcknowledgement };
        },
      }),
    readCurrent: (record) =>
      recoverPublicBookingIntent({
        slug,
        key,
        storage: env.storage,
        locks: env.locks,
        requestId: record.requestId,
        recoveryToken: record.recoveryToken,
        recover: async (targetSlug, targetId, recoveryToken) => {
          gets += 1;
          assert.equal(targetSlug, slug);
          assert.equal(targetId, requestId);
          assert.equal(recoveryToken, token);
          return { status: 200, data: { status: 'completed', result: currentReceipt } };
        },
        parseRecovery: (_response, expectedId) =>
          expectedId === requestId ? { status: 'completed', result: currentReceipt } : null,
      }),
  });
  assert.equal(posts, 1);
  assert.equal(gets, 1);
  assert.equal(result.kind, 'current');
  assert.equal(result.result.status, 'confirmed');
  assert.equal(parsePublicBookingIntent(env.values.get(key), slug).body, null);
});

test('failed current-status GET remains recoverable and does not present historical receipt as current', async () => {
  const env = fakeEnvironment();
  let posts = 0;
  const result = await dispatchAndReadCurrentPublicBooking({
    dispatch: () =>
      dispatchPublicBookingIntent({
        slug,
        key,
        storage: env.storage,
        locks: env.locks,
        body: body(),
        parseReceipt,
        send: async () => {
          posts += 1;
          return { status: 201, data: { requestId, status: 'pending' } };
        },
      }),
    readCurrent: async () => {
      throw new Error('status GET unavailable');
    },
  });
  assert.equal(result.kind, 'unverified');
  assert.equal(posts, 1);
  assert.equal(parsePublicBookingIntent(env.values.get(key), slug).body, null);
  const recovered = await recoverPublicBookingIntent({
    slug,
    key,
    storage: env.storage,
    locks: env.locks,
    requestId,
    recoveryToken: token,
    recover: async () => ({ status: 200, data: { status: 'completed', result: {} } }),
    parseRecovery: () => ({ status: 'completed', result: { requestId, status: 'cancelled' } }),
  });
  assert.equal(recovered.status, 'completed');
  assert.equal(posts, 1);
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
