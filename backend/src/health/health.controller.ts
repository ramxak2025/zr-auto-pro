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

  @Get('db')
  async healthDb() {
    try {
      await this.pool.query('SELECT 1');

      // Only return aggregate counts — never expose user data on unauthenticated endpoints
      const { rows: [counts] } = await this.pool.query(
        `SELECT
           (SELECT COUNT(*) FROM users) as user_count,
           (SELECT COUNT(*) FROM tenants) as tenant_count`,
      );

      return {
        db: 'OK',
        userCount: parseInt(counts.user_count),
        tenantCount: parseInt(counts.tenant_count),
      };
    } catch (err) {
      return { db: 'ERROR', error: 'Database connection failed' };
    }
  }
}
