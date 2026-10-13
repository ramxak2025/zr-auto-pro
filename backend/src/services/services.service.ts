import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { capLimit } from '../common/cap-limit';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { ClientsService } from '../clients/clients.service';
import { actorPointId } from '../common/point-scope';
import { userHasPermission } from '../common/guards/permissions.guard';
import { PutServiceVisibilityRuleDto } from './dto/put-service-visibility-rule.dto';
import { normalizeServicePrice, ServicePriceInput } from './service-price-policy';
import { normalizeServicePay, ServicePayInput } from './service-pay-policy';
import type {
  ServiceImportPreview,
  ServiceImportPreviewRow,
  ServiceImportResult,
  ServiceImportRow,
  Service,
} from './service-import-types';

interface ServiceWriteInput extends ServicePriceInput, ServicePayInput {
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
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private clients: ClientsService,
  ) {}

  /** Serialize tenant catalog writes and import confirmations under one namespaced xact lock. */
  private async lockCatalogWrites(client: PoolClient, tenantID: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('autexa.services.catalog:' || $1, 0))", [
      tenantID,
    ]);
  }

  private mapService(row: any) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      defaultPrice: parseFloat(row.default_price) || 0,
      priceIsPlaceholder: row.price_is_placeholder === true,
      priceType: (row.price_type ?? 'fixed') as 'fixed' | 'range',
      minPrice: Number(row.min_price ?? row.default_price) || 0,
      maxPrice: Number(row.max_price ?? row.default_price) || 0,
      priceVersion: Number(row.price_version) || 1,
      masterPercent:
        row.master_percent !== null && row.master_percent !== undefined ? parseFloat(row.master_percent) : null,
      masterPayMode: (row.master_pay_mode ?? 'percent') as 'percent' | 'fixed',
      masterFixedAmount: row.master_fixed_amount == null ? null : Number(row.master_fixed_amount),
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

  /** Includes explicit empty folders and every ancestor of existing slash categories. */
  async getFolders(tenantID: string, db: Pool | PoolClient = this.pool) {
    const { rows } = await db.query<{ path: string }>(
      `SELECT path FROM service_folders WHERE tenant_id=$1
       UNION SELECT category AS path FROM services WHERE tenant_id=$1 AND category IS NOT NULL`,
      [tenantID],
    );
    const paths = new Set<string>();
    for (const row of rows) {
      const parts = row.path
        .trim()
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean);
      for (let n = 1; n <= parts.length; n++) paths.add(parts.slice(0, n).join('/'));
    }
    return [...paths]
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .map((path) => ({
        path,
        name: path.split('/').pop() ?? path,
        parentPath: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null,
      }));
  }

  async createFolder(tenantID: string, rawPath: unknown) {
    if (typeof rawPath !== 'string') throw new BadRequestException({ message: 'Укажите название папки' });
    const path = this.normalizeCategoryPath(rawPath);
    const parts = path.split('/');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockCatalogWrites(client, tenantID);
      const existing = await client.query('SELECT 1 FROM service_folders WHERE tenant_id=$1 AND path=$2', [
        tenantID,
        path,
      ]);
      const folders = await this.getFolders(tenantID, client);
      if (existing.rows.length || folders.some((folder) => folder.path === path))
        throw new ConflictException({ message: 'Папка уже существует' });
      for (let n = 1; n <= parts.length; n++)
        await client.query('INSERT INTO service_folders (tenant_id, path) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
          tenantID,
          parts.slice(0, n).join('/'),
        ]);
      await client.query('COMMIT');
      return {
        path,
        name: parts[parts.length - 1] ?? path,
        parentPath: parts.length > 1 ? parts.slice(0, -1).join('/') : null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Rename keeps all service IDs/prices and moves role preferences with the subtree. */
  async renameFolder(tenantID: string, rawPath: unknown, rawName: unknown, rawParent?: unknown) {
    if (typeof rawPath !== 'string' || typeof rawName !== 'string' || rawName.includes('/'))
      throw new BadRequestException({ message: 'Укажите название папки без /' });
    const path = this.normalizeCategoryPath(rawPath);
    const name = this.normalizeCategoryPath(rawName);
    const parent =
      rawParent === undefined
        ? path.includes('/')
          ? path.slice(0, path.lastIndexOf('/'))
          : ''
        : rawParent === '' || rawParent === null
          ? ''
          : this.normalizeCategoryPath(rawParent);
    const target = this.normalizeCategoryPath(parent ? `${parent}/${name}` : name);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockCatalogWrites(client, tenantID);
      const folders = await this.getFolders(tenantID, client);
      if (!folders.some((folder) => folder.path === path)) throw new NotFoundException({ message: 'Папка не найдена' });
      if (parent === path || parent.startsWith(path + '/'))
        throw new BadRequestException({ message: 'Нельзя переместить папку внутрь её подпапки' });
      if (parent && !folders.some((folder) => folder.path === parent))
        throw new NotFoundException({ message: 'Родительская папка не найдена' });
      if (target !== path && folders.some((folder) => folder.path === target))
        throw new ConflictException({ message: 'Папка уже существует' });
      if (target !== path) {
        for (const folder of folders.filter((folder) => folder.path === path || folder.path.startsWith(path + '/'))) {
          await client.query('INSERT INTO service_folders (tenant_id,path) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
            tenantID,
            target + folder.path.slice(path.length),
          ]);
        }
        for (const [table, field] of [
          ['services', 'category'],
          ['service_visibility_rules', 'category_path'],
        ] as const) {
          const canonical = `regexp_replace(regexp_replace(regexp_replace(btrim(${field}), '\\s*/\\s*', '/', 'g'), '/+', '/', 'g'), '^/|/$', '', 'g')`;
          await client.query(
            `UPDATE ${table} SET ${field}=$3 || substring(${canonical} from length($2)+1)
            WHERE tenant_id=$1 AND (${canonical}=$2 OR left(${canonical},length($2)+1)=$2 || '/')`,
            [tenantID, path, target],
          );
        }
        await client.query(
          "DELETE FROM service_folders WHERE tenant_id=$1 AND (path=$2 OR left(path,length($2)+1)=$2 || '/')",
          [tenantID, path],
        );
      }
      await client.query('COMMIT');
      return { path: target, name, parentPath: parent || null };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Removing a folder moves its services to the parent; never deletes work/prices. */
  async removeFolder(tenantID: string, rawPath: unknown) {
    if (typeof rawPath !== 'string') throw new BadRequestException({ message: 'Укажите папку' });
    const path = this.normalizeCategoryPath(rawPath);
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockCatalogWrites(client, tenantID);
      const folders = await this.getFolders(tenantID, client);
      if (!folders.some((folder) => folder.path === path)) throw new NotFoundException({ message: 'Папка не найдена' });
      const canonical = `regexp_replace(regexp_replace(regexp_replace(btrim(category), '\\s*/\\s*', '/', 'g'), '/+', '/', 'g'), '^/|/$', '', 'g')`;
      await client.query(
        `UPDATE services SET category=$3 WHERE tenant_id=$1 AND (${canonical}=$2 OR left(${canonical},length($2)+1)=$2 || '/')`,
        [tenantID, path, parent],
      );
      await client.query(
        "DELETE FROM service_visibility_rules WHERE tenant_id=$1 AND (category_path=$2 OR left(category_path,length($2)+1)=$2 || '/')",
        [tenantID, path],
      );
      await client.query(
        "DELETE FROM service_folders WHERE tenant_id=$1 AND (path=$2 OR left(path,length($2)+1)=$2 || '/')",
        [tenantID, path],
      );
      await client.query('COMMIT');
      return { message: 'Услуги перемещены в родительскую папку' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getExecutionHistory(id: string, tenantID: string, actor: JwtPayload, query: ServiceListQuery) {
    await this.getById(id, tenantID);
    const page = Math.max(1, Number.parseInt(String(query.page ?? 1), 10) || 1);
    const limit = capLimit(query.limit, 30, 100);
    const params: unknown[] = [tenantID, id];
    let journal = 'FALSE';
    if (userHasPermission(actor, 'checks_view')) {
      if (userHasPermission(actor, 'checks_view_all')) journal = 'TRUE';
      else {
        params.push(actor.userID);
        const userParam = `$${params.length}`;
        journal = `(ch.master_id=${userParam} OR EXISTS(SELECT 1 FROM check_service_lines ownline WHERE ownline.check_id=ch.id AND ownline.master_id=${userParam})
          OR EXISTS(SELECT 1 FROM check_assignees assigned WHERE assigned.check_id=ch.id AND assigned.user_id=${userParam}))`;
      }
    }
    let clientHistory = 'FALSE';
    if (userHasPermission(actor, 'clients_view')) {
      const viewerPoint = await this.clients.separatePointFor(tenantID, actorPointId(actor));
      const clientWhere = this.clients.separatePointWhere('c', viewerPoint, params);
      clientHistory = `EXISTS(SELECT 1 FROM clients c WHERE c.id=ch.client_id AND c.tenant_id=$1${clientWhere})`;
    }
    const from = `FROM check_service_lines line JOIN checks ch ON ch.id=line.check_id AND ch.tenant_id=$1
      LEFT JOIN users executor ON executor.id=line.master_id AND executor.tenant_id=$1
      WHERE line.service_id=$2 AND ch.deleted_at IS NULL AND ch.is_deferred=false AND (${journal} OR ${clientHistory})`;
    const count = await this.pool.query(`SELECT COUNT(*) AS total ${from}`, params);
    const values = [...params, limit, (page - 1) * limit];
    const { rows } = await this.pool.query(
      `SELECT line.id,ch.id AS check_id,ch.number,CASE WHEN ${clientHistory} THEN ch.client_id ELSE NULL END AS client_id,ch.date,line.price,executor.full_name AS executor_name
      ${from} ORDER BY ch.date DESC,ch.id DESC,line.id LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      data: rows.map((row) => ({
        id: row.id,
        checkId: row.check_id,
        checkNumber: Number(row.number),
        clientId: row.client_id,
        date: row.date,
        price: Number(row.price),
        executorName: row.executor_name ?? null,
      })),
      total: Number(count.rows[0].total),
      page,
      limit,
    };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query('SELECT * FROM services WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Услуга не найдена' });
    return this.mapService(rows[0]);
  }

  async create(tenantID: string, dto: ServiceWriteInput, actorId?: string) {
    const price = normalizeServicePrice(dto);
    const pay = normalizeServicePay(dto);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockCatalogWrites(client, tenantID);
      await client.query("SELECT set_config('app.service_price_actor', $1, true)", [actorId ?? '']);
      const { rows } = await client.query(
        `INSERT INTO services (name, category, default_price, master_percent, warranty_days, tenant_id,
                               price_type, min_price, max_price, master_pay_mode, master_fixed_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
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
          pay.masterPayMode,
          pay.masterFixedAmount,
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
      await this.lockCatalogWrites(client, tenantID);
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
        set('price_is_placeholder', false);
      }
      if (dto.masterPayMode !== undefined || dto.masterFixedAmount !== undefined) {
        const pay = normalizeServicePay(dto, prior);
        set('master_pay_mode', pay.masterPayMode);
        set('master_fixed_amount', pay.masterFixedAmount);
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
      priceIsPlaceholder: row.price_is_placeholder === true,
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

  private async planServiceImport(tenantID: string, rawRows: unknown, client?: PoolClient) {
    if (!Array.isArray(rawRows) || rawRows.length < 1 || rawRows.length > 2000) {
      throw new BadRequestException({ message: 'Файл должен содержать от 1 до 2 000 строк услуг' });
    }
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
    for (const [index, rawRow] of rawRows.entries()) {
      let message: string | undefined;
      if (rawRow === null || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
        preliminary.push({
          row: { sourceRow: index + 2, name: '', priceType: 'fixed' },
          message: 'Строка импорта должна быть объектом услуги',
        });
        continue;
      }
      const input = rawRow as Record<string, unknown>;
      const suppliedSourceRow = input.sourceRow;
      const validSourceRow = Number.isInteger(suppliedSourceRow) && Number(suppliedSourceRow) >= 2;
      const row: ServiceImportRow = {
        sourceRow: validSourceRow ? Number(suppliedSourceRow) : index + 2,
        id: typeof input.id === 'string' ? input.id : undefined,
        name: typeof input.name === 'string' ? input.name : '',
        category: typeof input.category === 'string' ? input.category : undefined,
        priceType: input.priceType as ServiceImportRow['priceType'],
        defaultPrice: input.defaultPrice as number | undefined,
        minPrice: input.minPrice as number | undefined,
        maxPrice: input.maxPrice as number | undefined,
        masterPercent: input.masterPercent as number | null | undefined,
        masterPayMode: input.masterPayMode as ServiceImportRow['masterPayMode'],
        masterFixedAmount: input.masterFixedAmount as number | null | undefined,
        warrantyDays: input.warrantyDays as number | null | undefined,
      };
      let service: (typeof existing)[number] | undefined;
      let normalizedPrice: ReturnType<typeof normalizeServicePrice> | undefined;
      let normalizedCategory = row.category;
      if (!validSourceRow) {
        message = 'Некорректный номер исходной строки';
      } else if (input.id != null && typeof input.id !== 'string') {
        message = 'ID услуги должен быть строкой';
      } else if (!row.name.trim() || row.name.length > 256) {
        message = 'Укажите название услуги';
      } else if (input.category !== undefined && typeof input.category !== 'string') {
        message = 'Путь категории должен быть строкой';
      } else if (row.category !== undefined && row.category.length > 256) {
        message = 'Путь категории слишком длинный';
      } else if (row.priceType !== 'fixed' && row.priceType !== 'range') {
        message = 'Укажите тип цены: фиксированная или диапазон';
      } else if (
        row.priceType === 'fixed' &&
        (input.defaultPrice === undefined || input.defaultPrice === null || input.defaultPrice === '')
      ) {
        message = 'Для фиксированной цены укажите сумму. Для нуля введите 0.';
      } else if (
        row.priceType === 'range' &&
        [input.minPrice, input.maxPrice].some((value) => value === undefined || value === null || value === '')
      ) {
        message = 'Для диапазона укажите обе границы. Для нуля введите 0.';
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
          normalizeServicePay(row, service);
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
        totalRows: rawRows.length,
        create: previewRows.filter((row) => row.action === 'create').length,
        update: previewRows.filter((row) => row.action === 'update').length,
        errors: errors.length,
      },
    };
    return { operations, preview };
  }

  async previewImport(tenantID: string, actorId: string, rows: unknown): Promise<ServiceImportPreview> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockCatalogWrites(client, tenantID);
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
      await this.lockCatalogWrites(client, tenantID);
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
        const priorPay = op.serviceId
          ? await client.query('SELECT * FROM services WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
              op.serviceId,
              tenantID,
            ])
          : undefined;
        const pay = normalizeServicePay(op, priorPay?.rows[0] ? this.mapService(priorPay.rows[0]) : undefined);
        if (op.action === 'create') {
          const masterPercent = op.masterPercent == null ? null : this.normalizeMasterPercent(op.masterPercent);
          const warrantyDays = this.normalizeWarrantyDays(op.warrantyDays);
          const result = await client.query(
            `INSERT INTO services (name, category, default_price, master_percent, warranty_days, tenant_id, price_type, min_price, max_price, master_pay_mode, master_fixed_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
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
              pay.masterPayMode,
              pay.masterFixedAmount,
            ],
          );
          imported.push(this.mapService(result.rows[0]));
        } else {
          const masterPercent = op.masterPercent == null ? null : this.normalizeMasterPercent(op.masterPercent);
          const warrantyDays = this.normalizeWarrantyDays(op.warrantyDays);
          const result = await client.query(
            `UPDATE services SET name=$1, category=$2, default_price=$3, price_is_placeholder=false,
               master_percent=CASE WHEN $4::boolean THEN $5 ELSE master_percent END,
               warranty_days=CASE WHEN $6::boolean THEN $7 ELSE warranty_days END,
               price_type=$8, min_price=$9, max_price=$10, master_pay_mode=$13, master_fixed_amount=$14 WHERE id=$11 AND tenant_id=$12 RETURNING *`,
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
              pay.masterPayMode,
              pay.masterFixedAmount,
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockCatalogWrites(client, tenantID);
      await client.query('DELETE FROM services WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
      await client.query('COMMIT');
      return { message: 'Удалено' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
        `SELECT path AS category FROM service_folders WHERE tenant_id=$1 UNION SELECT DISTINCT category FROM services WHERE tenant_id=$1 AND category IS NOT NULL AND btrim(category)<>''`,
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

    const serviceId = hasService ? dto.serviceId : null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockCatalogWrites(client, tenantID);
      await this.assertVisibilityTarget(client, tenantID, serviceId, categoryPath);
      const conflictTarget = hasService
        ? '(tenant_id, service_id) WHERE service_id IS NOT NULL'
        : '(tenant_id, category_path) WHERE category_path IS NOT NULL';
      const { rows } = await client.query(
        `INSERT INTO service_visibility_rules (tenant_id, service_id, category_path, visible_role_ids)
         VALUES ($1, $2, $3, $4::uuid[])
         ON CONFLICT ${conflictTarget}
           DO UPDATE SET visible_role_ids=EXCLUDED.visible_role_ids, updated_at=now()
         RETURNING service_id, category_path, visible_role_ids`,
        [tenantID, serviceId, categoryPath, roleIds],
      );
      await client.query('COMMIT');
      return {
        serviceId: rows[0].service_id ?? null,
        categoryPath: rows[0].category_path ?? null,
        visibleRoleIds: rows[0].visible_role_ids,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Validate after the catalog lock: a stale path must not recreate a moved ACL. */
  private async assertVisibilityTarget(
    client: PoolClient,
    tenantID: string,
    serviceId: string | null | undefined,
    categoryPath: string | null,
  ) {
    if (serviceId != null) {
      const service = await client.query('SELECT id FROM services WHERE id=$1 AND tenant_id=$2', [serviceId, tenantID]);
      if (!service.rows.length) throw new NotFoundException({ message: 'Услуга не найдена' });
    } else {
      const folders = await this.getFolders(tenantID, client);
      if (!folders.some((folder) => folder.path === categoryPath)) {
        throw new NotFoundException({ message: 'Папка не найдена. Обновите каталог.' });
      }
    }
  }

  async deleteVisibilityRule(tenantID: string, target: { serviceId?: string; categoryPath?: string }) {
    const hasService = typeof target.serviceId === 'string';
    const hasCategory = typeof target.categoryPath === 'string';
    if (hasService === hasCategory) throw new BadRequestException({ message: 'Укажите один объект правила' });
    const categoryPath = hasCategory ? this.normalizeCategoryPath(target.categoryPath) : null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockCatalogWrites(client, tenantID);
      await this.assertVisibilityTarget(client, tenantID, hasService ? target.serviceId : null, categoryPath);
      await client.query(
        `DELETE FROM service_visibility_rules WHERE tenant_id=$1 AND ${hasService ? 'service_id' : 'category_path'}=$2`,
        [tenantID, hasService ? target.serviceId : categoryPath],
      );
      await client.query('COMMIT');
      return { message: 'Правило удалено; применяется наследование' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
