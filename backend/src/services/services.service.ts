import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { capLimit } from '../common/cap-limit';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { PutServiceVisibilityRuleDto } from './dto/put-service-visibility-rule.dto';

interface ServiceListQuery {
  page?: string | number;
  limit?: string | number;
  search?: string;
  category?: string;
  preferredOnly?: boolean | string;
}

@Injectable()
export class ServicesService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapService(row: any) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      defaultPrice: parseFloat(row.default_price) || 0,
      masterPercent:
        row.master_percent !== null && row.master_percent !== undefined ? parseFloat(row.master_percent) : null,
      warrantyDays: row.warranty_days !== null && row.warranty_days !== undefined ? parseInt(row.warranty_days) : null,
      createdAt: row.created_at,
    };
  }

  private normalizeWarrantyDays(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n)) return null;
    if (n <= 0) return null;
    return Math.min(n, 36500);
  }

  /**
   * Normalize the per-service master-commission override (`services.master_percent`,
   * exposed on the shared contract as `Service.masterPercent`). This is the
   * ALREADY-EXISTING per-service percent that — when NOT NULL — overrides the
   * line executor's `user.salary_percent` at check-write time (see
   * ChecksService.create/fullUpdate/recomputeClosedCheckLines). Contract:
   *   • undefined / null / '' / non-numeric → null («не задан» = использовать
   *     процент мастера);
   *   • a finite number → clamped to [0, 100].
   * `0` is a LEGITIMATE explicit override (мастер получает 0 за эту услугу) and is
   * preserved as `0` — NEVER coerced to null (the check-side rule keys on
   * `master_percent IS NOT NULL`, so 0 must survive as a real value). 100 is the
   * max sane commission; an out-of-range value (only reachable via a raw API
   * caller — the web field is a percent box) is clamped rather than rejected,
   * mirroring normalizeWarrantyDays, so a malformed write can never 500 and can
   * never bake a >100% payout into a salary snapshot.
   */
  private normalizeMasterPercent(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    if (!Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, n));
  }

  async getAll(tenantID: string, query: ServiceListQuery, actor: JwtPayload) {
    const page = parseInt(String(query.page ?? ''), 10) || 1;
    // Cap 10 000 (not lower): the cash-screen service picker fetches the full
    // catalogue today — see cap-limit.ts.
    const limit = capLimit(query.limit, 100, 10000);
    const offset = (page - 1) * limit;
    const search = query.search || '';
    const category = query.category || '';
    const preferredOnly = query.preferredOnly === true || query.preferredOnly === 'true';
    // Owner-class users configure the full catalog. For staff, this remains a
    // UI preference that can be disabled by the explicit full-catalog mode.
    const applyPreference = preferredOnly && actor.role !== 'director' && actor.role !== 'superadmin';

    let where = 's.tenant_id = $1';
    const params: unknown[] = [tenantID];
    let idx = 2;

    if (search) {
      where += ` AND s.name ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }
    if (category) {
      where += ` AND s.category = $${idx}`;
      params.push(category);
      idx++;
    }

    let from = 'FROM services s';
    if (applyPreference) {
      params.push(actor.userID);
      const userIdParam = `$${idx++}`;
      from += `
        LEFT JOIN users visibility_viewer
          ON visibility_viewer.id=${userIdParam} AND visibility_viewer.tenant_id=s.tenant_id
        LEFT JOIN LATERAL (
          SELECT rule.visible_role_ids
            FROM service_visibility_rules rule
           WHERE rule.tenant_id=s.tenant_id
             AND (
               rule.service_id=s.id
               OR (
                 rule.service_id IS NULL AND s.category IS NOT NULL
                 AND (
                   regexp_replace(regexp_replace(regexp_replace(btrim(s.category), '\\s*/\\s*', '/', 'g'), '/+', '/', 'g'), '^/|/$', '', 'g')=rule.category_path
                   OR left(regexp_replace(regexp_replace(regexp_replace(btrim(s.category), '\\s*/\\s*', '/', 'g'), '/+', '/', 'g'), '^/|/$', '', 'g'), length(rule.category_path) + 1)=rule.category_path || '/'
                 )
               )
             )
           ORDER BY (rule.service_id IS NOT NULL) DESC, length(rule.category_path) DESC NULLS LAST
           LIMIT 1
        ) visibility_rule ON true`;
      where +=
        ' AND (visibility_rule.visible_role_ids IS NULL OR visibility_viewer.role_id = ANY(visibility_rule.visible_role_ids))';
    }

    const countResult = await this.pool.query(`SELECT COUNT(*) as total ${from} WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT s.* ${from} WHERE ${where} ORDER BY s.name LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    return { data: rows.map(this.mapService), total, page, limit };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query('SELECT * FROM services WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Услуга не найдена' });
    return this.mapService(rows[0]);
  }

  async create(tenantID: string, dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO services (name, category, default_price, master_percent, warranty_days, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        dto.name,
        dto.category,
        dto.defaultPrice || 0,
        this.normalizeMasterPercent(dto.masterPercent),
        this.normalizeWarrantyDays(dto.warrantyDays),
        tenantID,
      ],
    );
    return this.mapService(rows[0]);
  }

  async update(id: string, tenantID: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.category !== undefined) {
      sets.push(`category=$${idx++}`);
      vals.push(dto.category);
    }
    if (dto.defaultPrice !== undefined) {
      sets.push(`default_price=$${idx++}`);
      vals.push(dto.defaultPrice);
    }
    if (dto.masterPercent !== undefined) {
      // Range-validate (0..100) + null-clear via the shared normalizer. `null`
      // clears the override back to «use the master's percent»; `0` is kept as a
      // real explicit override (мастер получает 0 за эту услугу).
      sets.push(`master_percent=$${idx++}`);
      vals.push(this.normalizeMasterPercent(dto.masterPercent));
    }
    if (dto.warrantyDays !== undefined) {
      sets.push(`warranty_days=$${idx++}`);
      vals.push(this.normalizeWarrantyDays(dto.warrantyDays));
    }

    if (sets.length === 0) return this.getById(id, tenantID);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE services SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Услуга не найдена' });
    return this.mapService(rows[0]);
  }

  async remove(id: string, tenantID: string) {
    await this.pool.query('DELETE FROM services WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }

  private normalizeCategoryPath(value: unknown): string {
    if (typeof value !== 'string') throw new BadRequestException({ message: 'Укажите путь папки' });
    const path = value
      .trim()
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('/');
    const segments = path.split('/');
    if (!path || path.length > 256 || segments.some((segment) => segment === '.' || segment === '..')) {
      throw new BadRequestException({ message: 'Некорректный путь папки' });
    }
    return path;
  }

  async getVisibilityConfig(tenantID: string) {
    const [rulesResult, categoryResult, roleResult] = await Promise.all([
      this.pool.query(
        `SELECT service_id, category_path, visible_role_ids
           FROM service_visibility_rules WHERE tenant_id=$1
          ORDER BY category_path NULLS FIRST, service_id`,
        [tenantID],
      ),
      this.pool.query<{ category: string | null }>(
        `SELECT DISTINCT category FROM services WHERE tenant_id=$1 AND category IS NOT NULL AND btrim(category)<>''`,
        [tenantID],
      ),
      this.pool.query<{
        id: string;
        name: string;
        tenant_id: string | null;
        system_key: string | null;
        is_system: boolean;
        sort: number;
      }>(
        `SELECT id, name, tenant_id, system_key, is_system, COALESCE(sort, 0) AS sort
           FROM roles WHERE tenant_id=$1 OR tenant_id IS NULL
          ORDER BY is_system DESC, sort ASC, name ASC`,
        [tenantID],
      ),
    ]);

    const overriddenKeys = new Set<string>(
      roleResult.rows
        .filter((role) => role.tenant_id !== null && role.system_key)
        .map((role) => role.system_key as string),
    );
    const roles = roleResult.rows
      .filter((role) => !(role.tenant_id === null && role.system_key && overriddenKeys.has(role.system_key)))
      .map((role) => ({ id: role.id, name: role.name, systemKey: role.system_key, isSystem: role.is_system }));
    const categoryPaths = new Set<string>();
    for (const row of categoryResult.rows) {
      const normalized = this.normalizeCategoryPath(row.category);
      const segments = normalized.split('/');
      for (let i = 1; i <= segments.length; i++) categoryPaths.add(segments.slice(0, i).join('/'));
    }

    return {
      rules: rulesResult.rows.map((rule) => ({
        serviceId: rule.service_id ?? null,
        categoryPath: rule.category_path ?? null,
        visibleRoleIds: Array.isArray(rule.visible_role_ids) ? rule.visible_role_ids : [],
      })),
      categoryPaths: [...categoryPaths].sort((a, b) => a.localeCompare(b, 'ru')),
      roles,
    };
  }

  async putVisibilityRule(tenantID: string, dto: PutServiceVisibilityRuleDto) {
    const hasService = typeof dto.serviceId === 'string';
    const hasCategory = typeof dto.categoryPath === 'string';
    if (hasService === hasCategory) {
      throw new BadRequestException({ message: 'Выберите услугу или папку, но не оба объекта сразу' });
    }
    const categoryPath = hasCategory ? this.normalizeCategoryPath(dto.categoryPath) : null;
    const roleIds = dto.visibleRoleIds ?? [];
    const visibleRoles = await this.getVisibleRoleIds(tenantID);
    const visibleRoleSet = new Set(visibleRoles);
    if (roleIds.some((roleId) => !visibleRoleSet.has(roleId))) {
      throw new BadRequestException({ message: 'Одна или несколько ролей не принадлежат этому автосервису' });
    }

    if (hasService) {
      const service = await this.pool.query('SELECT id FROM services WHERE id=$1 AND tenant_id=$2', [
        dto.serviceId,
        tenantID,
      ]);
      if (service.rows.length === 0) throw new NotFoundException({ message: 'Услуга не найдена' });
    }
    const serviceId = hasService ? dto.serviceId : null;

    try {
      const { rows } = await this.pool.query(
        `INSERT INTO service_visibility_rules (tenant_id, service_id, category_path, visible_role_ids)
         VALUES ($1, $2, $3, $4::uuid[])
         ON CONFLICT (tenant_id, service_id) WHERE service_id IS NOT NULL
           DO UPDATE SET visible_role_ids=EXCLUDED.visible_role_ids, updated_at=now()
         RETURNING service_id, category_path, visible_role_ids`,
        [tenantID, serviceId, categoryPath, roleIds],
      );
      return {
        serviceId: rows[0].service_id ?? null,
        categoryPath: rows[0].category_path ?? null,
        visibleRoleIds: rows[0].visible_role_ids,
      };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        // Partial unique indexes cannot be targeted by one generic ON CONFLICT
        // target in all supported Postgres versions; category rules use a
        // separate update path below.
        if (categoryPath) {
          const { rows } = await this.pool.query(
            `UPDATE service_visibility_rules SET visible_role_ids=$1::uuid[], updated_at=now()
              WHERE tenant_id=$2 AND category_path=$3
              RETURNING service_id, category_path, visible_role_ids`,
            [roleIds, tenantID, categoryPath],
          );
          if (rows.length > 0)
            return { serviceId: null, categoryPath: rows[0].category_path, visibleRoleIds: rows[0].visible_role_ids };
        }
      }
      throw error;
    }
  }

  async deleteVisibilityRule(tenantID: string, target: { serviceId?: string; categoryPath?: string }) {
    const hasService = typeof target.serviceId === 'string';
    const hasCategory = typeof target.categoryPath === 'string';
    if (hasService === hasCategory) throw new BadRequestException({ message: 'Укажите один объект правила' });
    if (hasService) {
      await this.pool.query('DELETE FROM service_visibility_rules WHERE tenant_id=$1 AND service_id=$2', [
        tenantID,
        target.serviceId,
      ]);
    } else {
      const path = this.normalizeCategoryPath(target.categoryPath);
      await this.pool.query('DELETE FROM service_visibility_rules WHERE tenant_id=$1 AND category_path=$2', [
        tenantID,
        path,
      ]);
    }
    return { message: 'Правило удалено; применяется наследование' };
  }

  private async getVisibleRoleIds(tenantID: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string; tenant_id: string | null; system_key: string | null }>(
      'SELECT id, tenant_id, system_key FROM roles WHERE tenant_id=$1 OR tenant_id IS NULL',
      [tenantID],
    );
    const overriddenKeys = new Set(
      rows.filter((row) => row.tenant_id !== null && row.system_key).map((row) => row.system_key as string),
    );
    return rows
      .filter((row) => !(row.tenant_id === null && row.system_key && overriddenKeys.has(row.system_key)))
      .map((row) => row.id);
  }
}
