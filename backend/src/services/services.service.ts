import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { capLimit } from '../common/cap-limit';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { PutServiceVisibilityRuleDto } from './dto/put-service-visibility-rule.dto';
import { normalizeServicePrice, ServicePriceInput } from './service-price-policy';
import type {
  ServiceImportPreview,
  ServiceImportPreviewRow,
  ServiceImportResult,
  ServiceImportRow,
} from '../../../shared/api/types';
import type { Service } from '../../../shared/types';

interface ServiceWriteInput extends ServicePriceInput {
  name?: string;
  category?: string | null;
  masterPercent?: unknown;
  warrantyDays?: unknown;
}

interface ServiceListQuery {
  page?: string | number;
  limit?: string | number;
  search?: string;
  category?: string;
  preferredOnly?: boolean | string;
}

interface ServiceImportOperation extends ServiceImportRow {
  action: 'create' | 'update';
  serviceId?: string;
  expectedPriceVersion?: number;
  normalizedPrice: ReturnType<typeof normalizeServicePrice>;
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
      priceType: (row.price_type ?? 'fixed') as 'fixed' | 'range',
      minPrice: Number(row.min_price ?? row.default_price) || 0,
      maxPrice: Number(row.max_price ?? row.default_price) || 0,
      priceVersion: Number(row.price_version) || 1,
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
      where += ` AND (s.name ILIKE $${idx} OR COALESCE(s.category, '') ILIKE $${idx})`;
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

  async create(tenantID: string, dto: ServiceWriteInput, actorId?: string) {
    const price = normalizeServicePrice(dto);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.service_price_actor', $1, true)", [actorId ?? '']);
      const { rows } = await client.query(
        `INSERT INTO services (name, category, default_price, master_percent, warranty_days, tenant_id,
                               price_type, min_price, max_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          dto.name,
          dto.category,
          price.defaultPrice,
          this.normalizeMasterPercent(dto.masterPercent),
          this.normalizeWarrantyDays(dto.warrantyDays),
          tenantID,
          price.priceType,
          price.minPrice,
          price.maxPrice,
        ],
      );
      await client.query('COMMIT');
      return this.mapService(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: string, tenantID: string, dto: ServiceWriteInput, actorId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM services WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
        id,
        tenantID,
      ]);
      if (!current.rows.length) throw new NotFoundException({ message: 'Услуга не найдена' });
      const prior = this.mapService(current.rows[0]);
      const sets: string[] = [];
      const vals: unknown[] = [];
      const set = (column: string, value: unknown) => {
        vals.push(value);
        sets.push(`${column}=$${vals.length}`);
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.category !== undefined) set('category', dto.category);
      if ([dto.priceType, dto.defaultPrice, dto.minPrice, dto.maxPrice].some((value) => value !== undefined)) {
        const price = normalizeServicePrice(dto, prior);
        set('price_type', price.priceType);
        set('default_price', price.defaultPrice);
        set('min_price', price.minPrice);
        set('max_price', price.maxPrice);
      }
      if (dto.masterPercent !== undefined) set('master_percent', this.normalizeMasterPercent(dto.masterPercent));
      if (dto.warrantyDays !== undefined) set('warranty_days', this.normalizeWarrantyDays(dto.warrantyDays));
      let result = prior;
      if (sets.length) {
        await client.query("SELECT set_config('app.service_price_actor', $1, true)", [actorId ?? '']);
        vals.push(id, tenantID);
        const { rows } = await client.query(
          `UPDATE services SET ${sets.join(', ')} WHERE id=$${vals.length - 1} AND tenant_id=$${vals.length} RETURNING *`,
          vals,
        );
        result = this.mapService(rows[0]);
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getPriceHistory(id: string, tenantID: string) {
    await this.getById(id, tenantID);
    const { rows } = await this.pool.query(
      `SELECT * FROM service_price_history WHERE service_id=$1 AND tenant_id=$2 ORDER BY version DESC`,
      [id, tenantID],
    );
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      priceType: row.price_type,
      defaultPrice: Number(row.default_price),
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      changedAt: row.changed_at,
      changedBy: row.changed_by,
      changedByName: row.changed_by_name,
      source: row.source,
    }));
  }

  async exportCatalog(tenantID: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM services WHERE tenant_id=$1 ORDER BY category NULLS FIRST, name',
      [tenantID],
    );
    return rows.map(this.mapService);
  }

  private importKey(name: string, category?: string | null) {
    const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
    return `${normalize(category ?? '')}\u0000${normalize(name)}`;
  }

  private async planServiceImport(tenantID: string, rows: ServiceImportRow[], client?: PoolClient) {
    const db = client ?? this.pool;
    const existingResult = await db.query(
      'SELECT * FROM services WHERE tenant_id=$1 ORDER BY id' + (client ? ' FOR UPDATE' : ''),
      [tenantID],
    );
    const existing = existingResult.rows.map((row) => this.mapService(row));
    const byId = new Map(existing.map((service) => [service.id, service]));
    const byKey = new Map<string, typeof existing>();
    for (const service of existing) {
      const key = this.importKey(service.name, service.category);
      byKey.set(key, [...(byKey.get(key) ?? []), service]);
    }
    const preliminary: Array<{
      row: ServiceImportRow;
      service?: (typeof existing)[number];
      message?: string;
      normalizedPrice?: ReturnType<typeof normalizeServicePrice>;
    }> = [];
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 2000) {
      throw new BadRequestException({ message: 'Файл должен содержать от 1 до 2 000 строк услуг' });
    }
    for (const row of rows) {
      let message: string | undefined;
      let service: (typeof existing)[number] | undefined;
      let normalizedPrice: ReturnType<typeof normalizeServicePrice> | undefined;
      let normalizedCategory = row.category;
      if (
        !Number.isInteger(row.sourceRow) ||
        row.sourceRow < 2 ||
        typeof row.name !== 'string' ||
        !row.name.trim() ||
        row.name.length > 256
      ) {
        message = 'Укажите название услуги';
      } else if (row.category !== undefined && (typeof row.category !== 'string' || row.category.length > 256)) {
        message = 'Путь категории слишком длинный';
      } else {
        try {
          const category = row.category ? this.normalizeCategoryPath(row.category) : undefined;
          normalizedCategory = category;
          normalizedPrice = normalizeServicePrice({
            priceType: row.priceType,
            defaultPrice: row.priceType === 'fixed' ? row.defaultPrice : row.minPrice,
            minPrice: row.priceType === 'range' ? row.minPrice : undefined,
            maxPrice: row.priceType === 'range' ? row.maxPrice : undefined,
          });
          if (
            row.masterPercent != null &&
            (!Number.isFinite(Number(row.masterPercent)) ||
              Number(row.masterPercent) < 0 ||
              Number(row.masterPercent) > 100)
          ) {
            throw new Error('Процент мастера должен быть от 0 до 100');
          }
          if (
            row.warrantyDays != null &&
            (!Number.isInteger(Number(row.warrantyDays)) ||
              Number(row.warrantyDays) < 0 ||
              Number(row.warrantyDays) > 36500)
          ) {
            throw new Error('Срок гарантии должен быть целым числом от 0 до 36 500 дней');
          }
          if (row.id) {
            service = byId.get(row.id);
            if (!service) message = 'Услуга по указанному ID не найдена в вашем каталоге';
          } else {
            const matches = byKey.get(this.importKey(row.name, category));
            if (matches && matches.length > 1) message = 'Несколько услуг с таким названием и категорией — укажите ID';
            else service = matches?.[0];
          }
        } catch (error) {
          if (error instanceof BadRequestException) {
            const response = error.getResponse();
            const responseMessage =
              typeof response === 'object' && response !== null
                ? (response as { message?: unknown }).message
                : undefined;
            message =
              typeof responseMessage === 'string'
                ? responseMessage
                : Array.isArray(responseMessage)
                  ? responseMessage.join(', ')
                  : error.message;
          } else if (error instanceof Error) message = error.message;
          else message = 'Проверьте значения цены';
        }
      }
      preliminary.push({ row: { ...row, category: normalizedCategory }, service, message, normalizedPrice });
    }

    const counts = new Map<string, number>();
    for (const item of preliminary) {
      if (item.message) continue;
      const key = item.service ? `id:${item.service.id}` : `key:${this.importKey(item.row.name, item.row.category)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const operations: ServiceImportOperation[] = [];
    const previewRows: ServiceImportPreviewRow[] = preliminary.map((item) => {
      const key = item.service ? `id:${item.service.id}` : `key:${this.importKey(item.row.name, item.row.category)}`;
      const duplicate = !item.message && (counts.get(key) ?? 0) > 1;
      const message =
        item.message ??
        (duplicate ? 'Повтор услуги в файле — строки с этим ID или названием и категорией отклонены' : undefined);
      if (message || !item.normalizedPrice)
        return {
          sourceRow: item.row.sourceRow,
          action: 'error',
          name: item.row.name,
          category: item.row.category,
          message,
        };
      const operation: ServiceImportOperation = {
        ...item.row,
        action: item.service ? 'update' : 'create',
        serviceId: item.service?.id,
        expectedPriceVersion: item.service?.priceVersion,
        normalizedPrice: item.normalizedPrice,
      };
      operations.push(operation);
      return {
        sourceRow: item.row.sourceRow,
        action: operation.action,
        serviceId: operation.serviceId,
        expectedPriceVersion: operation.expectedPriceVersion,
        name: operation.name,
        category: operation.category,
      };
    });
    const errors = previewRows
      .filter((row) => row.action === 'error')
      .map((row) => `Строка ${row.sourceRow}: ${row.message}`);
    const preview = {
      rows: previewRows,
      errors,
      summary: {
        totalRows: rows.length,
        create: previewRows.filter((row) => row.action === 'create').length,
        update: previewRows.filter((row) => row.action === 'update').length,
        errors: errors.length,
      },
    };
    return { operations, preview };
  }

  async previewImport(tenantID: string, actorId: string, rows: ServiceImportRow[]): Promise<ServiceImportPreview> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { operations, preview } = await this.planServiceImport(tenantID, rows, client);
      const previewId = randomUUID();
      await client.query(
        `INSERT INTO service_import_batches (id, tenant_id, actor_id, preview_rows, preview_result)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)`,
        [previewId, tenantID, actorId, JSON.stringify(rows), JSON.stringify(preview)],
      );
      await client.query('COMMIT');
      return { previewId, ...preview };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async confirmImport(
    tenantID: string,
    actorId: string,
    previewId: string,
    requestId: string,
  ): Promise<ServiceImportResult> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previewId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    ) {
      throw new BadRequestException({ message: 'Некорректный идентификатор импорта' });
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await client.query(
        'SELECT id, result FROM service_import_batches WHERE tenant_id=$1 AND request_id=$2 FOR UPDATE',
        [tenantID, requestId],
      );
      if (replay.rows.length) {
        if (replay.rows[0].id !== previewId || !replay.rows[0].result)
          throw new ConflictException({ message: 'Идентификатор запроса уже использован для другого импорта' });
        await client.query('COMMIT');
        return replay.rows[0].result;
      }
      const batch = await client.query('SELECT * FROM service_import_batches WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
        previewId,
        tenantID,
      ]);
      if (!batch.rows.length) throw new NotFoundException({ message: 'Предварительный просмотр не найден' });
      if (batch.rows[0].result)
        throw new ConflictException({ message: 'Предварительный просмотр уже подтверждён другим запросом' });
      const rows = batch.rows[0].preview_rows as ServiceImportRow[];
      const originalPlan = this.planImportFromPreview(batch.rows[0].preview_result);
      if (originalPlan.preview.summary.errors > 0)
        throw new BadRequestException({
          message: 'Исправьте ошибки в файле и выполните предварительный просмотр заново',
          errors: originalPlan.preview.errors,
        });
      const { operations, preview } = await this.planServiceImport(tenantID, rows, client);
      const expected = originalPlan.preview.rows.map(
        (row) => `${row.sourceRow}:${row.action}:${row.serviceId ?? ''}:${row.expectedPriceVersion ?? ''}`,
      );
      const current = preview.rows.map(
        (row) => `${row.sourceRow}:${row.action}:${row.serviceId ?? ''}:${row.expectedPriceVersion ?? ''}`,
      );
      if (preview.summary.errors || expected.join('|') !== current.join('|')) {
        throw new ConflictException({
          message: 'Каталог изменился после предварительного просмотра. Загрузите файл ещё раз.',
        });
      }
      await client.query("SELECT set_config('app.service_price_actor', $1, true)", [actorId]);
      const imported: Service[] = [];
      for (const op of operations) {
        const price = op.normalizedPrice;
        if (op.action === 'create') {
          const masterPercent = op.masterPercent == null ? null : this.normalizeMasterPercent(op.masterPercent);
          const warrantyDays = this.normalizeWarrantyDays(op.warrantyDays);
          const result = await client.query(
            `INSERT INTO services (name, category, default_price, master_percent, warranty_days, tenant_id, price_type, min_price, max_price)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              op.name.trim(),
              op.category || null,
              price.defaultPrice,
              masterPercent,
              warrantyDays,
              tenantID,
              price.priceType,
              price.minPrice,
              price.maxPrice,
            ],
          );
          imported.push(this.mapService(result.rows[0]));
        } else {
          const masterPercent = op.masterPercent == null ? null : this.normalizeMasterPercent(op.masterPercent);
          const warrantyDays = this.normalizeWarrantyDays(op.warrantyDays);
          const result = await client.query(
            `UPDATE services SET name=$1, category=$2, default_price=$3,
               master_percent=CASE WHEN $4::boolean THEN $5 ELSE master_percent END,
               warranty_days=CASE WHEN $6::boolean THEN $7 ELSE warranty_days END,
               price_type=$8, min_price=$9, max_price=$10 WHERE id=$11 AND tenant_id=$12 RETURNING *`,
            [
              op.name.trim(),
              op.category || null,
              price.defaultPrice,
              op.masterPercent !== undefined,
              masterPercent,
              op.warrantyDays !== undefined,
              warrantyDays,
              price.priceType,
              price.minPrice,
              price.maxPrice,
              op.serviceId,
              tenantID,
            ],
          );
          if (!result.rows.length) throw new ConflictException({ message: 'Услуга больше не найдена' });
          imported.push(this.mapService(result.rows[0]));
        }
      }
      const result: ServiceImportResult = {
        requestId,
        created: operations.filter((operation) => operation.action === 'create').length,
        updated: operations.filter((operation) => operation.action === 'update').length,
        services: imported,
      };
      await client.query(
        `UPDATE service_import_batches SET request_id=$1, result=$2::jsonb, confirmed_at=now()
          WHERE id=$3 AND tenant_id=$4`,
        [requestId, JSON.stringify(result), previewId, tenantID],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private planImportFromPreview(value: unknown): { preview: ServiceImportPreview } {
    return { preview: value as ServiceImportPreview };
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
