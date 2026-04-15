import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

/**
 * Global rate limiter with different limits per endpoint TYPE.
 *
 * Login/register only: 20/min  (brute-force protection)
 * Read endpoints:      600/min (handles SPAs that fan out 5-10 parallel queries
 *                               per page, multiplied by office NAT shared IPs)
 * Write endpoints:     150/min
 *
 * Bucket key = IP + Authorization (first 16 chars of token), so that multiple
 * users behind the same NAT (autoservice office Wi-Fi) don't share a quota.
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

    // Identify the user behind a shared NAT by their JWT (first 16 chars
    // is enough for uniqueness and avoids storing the full secret in memory).
    const auth = (request.headers['authorization'] as string | undefined) || '';
    const userKey = auth.startsWith('Bearer ') ? auth.slice(7, 23) : 'anon';
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
