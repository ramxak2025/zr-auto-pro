import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';

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

  canActivate(context: ExecutionContext): boolean {
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
