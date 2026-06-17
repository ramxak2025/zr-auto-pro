import Redis from 'ioredis';
import { Logger } from '@nestjs/common';

/**
 * Optional, fail-safe Redis client.
 *
 * Goals (PROD-grade, single human acceptance pass):
 *  - If REDIS_URL is unset → there is NO client at all (getRedis() === null).
 *    Every caller MUST treat null as "Redis unavailable" and fall back to its
 *    own in-memory path. This keeps behaviour 1:1 with the pre-Redis build.
 *  - If REDIS_URL is set but Redis is down/unreachable/slow → we NEVER crash
 *    the process and we NEVER let a Redis error bubble into a request. The
 *    client uses lazyConnect, a capped retry strategy and maxRetriesPerRequest
 *    so a failed command rejects fast instead of hanging the event loop.
 *  - Logging is one-shot per state transition (connected / errored) so a flaky
 *    Redis cannot spam the logs.
 *
 * This module exposes a tiny, intentionally minimal surface:
 *   - getRedis(): Redis | null            → raw client or null (no URL)
 *   - redisIncrWithExpiry(key, windowMs)  → atomic INCR (+PEXPIRE on first hit),
 *                                            returns the new counter or null if
 *                                            Redis is unavailable / errored /
 *                                            timed out. NEVER throws.
 */

const logger = new Logger('Redis');

let client: Redis | null = null;
let initialised = false;
// Once a connection error is logged we stay quiet until we successfully
// (re)connect, so a down Redis does not flood the logs on every retry.
let errorLogged = false;
let connectedLogged = false;

const REDIS_URL = process.env.REDIS_URL;

function init(): void {
  if (initialised) return;
  initialised = true;

  if (!REDIS_URL) {
    // No URL → no client. Callers fall back to in-memory. This is the default
    // (and current) production behaviour.
    client = null;
    return;
  }

  try {
    client = new Redis(REDIS_URL, {
      // Connect on first command, not at import time — never block boot.
      lazyConnect: true,
      // Fail a command after a single retry instead of queueing forever; this
      // is what makes a slow/dead Redis reject fast so the guard can fall back.
      maxRetriesPerRequest: 1,
      // Do NOT keep an unbounded offline queue; if we are disconnected, fail
      // the command immediately and let the caller use its in-memory fallback.
      enableOfflineQueue: false,
      enableReadyCheck: true,
      connectTimeout: 1500,
      // Capped reconnect backoff: 200ms, 400ms, ... up to 3s. Stop trying to
      // reconnect after a high attempt count is unnecessary — ioredis keeps the
      // delay capped, which is enough to avoid a hot loop.
      retryStrategy: (times: number) => Math.min(times * 200, 3000),
    });

    client.on('error', (err: Error) => {
      if (!errorLogged) {
        logger.warn(`Redis unavailable, falling back to in-memory: ${err.message}`);
        errorLogged = true;
      }
      connectedLogged = false;
    });

    client.on('ready', () => {
      if (!connectedLogged) {
        logger.log('Redis connected');
        connectedLogged = true;
      }
      errorLogged = false;
    });

    // Kick off the connection in the background. Swallow the rejection — a
    // failed initial connect must not produce an unhandled promise rejection
    // and must not crash the process; the 'error' handler above logs it once.
    client.connect().catch(() => {
      /* handled by the 'error' listener; in-memory fallback stays in effect */
    });
  } catch (err) {
    // Constructing the client should not throw for a valid URL, but be safe:
    // any failure here means "no Redis", callers fall back to in-memory.
    if (!errorLogged) {
      logger.warn(`Redis init failed, falling back to in-memory: ${(err as Error).message}`);
      errorLogged = true;
    }
    client = null;
  }
}

/**
 * The shared client, or null when REDIS_URL is not configured.
 * A returned client may still be (temporarily) disconnected — commands handle
 * that by rejecting fast; callers must catch and fall back.
 */
export function getRedis(): Redis | null {
  init();
  return client;
}

/**
 * Atomically increment a fixed-window counter and set its TTL on the first hit.
 * Returns the post-increment count, or null when Redis is unavailable /
 * errored / timed out (NEVER throws).
 *
 * We PEXPIRE only when the counter just became 1 (a fresh window started),
 * which is the standard fixed-window pattern and — crucially — does NOT depend
 * on the `PEXPIRE ... NX` option (that flag needs Redis 7.0+; this works on
 * every supported Redis version, so prod can run an older Redis without
 * surprises).
 *
 * Edge case: if a process ever died between the INCR and the PEXPIRE, a key
 * could be left counted but TTL-less. We defensively re-arm the TTL whenever we
 * see an existing key with PTTL === -1 ("exists, no expiry"), so a counter can
 * never get stuck high forever. Worst case under a partial failure is a single
 * over-counted window that then self-heals.
 */
export async function redisIncrWithExpiry(key: string, windowMs: number): Promise<number | null> {
  const redis = getRedis();
  if (!redis) return null;
  // Only attempt when the socket is actually usable; 'connecting'/'reconnecting'
  // with enableOfflineQueue:false would reject anyway, but checking first avoids
  // generating an error per request while Redis is down.
  if (redis.status !== 'ready') return null;

  try {
    // First: atomic INCR to learn whether this is the first hit of a window.
    const count = await redis.incr(key);
    if (count === 1) {
      // Fresh window — arm the TTL. If this PEXPIRE somehow fails, the key
      // still has the default no-expiry; but the next window-start INCR will
      // never run (count won't be 1 again), so we also guard below.
      await redis.pexpire(key, windowMs);
    } else {
      // Defensive: if a key ever lost its TTL (e.g. a crash between INCR and
      // PEXPIRE on a previous request), re-arm it so it cannot live forever.
      // PTTL === -1 means "exists, no expiry".
      const ttl = await redis.pttl(key);
      if (ttl === -1) await redis.pexpire(key, windowMs);
    }
    return typeof count === 'number' && Number.isFinite(count) ? count : null;
  } catch {
    // Any error/timeout → signal unavailability, caller uses in-memory.
    return null;
  }
}
