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
      const { rows } = await this.pool.query('SELECT NOW() as time');
      return { status: 'ok', db: 'connected', time: rows[0].time };
    } catch (err) {
      return { status: 'error', db: 'disconnected', error: String(err) };
    }
  }
}
