import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { redisIncrWithExpiry } from '../redis';

/**
 * Global rate limiter with different limits per endpoint TYPE.
 *
 * Login/register only: 20/min  (brute-force protection)
 * Read endpoints:      600/min (handles SPAs that fan out 5-10 parallel queries
 *                               per page, multiplied by office NAT shared IPs)
 * Write endpoints:     150/min
 *
 * Bucket key = IP + a per-TOKEN fingerprint, so that multiple users behind the
 * same NAT (autoservice office Wi-Fi) don't share a quota.
 *
 * IMPORTANT — token fingerprint, not a fixed token slice:
 *   The previous implementation used `auth.slice(7, 23)` — the first 16 chars
 *   of the JWT. A JWT is `base64url(header).base64url(payload).signature`, and
 *   the header is ALWAYS `{"alg":"HS256","typ":"JWT"}` → its base64url prefix
 *   `eyJhbGciOiJIUzI1...` is byte-for-byte IDENTICAL for every token this
 *   server issues. The two tokens only diverge at char ~48 (inside the
 *   payload). So the "per-user" key collapsed to a single constant per IP:
 *   EVERY authenticated user behind one public IP shared ONE 600/min read
 *   bucket and ONE 150/min write bucket. In a real autoservice office (shared
 *   NAT + several staff + data-heavy pages) that bucket is exhausted in
 *   seconds → 429 storms. The web client tolerates 429, but the mobile client
 *   surfaces it as a screen error, and retries hit the same exhausted bucket,
 *   so the failure is deterministic ("retry does not help").
 *
 *   We now fingerprint the WHOLE token with a fast non-cryptographic-strength
 *   hash (SHA-1, truncated). This is per-token unique, fixed length, and never
 *   stores the bearer itself in memory — only a digest. Two different users
 *   (or two sessions of one user) now get genuinely distinct buckets.
 *
 * /auth/me, /auth/avatar, /auth/refresh are NOT rate-limited as auth — they
 * use the regular read/write buckets. Only /auth/login and /auth/register
 * have the strict brute-force limit.
 *
 * COUNTER STORAGE — Redis-first, in-memory fallback (fail-safe):
 *   When REDIS_URL is configured AND Redis is reachable, counters live in
 *   Redis (atomic INCR + a per-window PEXPIRE) so the limit is shared across
 *   every backend instance behind the load balancer. The instant Redis is
 *   absent, down, slow or errors in ANY way, we transparently fall back to the
 *   per-process in-memory Map below — the exact behaviour of the pre-Redis
 *   build. The guard NEVER throws a 500 because of Redis and NEVER blocks a
 *   legitimate request due to an infra hiccup: a Redis failure degrades to the
 *   local Map, it does not deny the request. Limits, bucket-key shapes, the
 *   60s window, the 429 text and the token fingerprint are all unchanged.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs = 60_000;

  constructor() {
    // Clean up expired entries every 5 minutes to prevent memory leaks
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.attempts.entries()) {
        if (now > entry.resetAt) this.attempts.delete(key);
      }
    }, 5 * 60_000);
  }

  // canActivate is async because the Redis path awaits an atomic INCR. NestJS
  // fully supports a guard returning Promise<boolean>. When Redis is not in
  // play (no URL / unavailable) the Redis call resolves to null synchronously
  // enough that the in-memory path is taken with no added latency.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const method = request.method;
    const path = request.path || request.url || '';
    const now = Date.now();

    // Identify the user behind a shared NAT by a fingerprint of their JWT.
    // We hash the FULL token (not a fixed slice — see the class doc: the first
    // ~48 chars are identical across all tokens, so a slice collapses every
    // user into one bucket). The digest is per-token unique, fixed length, and
    // we never keep the raw bearer in memory.
    const auth = (request.headers['authorization'] as string | undefined) || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const userKey = token ? crypto.createHash('sha1').update(token).digest('base64').slice(0, 22) : 'anon';
    const idKey = `${ip}:${userKey}`;

    // Determine bucket and limit
    let maxAttempts: number;
    let bucketKey: string;

    // Brute-force protection ONLY on credential-exchange endpoints
    if (/\/auth\/(login|register)\b/.test(path)) {
      maxAttempts = 20;
      bucketKey = `auth:${ip}`; // by IP only — login is unauthenticated
    } else if (method === 'GET') {
      maxAttempts = 600;
      bucketKey = `read:${idKey}`;
    } else {
      maxAttempts = 150;
      bucketKey = `write:${idKey}`;
    }

    // ── Redis path (shared across instances) ───────────────────────────────
    // redisIncrWithExpiry NEVER throws: it returns the new counter when Redis
    // is healthy, or null when there is no URL / Redis is down / it errored /
    // timed out. A null means "Redis unavailable" → fall through to the Map.
    const redisCount = await redisIncrWithExpiry(`rl:${bucketKey}`, this.windowMs);
    if (redisCount !== null) {
      if (redisCount > maxAttempts) {
        // We don't know the exact remaining TTL cheaply here; the window is
        // fixed at windowMs, so report the full window as a safe upper bound.
        const retryAfter = Math.ceil(this.windowMs / 1000);
        throw new HttpException(
          { message: `Слишком много запросов. Повторите через ${retryAfter} сек.` },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    }

    // ── In-memory fallback (per-process) ────────────────────────────────────
    // Identical to the pre-Redis behaviour. Used when REDIS_URL is unset or
    // Redis is unreachable; a Redis outage therefore degrades gracefully
    // instead of dropping rate-limiting entirely or returning 500s.
    const entry = this.attempts.get(bucketKey);
    if (!entry || now > entry.resetAt) {
      this.attempts.set(bucketKey, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    entry.count++;
    if (entry.count > maxAttempts) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new HttpException(
        { message: `Слишком много запросов. Повторите через ${retryAfter} сек.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
