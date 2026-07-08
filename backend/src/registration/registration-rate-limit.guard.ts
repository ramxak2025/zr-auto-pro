import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { redisIncrWithExpiry } from '../common/redis';

/**
 * Dedicated, STRICT rate limiter for the PUBLIC registration-request submit
 * endpoint (POST /registration-requests).
 *
 * Why a separate guard instead of editing the global RateLimitGuard:
 *   `common/guards/rate-limit.guard.ts` is a protected auth-zone file. This guard
 *   is purely additive — it REUSES the exact same bucket approach (fixed 60s
 *   window, Redis-first via redisIncrWithExpiry with a per-process in-memory
 *   fallback, NEVER throws on a Redis hiccup) but keys by a dedicated `reg:<ip>`
 *   bucket and a tighter cap. The global RateLimitGuard still meters this route
 *   too (as a normal anonymous write bucket) — this adds a much stricter,
 *   registration-specific ceiling on top (defense in depth against form spam and
 *   phone-enumeration probing).
 *
 * KEYING: by IP only. A registration submit carries no JWT (it is public), so
 * there is no per-user dimension — an abuser is identified purely by source IP.
 * Behind the Yandex reserve gateway many shops share one egress IP, but a public
 * registration form is low-frequency by nature (a shop registers ONCE), so a
 * small per-IP cap is safe and still leaves ample headroom for legitimate use.
 *
 * LIMIT: 5 submits / minute / IP. Enough for a human correcting a typo and
 * resubmitting; far too low for scripted spam or fast enumeration.
 *
 * FAIL-SAFE: identical to the global guard — a Redis outage degrades to the local
 * Map, never denies a legitimate request nor raises a 500 because of infra.
 */
@Injectable()
export class RegistrationRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs = 60_000;
  private readonly maxPerWindow = 5;

  constructor() {
    // Evict expired in-memory entries every 5 min so the Map can't leak.
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.attempts.entries()) {
        if (now > entry.resetAt) this.attempts.delete(key);
      }
    }, 5 * 60_000).unref?.();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const bucketKey = `reg:${ip}`;

    const res = await this.bump(bucketKey, now);
    if (res.overLimit) {
      const retryAfter = Math.ceil((res.resetAt - now) / 1000);
      throw new HttpException(
        { message: `Слишком много заявок. Повторите через ${retryAfter} сек.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /**
   * Increment the fixed-window bucket and report whether it is now over the cap.
   * Redis-first (shared across instances), in-memory fallback. NEVER throws.
   */
  private async bump(bucketKey: string, now: number): Promise<{ overLimit: boolean; resetAt: number }> {
    const redisCount = await redisIncrWithExpiry(`rl:${bucketKey}`, this.windowMs);
    if (redisCount !== null) {
      return { overLimit: redisCount > this.maxPerWindow, resetAt: now + this.windowMs };
    }

    const entry = this.attempts.get(bucketKey);
    if (!entry || now > entry.resetAt) {
      const resetAt = now + this.windowMs;
      this.attempts.set(bucketKey, { count: 1, resetAt });
      return { overLimit: false, resetAt };
    }
    entry.count++;
    return { overLimit: entry.count > this.maxPerWindow, resetAt: entry.resetAt };
  }
}
