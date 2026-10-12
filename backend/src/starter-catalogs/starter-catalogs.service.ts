import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { STARTER_DIRECTIONS, STARTER_ENTRIES, STARTER_VERSION, StarterEntry } from './starter-manifest';

type Selection = { directionIds: string[]; parts: ('services' | 'products' | 'templates')[]; warehouseId?: string };
type Resolution = { action: 'reuse' | 'separate' | 'skip' | 'restore'; resourceId?: string };
type Candidate = { id: string; name: string; revision: string };
type Planned = StarterEntry & {
  status: 'add' | 'reuse' | 'ambiguous' | 'deleted' | 'blocked';
  selected?: boolean;
  dependencies?: string[];
  candidates: Candidate[];
  resourceId?: string;
  resourcePath?: string;
  revision?: string;
  scope: string;
};
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateStarterDirections(value: unknown): string[] {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    value.length > STARTER_DIRECTIONS.length ||
    value.some((id) => typeof id !== 'string' || !STARTER_DIRECTIONS.some((d) => d.id === id))
  ) {
    throw new BadRequestException({ message: 'Выберите направления из стартового каталога' });
  }
  return [...new Set(value as string[])].sort();
}
@Injectable()
export class StarterCatalogsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  private owner(actor: JwtPayload) {
    if (!['director', 'superadmin'].includes(actor.role))
      throw new ForbiddenException({ message: 'Установка доступна владельцу автосервиса' });
  }
  private selection(raw: unknown): Selection {
    if (!raw || typeof raw !== 'object') throw new BadRequestException({ message: 'Выберите состав набора' });
    const value = raw as Record<string, unknown>;
    const directionIds = validateStarterDirections(value.directionIds);
    if (
      !directionIds.length ||
      !Array.isArray(value.parts) ||
      !value.parts.length ||
      value.parts.some((p) => !['services', 'products', 'templates'].includes(String(p)))
    )
      throw new BadRequestException({ message: 'Выберите направления и части набора' });
    if (value.warehouseId !== undefined && (typeof value.warehouseId !== 'string' || !UUID.test(value.warehouseId)))
      throw new BadRequestException({ message: 'Выберите склад' });
    return {
      directionIds,
      parts: [...new Set(value.parts)] as Selection['parts'],
      ...(value.warehouseId ? { warehouseId: String(value.warehouseId) } : {}),
    };
  }
  private async warehouse(db: Pool | PoolClient, tenantId: string, pointId: string | null, id?: string) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM warehouses WHERE tenant_id=$1 AND kind='main' AND ($2::uuid IS NULL OR point_id=$2) ORDER BY sort_order,id`,
      [tenantId, pointId],
    );
    if (id) {
      if (!rows.some((w) => w.id === id))
        throw new BadRequestException({ message: 'Основной склад не найден в этом филиале' });
      return id;
    }
    if (rows.length !== 1) throw new BadRequestException({ message: 'Выберите основной склад для товаров' });
    return rows[0].id;
  }
  private entries(selection: Selection) {
    const chosen = STARTER_ENTRIES.filter(
      (e) =>
        e.directions.some((id) => selection.directionIds.includes(id)) &&
        (selection.parts.includes(e.kind as Selection['parts'][number]) ||
          (e.kind === 'productFolders' && selection.parts.includes('products')) ||
          (e.kind === 'serviceFolders' && selection.parts.includes('services')) ||
          (e.kind === 'templateFolders' && selection.parts.includes('templates'))),
    );
    // Linked templates need live catalog dependencies. Every dependency is visible in the preview.
    for (const template of [...chosen].filter((e) => e.kind === 'templates')) {
      for (const key of [...(template.serviceKeys ?? []), ...(template.productKeys ?? []).map((p) => p.key)]) {
        const dependency = STARTER_ENTRIES.find((e) => e.key === key)!;
        if (!chosen.some((e) => e.key === key)) chosen.push(dependency);
      }
    }
    for (const e of [...chosen].filter(
      (e) => (e.kind === 'services' || e.kind === 'products') && selection.parts.includes(e.kind),
    )) {
      const kind = e.kind === 'services' ? 'serviceFolders' : 'productFolders';
      for (const folder of STARTER_ENTRIES.filter(
        (f) => f.kind === kind && (e.category === f.name || e.category.startsWith(f.name + '/')),
      ))
        if (!chosen.some((c) => c.key === folder.key)) chosen.push(folder);
    }
    for (const t of chosen.filter((e) => e.kind === 'templates')) {
      const folder = STARTER_ENTRIES.find((e) => e.kind === 'templateFolders' && e.name === t.category);
      if (folder && !chosen.some((e) => e.key === folder.key)) chosen.push(folder);
    }
    const order = ['productFolders', 'serviceFolders', 'templateFolders', 'services', 'products', 'templates'];
    return chosen.sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) ||
        a.category.localeCompare(b.category) ||
        a.key.localeCompare(b.key),
    );
  }
  private async plan(
    db: Pool | PoolClient,
    tenantId: string,
    selection: Selection,
    warehouseId: string,
    lock = false,
  ): Promise<Planned[]> {
    const suffix = lock ? ' FOR SHARE' : '';
    const [members, products, services, templates, productFolders, serviceFolders, templateFolders] = await Promise.all(
      [
        db.query('SELECT * FROM starter_catalog_memberships WHERE tenant_id=$1' + suffix, [tenantId]),
        db.query('SELECT *, xmin::text AS revision FROM products WHERE tenant_id=$1 AND warehouse_id=$2' + suffix, [
          tenantId,
          warehouseId,
        ]),
        db.query('SELECT *, xmin::text AS revision FROM services WHERE tenant_id=$1' + suffix, [tenantId]),
        db.query(
          'SELECT *, xmin::text AS revision FROM check_templates WHERE tenant_id=$1 AND user_id IS NULL' + suffix,
          [tenantId],
        ),
        db.query(
          'SELECT *, xmin::text AS revision FROM warehouse_categories WHERE tenant_id=$1 AND warehouse_id=$2' + suffix,
          [tenantId, warehouseId],
        ),
        db.query('SELECT *, xmin::text AS revision FROM service_folders WHERE tenant_id=$1' + suffix, [tenantId]),
        db.query(
          'SELECT *, name AS path, xmin::text AS revision FROM check_template_folders WHERE tenant_id=$1 AND user_id IS NULL AND parent_id IS NULL' +
            suffix,
          [tenantId],
        ),
      ],
    );
    const plan: Planned[] = this.entries(selection).map((entry) => {
      const scope =
        entry.kind === 'products' ||
        entry.kind === 'productFolders' ||
        (entry.kind === 'templates' && (entry.productKeys ?? []).length > 0)
          ? warehouseId
          : 'tenant';
      const member = members.rows.find((m) => m.scope === scope && m.item_key === entry.key);
      const rows =
        entry.kind === 'products'
          ? products.rows
          : entry.kind === 'services'
            ? services.rows
            : entry.kind === 'templates'
              ? templates.rows
              : entry.kind === 'productFolders'
                ? productFolders.rows
                : entry.kind === 'templateFolders'
                  ? templateFolders.rows
                  : serviceFolders.rows;
      const stored = member
        ? rows.find((r) => (member.resource_id ? r.id === member.resource_id : r.path === member.resource_path))
        : undefined;
      const base = { ...entry, scope, candidates: [] as Candidate[] };
      if (member)
        return {
          ...base,
          status: stored && !stored.deleted_at ? 'reuse' : 'deleted',
          resourceId: member.resource_id ?? undefined,
          resourcePath: member.resource_path ?? undefined,
          revision: stored?.revision,
        };
      if (entry.kind === 'productFolders' || entry.kind === 'serviceFolders' || entry.kind === 'templateFolders') {
        const row = rows.find((r) => r.path === entry.name);
        return {
          ...base,
          status: row ? (row.deleted_at ? 'deleted' : 'reuse') : 'add',
          resourceId: row?.id,
          resourcePath: row?.path,
          revision: row?.revision,
        };
      }
      // A same-name recipe remains a collision even when its linked goods are
      // unavailable. The owner must choose reuse/separate/skip; hiding it here
      // could silently add a second recipe after a dependency restore.
      const live = rows.filter((row) => !row.deleted_at).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      if (entry.kind === 'products' && entry.brand && entry.article && entry.packaging) {
        // Articles are strings; no numeric coercion or loss of significant zeroes.
        const exact = live.filter(
          (r) =>
            r.brand === entry.brand &&
            r.article === entry.article &&
            r.packaging === entry.packaging &&
            r.unit === entry.unit,
        );
        if (exact.length === 1)
          return { ...base, status: 'reuse', resourceId: exact[0].id, revision: exact[0].revision };
        if (exact.length > 1)
          return {
            ...base,
            status: 'ambiguous',
            candidates: exact.map((r) => ({ id: r.id, name: r.name, revision: r.revision })),
          };
      }
      const sameName = live.filter(
        (r) => String(r.name).trim().toLocaleLowerCase('ru') === entry.name.trim().toLocaleLowerCase('ru'),
      );
      return {
        ...base,
        status: sameName.length ? 'ambiguous' : 'add',
        candidates: sameName.map((r) => ({ id: r.id, name: r.name, revision: r.revision })),
      };
    });
    for (const item of plan) {
      item.selected =
        selection.parts.includes(item.kind as Selection['parts'][number]) || item.kind.endsWith('Folders');
      if (!item.selected && item.status !== 'reuse') {
        item.status = 'blocked';
        item.note = 'Эта часть набора выключена. Включите её, чтобы добавить отсутствующую позицию.';
      }
      if (item.kind === 'templates') {
        const deps = [
          ...(item.serviceKeys ?? []),
          ...(item.productKeys ?? []).map((p) => p.key),
          'template-folder-' + item.directions[0],
        ];
        item.dependencies = deps.map((key) => plan.find((e) => e.key === key)?.name ?? key);
        const missingCatalogDependency = deps.some((key) =>
          ['blocked', 'deleted'].includes(plan.find((e) => e.key === key)?.status ?? 'blocked'),
        );
        const saved = templates.rows.find((row) => row.id === item.resourceId);
        const missingSavedDependency =
          (Array.isArray(saved?.services) ? saved.services : []).some(
            (line: Record<string, unknown>) =>
              line &&
              typeof line.serviceId === 'string' &&
              line.serviceId !== '' &&
              !services.rows.some((row) => row.id === line.serviceId),
          ) ||
          (Array.isArray(saved?.products) ? saved.products : []).some(
            (line: Record<string, unknown>) =>
              line &&
              typeof line.productId === 'string' &&
              line.productId !== '' &&
              !products.rows.some((row) => row.id === line.productId && !row.deleted_at),
          );
        if (missingCatalogDependency || missingSavedDependency) {
          // Missing dependencies never change whether the template itself exists.
          // Only a new recipe can become blocked; an owner's live/deleted recipe
          // retains its lifecycle and requires its own explicit restore decision.
          if (item.status === 'add') item.status = 'blocked';
          item.note = saved
            ? 'Установленный шаблон сохранится без изменений. Есть недоступные позиции: проверьте его связи и замените удалённые услуги вручную после восстановления.'
            : 'Для шаблона нужны указанные услуги и товары. Включите недостающую часть набора или явно восстановите удалённые позиции. Удалённый шаблон восстанавливается только отдельным выбором.';
        }
      }
    }
    return plan;
  }
  async preview(tenantId: string, actor: JwtPayload, raw: unknown) {
    this.owner(actor);
    const selection = this.selection(raw);
    const warehouseId = await this.warehouse(this.pool, tenantId, actor.currentPointId ?? null, selection.warehouseId);
    selection.warehouseId = warehouseId;
    const items = await this.plan(this.pool, tenantId, selection, warehouseId);
    const { rows } = await this.pool.query<{ id: string }>(
      'INSERT INTO starter_catalog_previews(tenant_id,actor_id,point_id,selection,snapshot) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [tenantId, actor.userID, actor.currentPointId ?? null, JSON.stringify(selection), JSON.stringify(items)],
    );
    return {
      id: rows[0].id,
      version: STARTER_VERSION,
      warehouseId,
      items: items.map(({ scope, resourceId, resourcePath, revision, serviceKeys, productKeys, ...e }) => ({
        ...e,
        candidates: e.candidates.map(({ revision, ...candidate }) => candidate),
      })),
    };
  }
  private async lock(client: PoolClient, tenantId: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('autexa.starter.catalog:' || $1,0))", [tenantId]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('autexa.services.catalog:' || $1,0))", [
      tenantId,
    ]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext('check-template-tree'),hashtext($1))", [tenantId]);
  }
  async install(tenantId: string, actor: JwtPayload, raw: unknown) {
    this.owner(actor);
    const request = raw as { previewId?: unknown; resolutions?: Record<string, Resolution> };
    if (!request || typeof request.previewId !== 'string' || !UUID.test(request.previewId))
      throw new BadRequestException({ message: 'Откройте предпросмотр набора' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lock(client, tenantId);
      const { rows } = await client.query(
        'SELECT * FROM starter_catalog_previews WHERE id=$1 AND tenant_id=$2 AND actor_id=$3 AND point_id IS NOT DISTINCT FROM $4::uuid FOR UPDATE',
        [request.previewId, tenantId, actor.userID, actor.currentPointId ?? null],
      );
      const preview = rows[0];
      if (!preview) throw new NotFoundException({ message: 'Предпросмотр не найден' });
      if (preview.completed_result) {
        if (stable(preview.completed_request) !== stable(request.resolutions ?? {}))
          throw new ConflictException({ message: 'Установка уже завершена с другим выбором' });
        await client.query('COMMIT');
        return preview.completed_result;
      }
      if (Date.now() - new Date(preview.created_at).getTime() > 60 * 60 * 1000)
        throw new ConflictException({
          code: 'STARTER_PREVIEW_EXPIRED',
          message: 'Предпросмотр устарел. Откройте его заново.',
        });
      const selection = this.selection(preview.selection);
      const warehouseId = await this.warehouse(client, tenantId, actor.currentPointId ?? null, selection.warehouseId);
      const fresh = await this.plan(client, tenantId, selection, warehouseId, true);
      if (stable(fresh) !== stable(preview.snapshot))
        throw new ConflictException({
          code: 'STARTER_PREVIEW_CHANGED',
          message: 'Каталог изменился. Обновите предпросмотр перед установкой.',
        });
      const result = await this.apply(client, tenantId, fresh, request.resolutions ?? {});
      await client.query('UPDATE starter_catalog_previews SET completed_result=$2, completed_request=$3 WHERE id=$1', [
        request.previewId,
        JSON.stringify(result),
        JSON.stringify(request.resolutions ?? {}),
      ]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async apply(client: PoolClient, tenantId: string, items: Planned[], resolutions: Record<string, Resolution>) {
    if (
      !resolutions ||
      typeof resolutions !== 'object' ||
      Array.isArray(resolutions) ||
      Object.keys(resolutions).some((key) => !items.some((e) => e.key === key))
    )
      throw new BadRequestException({ message: 'Некорректный выбор совпадений' });
    const result = { added: 0, reused: 0, skipped: 0, restored: 0 };
    const ids = new Map<string, string>();
    const unavailableFolders: { path: string; kind: StarterEntry['kind'] }[] = [];
    for (const item of items) {
      const resolution = resolutions[item.key];
      if (
        resolution &&
        (!['reuse', 'separate', 'skip', 'restore'].includes(resolution.action) ||
          (resolution.action === 'restore' && item.status !== 'deleted') ||
          (resolution.action === 'reuse' && item.status !== 'ambiguous') ||
          (resolution.action === 'separate' && item.status !== 'ambiguous'))
      )
        throw new BadRequestException({ message: 'Выбор не соответствует предпросмотру' });
      if (item.status === 'ambiguous' && !resolution)
        throw new BadRequestException({ message: 'Выберите действие для совпадающих позиций' });
      if (
        resolution?.action === 'skip' ||
        (item.status === 'deleted' && resolution?.action !== 'restore') ||
        unavailableFolders.some(
          (folder) =>
            ((folder.kind === 'productFolders' && (item.kind === 'products' || item.kind === 'productFolders')) ||
              (folder.kind === 'serviceFolders' && (item.kind === 'services' || item.kind === 'serviceFolders')) ||
              (folder.kind === 'templateFolders' && (item.kind === 'templates' || item.kind === 'templateFolders'))) &&
            (item.category === folder.path || item.category.startsWith(folder.path + '/')),
        )
      ) {
        result.skipped++;
        if (item.kind.endsWith('Folders')) unavailableFolders.push({ path: item.name, kind: item.kind });
        continue;
      }
      if (item.status === 'blocked' && item.kind !== 'templates') {
        result.skipped++;
        continue;
      }
      let resourceId = item.resourceId;
      let resourcePath = item.resourcePath;
      if (resolution?.action === 'reuse') {
        const candidate = item.candidates.find((c) => c.id === resolution.resourceId);
        if (!candidate) throw new BadRequestException({ message: 'Совпадающая позиция недоступна' });
        resourceId = candidate.id;
        result.reused++;
      } else if (item.status === 'reuse' || (item.kind === 'templates' && item.resourceId && item.revision))
        result.reused++;
      else {
        if (
          item.kind === 'templates' &&
          ((item.serviceKeys ?? []).some((key) => !ids.has(key)) ||
            (item.productKeys ?? []).some((p) => !ids.has(p.key)) ||
            !ids.has('template-folder-' + item.directions[0]))
        ) {
          result.skipped++;
          continue;
        }
        if (item.status === 'deleted' && resourceId && (item.kind === 'products' || item.kind === 'productFolders')) {
          const table = item.kind === 'products' ? 'products' : 'warehouse_categories';
          const restored = await client.query(
            `UPDATE ${table} SET deleted_at=NULL WHERE id=$1 AND tenant_id=$2 RETURNING id`,
            [resourceId, tenantId],
          );
          if (!restored.rows.length) resourceId = undefined;
        } else resourceId = undefined;
        if (!resourceId) {
          if (item.kind === 'productFolders') {
            const added = await client.query(
              'INSERT INTO warehouse_categories(tenant_id,warehouse_id,path) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',
              [tenantId, item.scope, item.name],
            );
            resourceId = added.rows[0]?.id;
            if (!resourceId) throw new ConflictException({ message: 'Папка изменена. Обновите предпросмотр.' });
            resourcePath = item.name;
          } else if (item.kind === 'serviceFolders') {
            await client.query('INSERT INTO service_folders(tenant_id,path) VALUES($1,$2) ON CONFLICT DO NOTHING', [
              tenantId,
              item.name,
            ]);
            resourcePath = item.name;
          } else if (item.kind === 'templateFolders') {
            resourceId = (
              await client.query(
                'INSERT INTO check_template_folders(tenant_id,user_id,name,parent_id) VALUES($1,NULL,$2,NULL) RETURNING id',
                [tenantId, item.name],
              )
            ).rows[0].id;
            resourcePath = item.name;
          } else if (item.kind === 'services') {
            resourceId = (
              await client.query(
                "INSERT INTO services(tenant_id,name,category,default_price,min_price,max_price,price_type,price_is_placeholder) VALUES($1,$2,$3,1,1,1,'fixed',true) RETURNING id",
                [tenantId, item.name, item.category],
              )
            ).rows[0].id;
          } else if (item.kind === 'products') {
            resourceId = (
              await client.query(
                'INSERT INTO products(tenant_id,warehouse_id,name,category,unit,brand,article,packaging,source_url,sell_price,cost_price,stock,min_stock,sell_price_is_placeholder,cost_price_is_placeholder) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,1,0,0,true,true) RETURNING id',
                [
                  tenantId,
                  item.scope,
                  item.name,
                  item.category,
                  item.unit,
                  item.brand ?? '',
                  item.article ?? '',
                  item.packaging ?? '',
                  item.sourceUrl ?? '',
                ],
              )
            ).rows[0].id;
          } else {
            const services = [];
            for (const key of item.serviceKeys ?? []) {
              const row = (
                await client.query(
                  'SELECT id,name,default_price,price_is_placeholder FROM services WHERE id=$1 AND tenant_id=$2',
                  [ids.get(key), tenantId],
                )
              ).rows[0];
              services.push({
                serviceId: row.id,
                name: row.name,
                price: Number(row.default_price),
                priceIsPlaceholder: row.price_is_placeholder,
                quantity: 1,
              });
            }
            const products = [];
            for (const p of item.productKeys ?? []) {
              const row = (
                await client.query(
                  'SELECT id,name,sell_price FROM products WHERE id=$1 AND tenant_id=$2 AND warehouse_id=$3 AND deleted_at IS NULL',
                  [ids.get(p.key), tenantId, items.find((e) => e.key === p.key)?.scope],
                )
              ).rows[0];
              if (!row) throw new ConflictException({ message: 'Товар шаблона изменён. Обновите предпросмотр.' });
              products.push({
                productId: row.id,
                name: row.name,
                sellPrice: Number(row.sell_price),
                quantity: p.quantity,
              });
            }
            resourceId = (
              await client.query(
                'INSERT INTO check_templates(tenant_id,name,services,products,user_id,folder_id) VALUES($1,$2,$3,$4,NULL,$5) RETURNING id',
                [
                  tenantId,
                  item.name,
                  JSON.stringify(services),
                  JSON.stringify(products),
                  ids.get('template-folder-' + item.directions[0]) ?? null,
                ],
              )
            ).rows[0].id;
          }
        }
        if (item.status === 'deleted') result.restored++;
        else result.added++;
      }
      if (resourceId) ids.set(item.key, resourceId);
      await client.query(
        `INSERT INTO starter_catalog_memberships(tenant_id,scope,item_key,kind,resource_id,resource_path,manifest_version) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(tenant_id,scope,item_key) DO NOTHING`,
        [tenantId, item.scope, item.key, item.kind, resourceId ?? null, resourcePath ?? null, STARTER_VERSION],
      );
      // Hard-deleted resources get a new ID only after the owner's explicit restore.
      if (item.status === 'deleted')
        await client.query(
          'UPDATE starter_catalog_memberships SET resource_id=$4,resource_path=$5 WHERE tenant_id=$1 AND scope=$2 AND item_key=$3',
          [tenantId, item.scope, item.key, resourceId ?? null, resourcePath ?? null],
        );
    }
    return result;
  }
  async installOnCreationTx(client: PoolClient, tenantId: string, directions: unknown) {
    const directionIds = validateStarterDirections(directions);
    if (!directionIds.length) return;
    const selection: Selection = { directionIds, parts: ['services', 'products', 'templates'] };
    await this.lock(client, tenantId);
    const warehouseId = await this.warehouse(client, tenantId, null);
    const items = await this.plan(client, tenantId, selection, warehouseId, true);
    return this.apply(client, tenantId, items, {});
  }
}
