import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  @Get()
  health() {
    return { status: 'ok' };
  }

  /**
   * Database liveness probe. Used by docker-compose / external monitors
   * via the nginx public path. Deliberately does NOT return platform-wide
   * counters anymore — exposing `SELECT COUNT(*) FROM users` on an
   * unauthenticated endpoint let competitors enumerate platform size and
   * acted as a leak surface (e.g. user_count > 0 → "they are live").
   */
  @Get('db')
  async healthDb() {
    try {
      await this.pool.query('SELECT 1');
      return { db: 'OK' };
    } catch {
      // Never echo back the driver's error message — it can include host,
      // port, and TLS details. Just signal failure.
      return { db: 'ERROR' };
    }
  }
}
