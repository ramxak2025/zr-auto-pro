import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge, validateConfig, jsonRequest } from './bridge.mjs';

const connectionId = 'connection-1';
const secrets = { autexaKey: 'test-autexa-key', oneCKey: 'test-adapter-key' };
const health = {
  protocol: 1,
  ready: true,
  durableIdempotency: true,
  connectionId,
  exportEntities: ['products'],
  importEntities: ['products'],
};
const item = { autexaId: 'product-1', externalId: null, revision: 'revision-1', payload: { name: 'Баллон' } };
async function fixture(t, request) {
  const stateDir = await mkdtemp(join(tmpdir(), 'autexa-one-c-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const config = {
    connectionId,
    autexaUrl: 'https://autexa.test/api',
    oneCUrl: 'http://127.0.0.1:8081/hs/autexa/v1',
    entities: ['products'],
    stateDir,
  };
  return { config, bridge: await createBridge(config, secrets, { request }) };
}

test('rejects credentials in URLs and plain HTTP outside loopback', () => {
  const cfg = {
    connectionId,
    autexaUrl: 'https://autexa.test/api',
    oneCUrl: 'http://127.0.0.1',
    entities: ['products'],
  };
  assert.equal(validateConfig(cfg).intervalSeconds, 60);
  assert.throws(() => validateConfig({ ...cfg, autexaUrl: 'https://secret@example.com' }));
  assert.throws(() => validateConfig({ ...cfg, oneCUrl: 'http://192.168.1.2' }));
  assert.throws(() => validateConfig({ ...cfg, entities: ['users'] }));
});

test('imports, exports, acknowledges and skips unchanged rows across restart', async (t) => {
  const calls = [];
  let incomingAcked = false;
  const request = async (url, key, options = {}) => {
    calls.push({ url, key, ...options });
    if (url.endsWith('/health')) return health;
    if (url.includes('/changes?'))
      return {
        items: incomingAcked
          ? []
          : [{ eventId: 'e1', entityType: 'products', externalId: '1c-1', payload: { name: 'Баллон' } }],
        nextCursor: incomingAcked ? null : 'cursor-1',
        hasMore: false,
      };
    if (url.endsWith('/bridge/import')) return { id: 'receipt-1', status: 'applied', autexaId: 'product-2' };
    if (url.endsWith('/changes/ack')) {
      incomingAcked = true;
      return { accepted: true };
    }
    if (url.includes('/bridge/export?')) return { items: [item], nextCursor: null };
    if (url.endsWith('/apply')) return { status: 'applied', externalId: '1c-2', externalRevision: 'v1' };
    if (url.endsWith('/bridge/ack')) return { accepted: 1, needsReview: 0 };
    throw new Error('Unexpected route');
  };
  const { config, bridge } = await fixture(t, request);
  assert.deepEqual(await bridge.cycle(), { imported: 1, exported: 1, needsReview: 0 });
  const next = await createBridge(config, secrets, { request });
  assert.deepEqual(await next.cycle(), { imported: 0, exported: 0, needsReview: 0 });
  assert.equal(calls.filter((c) => c.url.endsWith('/apply')).length, 1);
  assert(calls.filter((c) => c.url.startsWith('https://autexa')).every((c) => c.key === secrets.autexaKey));
  assert(calls.filter((c) => c.url.startsWith('http://127')).every((c) => c.key === secrets.oneCKey));
  const state = await readFile(join(config.stateDir, 'state.json'), 'utf8');
  assert(!state.includes(secrets.autexaKey));
  assert(!state.includes('Баллон'));
});

test('lost Autexa ACK replays only the ACK, not the 1C financial operation', async (t) => {
  let ackAttempts = 0;
  let applies = 0;
  const request = async (url) => {
    if (url.endsWith('/health')) return health;
    if (url.includes('/changes?')) return { items: [], nextCursor: null, hasMore: false };
    if (url.includes('/bridge/export?')) return { items: [item], nextCursor: null };
    if (url.endsWith('/apply')) {
      applies++;
      return { status: 'applied', externalId: '1c-1', externalRevision: 'v1' };
    }
    if (url.endsWith('/bridge/ack')) {
      if (++ackAttempts === 1) throw new Error('connection reset');
      return { accepted: 1, needsReview: 0 };
    }
  };
  const { config, bridge } = await fixture(t, request);
  await assert.rejects(bridge.cycle(), /connection reset/);
  const next = await createBridge(config, secrets, { request });
  await next.cycle();
  assert.equal(applies, 1);
  assert.equal(ackAttempts, 2);
});

test('lost 1C apply response retries the same stable idempotency key', async (t) => {
  const eventIds = [];
  const request = async (url, _key, options = {}) => {
    if (url.endsWith('/health')) return health;
    if (url.includes('/changes?')) return { items: [], nextCursor: null, hasMore: false };
    if (url.includes('/bridge/export?')) return { items: [item], nextCursor: null };
    if (url.endsWith('/apply')) {
      eventIds.push(options.body.eventId);
      if (eventIds.length === 1) throw new Error('lost response');
      return { status: 'applied', externalId: '1c-1', externalRevision: 'v1' };
    }
    if (url.endsWith('/bridge/ack')) return { accepted: 1, needsReview: 0 };
  };
  const { config, bridge } = await fixture(t, request);
  await assert.rejects(bridge.cycle());
  await (await createBridge(config, secrets, { request })).cycle();
  assert.equal(eventIds.length, 2);
  assert.equal(eventIds[0], eventIds[1]);
});

test('uncertain imports are acknowledged as needs_review, never claimed applied', async (t) => {
  let ack;
  const { bridge } = await fixture(t, async (url, _key, options = {}) => {
    if (url.endsWith('/health')) return { ...health, importEntities: [] };
    if (url.includes('/changes?'))
      return {
        items: [{ eventId: 'e1', entityType: 'products', externalId: 'p1', payload: {} }],
        nextCursor: '1',
        hasMore: false,
      };
    if (url.endsWith('/bridge/import')) return { id: 'receipt', status: 'needs_review', autexaId: null };
    if (url.endsWith('/changes/ack')) {
      ack = options.body;
      return { accepted: true };
    }
  });
  assert.deepEqual(await bridge.cycle(), { imported: 0, exported: 0, needsReview: 1 });
  assert.equal(ack.status, 'needs_review');
});

test('refuses corrupt or another connection state instead of discarding history', async (t) => {
  const { config } = await fixture(t, async () => health);
  await writeFile(join(config.stateDir, 'state.json'), '{broken');
  await assert.rejects(createBridge(config, secrets), /refusing to overwrite/);
  await writeFile(
    join(config.stateDir, 'state.json'),
    JSON.stringify({ version: 1, identity: 'wrong', outgoing: {}, pendingAcks: [] }),
  );
  await assert.rejects(createBridge(config, secrets), /another connection/);
});

test('refuses an unverified adapter before sending any tenant data', async (t) => {
  let calls = 0;
  const { bridge } = await fixture(t, async () => {
    calls++;
    return { ...health, durableIdempotency: false };
  });
  await assert.rejects(bridge.cycle(), /not verified/);
  assert.equal(calls, 1);
});

test('idle incoming page can keep its terminal cursor without blocking new outbound data', async (t) => {
  let revision = 'revision-1';
  let applyCount = 0;
  const request = async (url) => {
    if (url.endsWith('/health')) return health;
    if (url.includes('/changes?')) return { items: [], nextCursor: 'stable-cursor', hasMore: false };
    if (url.includes('/bridge/export?')) return { items: [{ ...item, revision }], nextCursor: null };
    if (url.endsWith('/apply')) {
      applyCount++;
      return { status: 'applied', externalId: '1c-1', externalRevision: revision };
    }
    if (url.endsWith('/bridge/ack')) return { accepted: 1, needsReview: 0 };
  };
  const { bridge } = await fixture(t, request);
  await bridge.cycle();
  revision = 'revision-2';
  assert.deepEqual(await bridge.cycle(), { imported: 0, exported: 1, needsReview: 0 });
  assert.equal(applyCount, 2);
});

test('HTTP transport disallows redirects and does not disclose remote error text', async () => {
  await assert.rejects(
    jsonRequest('https://test', 'key', {
      fetchImpl: async (_url, opts) => {
        assert.equal(opts.redirect, 'error');
        return new Response('secret customer record', { status: 403 });
      },
    }),
    (e) => e.message === 'Exchange HTTP 403' && !e.message.includes('secret'),
  );
});

test('A→B→A changes use distinct transition ids rather than replaying the first A', async (t) => {
  let revision = 'A';
  const events = [];
  const request = async (url, _key, options = {}) => {
    if (url.endsWith('/health')) return health;
    if (url.includes('/changes?')) return { items: [], nextCursor: null, hasMore: false };
    if (url.includes('/bridge/export?')) return { items: [{ ...item, revision }], nextCursor: null };
    if (url.endsWith('/apply')) {
      events.push(options.body.eventId);
      return { status: 'applied', externalId: '1c-1', externalRevision: `version-${events.length}` };
    }
    if (url.endsWith('/bridge/ack')) return { accepted: 1, needsReview: 0 };
  };
  const { bridge } = await fixture(t, request);
  await bridge.cycle();
  revision = 'B';
  await bridge.cycle();
  revision = 'A';
  await bridge.cycle();
  assert.equal(new Set(events).size, 3);
});
