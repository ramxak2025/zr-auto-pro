import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

const DEFAULT_SOURCES = [
  'Яндекс',
  '2GIS',
  'Google',
  'Авито',
  'ВКонтакте',
  'Instagram',
  'Мимо проезжал',
  'По рекомендации',
];

@Injectable()
export class ClientSourcesService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Get the tenant's source list. Lazily seeds the default row if the tenant
   * has never opened the settings screen. Mirrors the schedule-settings
   * pattern so the FE never has to special-case "empty" responses.
   */
  async get(tenantID: string): Promise<{ sources: string[] }> {
    const { rows } = await this.pool.query('SELECT sources FROM client_sources WHERE tenant_id=$1 LIMIT 1', [tenantID]);
    if (rows.length === 0) {
      await this.pool.query(
        `INSERT INTO client_sources (tenant_id, sources) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantID, DEFAULT_SOURCES],
      );
      return { sources: DEFAULT_SOURCES };
    }
    const raw = rows[0].sources;
    const sources = Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : DEFAULT_SOURCES;
    return { sources };
  }

  /**
   * Replace the tenant's source list. Empty strings are dropped, duplicates
   * collapsed, length capped at 100 chars per entry. An empty array is
   * allowed — it just means the FE shows the picker with "Добавить".
   */
  async update(tenantID: string, sources: unknown): Promise<{ sources: string[] }> {
    if (!Array.isArray(sources)) {
      throw new BadRequestException({ message: 'sources должен быть массивом' });
    }
    const cleaned: string[] = [];
    for (const raw of sources) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim().slice(0, 100);
      if (!trimmed) continue;
      if (cleaned.includes(trimmed)) continue;
      cleaned.push(trimmed);
    }
    await this.pool.query(
      `INSERT INTO client_sources (tenant_id, sources, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (tenant_id) DO UPDATE SET sources = EXCLUDED.sources, updated_at = now()`,
      [tenantID, cleaned],
    );
    return { sources: cleaned };
  }
}
