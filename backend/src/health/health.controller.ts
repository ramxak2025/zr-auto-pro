import { Controller, Get, Header, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import { PG_POOL } from '../database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  @Get()
  health() {
    return { status: 'ok' };
  }

  /**
   * «Тяжёлая» проба для мобильного кольца хостов (анти-DPI-троттлинг):
   * status ok + ~32 КБ паддинга. DPI часто пропускает мелкие ответы (обычный
   * /health проходит), но душит крупные тела — сравнив лёгкую и тяжёлую
   * пробы, клиент отличает «хост жив» от «хост жив, но канал задушен».
   *
   * Паддинг — СЛУЧАЙНЫЕ байты (base64), не повторяющаяся строка, сознательно:
   *   1. gzip-middleware из main.ts ужал бы повторяющуюся строку до ~100 байт
   *      — проба переставала бы быть тяжёлой на проводе;
   *   2. новый паддинг = новый ETag на каждый ответ — глобальный
   *      ETagInterceptor никогда не превратит пробу в пустой 304.
   * Публичный, без JWT — как остальные эндпоинты этого модуля («без guard'ов
   * на контроллере», см. health.module.ts). Без запроса к БД.
   */
  @Get('heavy')
  @Header('Cache-Control', 'no-store')
  healthHeavy() {
    // 24 576 сырых байт → 32 768 символов base64 ≈ 32 КБ полезного тела.
    return { status: 'ok', padding: crypto.randomBytes(24576).toString('base64') };
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
