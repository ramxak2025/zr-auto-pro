#!/usr/bin/env node
/** Durable transport between Autexa and a configuration-specific 1C HTTP adapter. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENTITY_TYPES = ['products', 'stock', 'clients', 'purchases', 'workOrders', 'payments'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function baseUrl(input) {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Credentials/query must not be included in URLs');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
  ) {
    throw new Error('HTTPS is required (HTTP is allowed only on loopback)');
  }
  return url.href.replace(/\/$/, '');
}

export function validateConfig(raw) {
  if (!object(raw) || typeof raw.connectionId !== 'string' || !raw.connectionId.trim())
    throw new Error('connectionId is required');
  if (!Array.isArray(raw.entities) || !raw.entities.length || raw.entities.some((v) => !ENTITY_TYPES.includes(v)))
    throw new Error('Select supported entities');
  const intervalSeconds = raw.intervalSeconds ?? 60;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 86400)
    throw new Error('intervalSeconds must be 10..86400');
  return {
    connectionId: raw.connectionId,
    autexaUrl: baseUrl(raw.autexaUrl),
    oneCUrl: baseUrl(raw.oneCUrl),
    entities: [...new Set(raw.entities)],
    intervalSeconds,
    stateDir: resolve(raw.stateDir ?? './one-c-state'),
  };
}

export async function jsonRequest(url, key, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // Never print arbitrary remote error bodies: they can contain credentials or customer data.
  if (!response.ok) {
    const error = new Error(`Exchange HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty exchange response');
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 8 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('Exchange response exceeds 8 MiB');
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function saveState(path, state) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(state));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
  // Persist the rename on systems supporting directory fsync.
  const directory = await open(dirname(path), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function createBridge(raw, secrets, options = {}) {
  const config = validateConfig(raw);
  if (!secrets.autexaKey || !secrets.oneCKey) throw new Error('AUTEXA_ONE_C_KEY and ONE_C_ADAPTER_KEY are required');
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  const statePath = resolve(config.stateDir, 'state.json');
  const identity = hash(JSON.stringify([config.connectionId, config.autexaUrl, config.oneCUrl]));
  let state;
  try {
    state = JSON.parse(await readFile(statePath, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('Cannot read exchange state; refusing to overwrite it');
  }
  if (
    state &&
    (state.version !== 1 || state.identity !== identity || !object(state.outgoing) || !Array.isArray(state.pendingAcks))
  ) {
    throw new Error('State belongs to another connection or is corrupt; use a separate state directory');
  }
  state ??= { version: 1, identity, incomingCursor: null, outgoing: {}, pendingAcks: [] };
  const request = options.request ?? jsonRequest;
  const autexa = (path, data) => request(`${config.autexaUrl}${path}`, secrets.autexaKey, data);
  const oneC = (path, data) => request(`${config.oneCUrl}${path}`, secrets.oneCKey, data);
  const persist = () => saveState(statePath, state);

  async function drainAcks() {
    while (state.pendingAcks.length) {
      const ack = state.pendingAcks[0];
      const result = await autexa('/one-c/bridge/ack', { method: 'POST', body: ack });
      if (!object(result) || result.accepted + result.needsReview !== ack.items.length)
        throw new Error('Invalid Autexa acknowledgement');
      // needsReview means the source changed while 1C was applying this revision.
      // Retain its old revision in local state; the next sweep exports the new one.
      state.pendingAcks.shift();
      await persist();
    }
  }

  async function cycle() {
    const health = await oneC('/health');
    if (
      health.protocol !== 1 ||
      health.ready !== true ||
      health.durableIdempotency !== true ||
      health.connectionId !== config.connectionId
    ) {
      throw new Error('1C adapter is not verified for this connection or lacks durable idempotency');
    }
    if (!Array.isArray(health.exportEntities) || !Array.isArray(health.importEntities))
      throw new Error('Invalid 1C capabilities');
    await drainAcks();
    const counts = { imported: 0, exported: 0, needsReview: 0 };
    const seenIncoming = new Set();
    for (;;) {
      const cursor = state.incomingCursor;
      const page = await oneC(`/changes?limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
      if (
        !object(page) ||
        !Array.isArray(page.items) ||
        page.items.length > 100 ||
        !(page.nextCursor === null || typeof page.nextCursor === 'string')
      )
        throw new Error('Invalid 1C change page');
      for (const event of page.items) {
        if (
          !object(event) ||
          !config.entities.includes(event.entityType) ||
          !health.exportEntities.includes(event.entityType) ||
          typeof event.eventId !== 'string' ||
          !event.eventId ||
          typeof event.externalId !== 'string' ||
          !event.externalId ||
          !object(event.payload)
        )
          throw new Error('Invalid 1C change event');
        const response = await autexa('/one-c/bridge/import', {
          method: 'POST',
          body: {
            eventId: event.eventId,
            entityType: event.entityType,
            externalId: event.externalId,
            ...(event.baseRevision === undefined ? {} : { baseRevision: event.baseRevision }),
            payload: event.payload,
          },
        });
        if (!object(response) || !['applied', 'needs_review', 'rejected'].includes(response.status))
          throw new Error('Invalid Autexa import result');
        // The 1C adapter retains conflicts in its review journal. A transport ACK
        // is not a claim that a rejected/uncertain document has been posted.
        const ack = await oneC('/changes/ack', {
          method: 'POST',
          body: {
            eventId: event.eventId,
            status: response.status,
            autexaId: response.autexaId,
            receiptId: response.id,
          },
        });
        if (ack?.accepted !== true) throw new Error('1C did not acknowledge its outgoing event');
        if (response.status === 'applied') counts.imported++;
        else counts.needsReview++;
      }
      if (page.nextCursor !== null) {
        if (page.hasMore && (page.nextCursor === cursor || seenIncoming.has(page.nextCursor)))
          throw new Error('1C cursor did not advance');
        seenIncoming.add(page.nextCursor);
        state.incomingCursor = page.nextCursor;
        await persist();
      }
      if (!page.hasMore) break;
      if (page.nextCursor === null) throw new Error('Missing cursor for the next 1C page');
    }
    for (const entityType of config.entities) {
      if (!health.importEntities.includes(entityType)) continue;
      let cursor = null;
      const seen = new Set();
      for (;;) {
        const page = await autexa(
          `/one-c/bridge/export?entityType=${entityType}&limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
        );
        if (
          !object(page) ||
          !Array.isArray(page.items) ||
          page.items.length > 100 ||
          !(page.nextCursor === null || typeof page.nextCursor === 'string')
        )
          throw new Error('Invalid Autexa export page');
        for (const item of page.items) {
          if (
            !object(item) ||
            typeof item.autexaId !== 'string' ||
            !item.autexaId ||
            typeof item.revision !== 'string' ||
            !item.revision ||
            !object(item.payload)
          )
            throw new Error('Invalid Autexa export item');
          const recordKey = `${entityType}:${item.autexaId}`;
          const previous = state.outgoing[recordKey];
          if (previous?.revision === item.revision) continue;
          // Include the last acknowledged target version: A→B→A is a NEW
          // transition, while a lost HTTP response retries the SAME transition.
          const eventId = hash(
            JSON.stringify([
              config.connectionId,
              entityType,
              item.autexaId,
              item.revision,
              previous?.revision ?? null,
              previous?.externalRevision ?? null,
            ]),
          );
          const result = await oneC('/apply', {
            method: 'POST',
            body: {
              eventId,
              entityType,
              ...item,
              ...(previous?.externalRevision ? { baseExternalRevision: previous.externalRevision } : {}),
            },
          });
          if (!object(result) || !['applied', 'needs_review', 'rejected'].includes(result.status))
            throw new Error('Invalid 1C apply result');
          if (result.status !== 'applied') {
            counts.needsReview++;
            continue;
          }
          if (
            typeof result.externalId !== 'string' ||
            !result.externalId ||
            typeof result.externalRevision !== 'string' ||
            !result.externalRevision
          )
            throw new Error('1C must return the applied identity and revision');
          state.outgoing[recordKey] = {
            revision: item.revision,
            externalId: result.externalId,
            externalRevision: result.externalRevision,
          };
          state.pendingAcks.push({
            entityType,
            items: [{ autexaId: item.autexaId, externalId: result.externalId, revision: item.revision }],
          });
          await persist();
          await drainAcks();
          counts.exported++;
        }
        if (page.nextCursor === null) break;
        if (page.nextCursor === cursor || seen.has(page.nextCursor)) throw new Error('Autexa cursor did not advance');
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
      }
    }
    return counts;
  }
  return { cycle, config };
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error('Usage: node bridge.mjs config.json [--once]');
  const raw = JSON.parse(await readFile(resolve(configPath), 'utf8'));
  const config = validateConfig(raw);
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  const lockPath = resolve(config.stateDir, 'bridge.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new Error('Bridge lock exists; check that another process is not running before removing it');
  });
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const bridge = await createBridge(config, {
      autexaKey: process.env.AUTEXA_ONE_C_KEY,
      oneCKey: process.env.ONE_C_ADAPTER_KEY,
    });
    do {
      try {
        console.log(JSON.stringify({ at: new Date().toISOString(), ...(await bridge.cycle()) }));
      } catch (e) {
        // Only transport error classes/status are logged, never payloads or keys.
        console.error(
          JSON.stringify({ at: new Date().toISOString(), error: 'exchange_failed', status: e.status ?? null }),
        );
        if (process.argv.includes('--once'))
          throw new Error('Exchange failed; inspect the tenant/1C journals and adapter connection');
      }
      if (stopped || process.argv.includes('--once')) break;
      for (let elapsed = 0; elapsed < config.intervalSeconds && !stopped; elapsed++)
        await new Promise((r) => setTimeout(r, 1000));
    } while (!stopped);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
