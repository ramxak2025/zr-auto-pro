import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

/**
 * Global rate limiter with different limits per endpoint type.
 * - Auth endpoints: 10 requests/minute
 * - Write operations (POST/PATCH/DELETE): 30 requests/minute
 * - Read operations (GET): 120 requests/minute
 *
 * Uses in-memory storage with automatic cleanup every 5 minutes.
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

    // Determine limit based on endpoint type
    let maxAttempts: number;
    let bucketKey: string;

    if (path.includes('/auth/')) {
      maxAttempts = 10;
      bucketKey = `auth:${ip}`;
    } else if (method === 'GET') {
      maxAttempts = 120;
      bucketKey = `read:${ip}`;
    } else {
      maxAttempts = 30;
      bucketKey = `write:${ip}`;
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
