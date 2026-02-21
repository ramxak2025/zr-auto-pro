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

      const { rows: users } = await this.pool.query(
        'SELECT id, name, phone, role FROM users ORDER BY id LIMIT 100',
      );

      let adminCheck = 'Нет пользователей';
      if (users.length > 0) {
        const { rows: hashed } = await this.pool.query(
          `SELECT password_hash FROM users WHERE role = 'director' LIMIT 1`,
        );
        if (hashed.length > 0 && hashed[0].password_hash && hashed[0].password_hash.startsWith('$2')) {
          adminCheck = 'OK: пароли в bcrypt формате';
        } else if (hashed.length > 0) {
          adminCheck = 'Пароль не в bcrypt формате';
        } else {
          adminCheck = 'OK: нет директоров, но есть пользователи';
        }
      }

      return { db: 'OK', users, admin_check: adminCheck };
    } catch (err) {
      return { db: String(err), users: [], admin_check: null };
    }
  }
}
