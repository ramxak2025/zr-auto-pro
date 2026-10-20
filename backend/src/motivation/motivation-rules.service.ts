import { Injectable, Inject } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { decimal, scaled } from './motivation-money';
import { archiveLegacyMotivation } from './check-motivation';
import {
  conflict,
  digest,
  effectiveRule,
  invalid,
  lockMotivation,
  mapRule,
  missing,
  normalizePath,
  readRules,
  RuleRow,
  UUID,
  withinFolder,
} from './motivation-rules';

interface Target {
  kind: 'product' | 'folder';
  productId?: string;
  categoryId?: string;
  warehouseId?: string | null;
  path?: string;
}
interface BulkInput {
  targets: Target[];
  percent: number;
  active?: boolean;
  dryRun?: boolean;
  requestId: string;
  previewRevision?: string;
  replaceLegacyPromos?: Array<{ productId: string; updatedAt: string }>;
}
interface CatalogProduct {
  id: string;
  name: string;
  category: string | null;
  warehouse_id: string | null;
  deleted_at: Date | null;
}
interface Category {
  id: string;
  path: string;
  warehouse_id: string | null;
  deleted_at: Date | null;
}
interface Legacy {
  product_id: string;
  percent: string;
  active: boolean;
  updated_at: Date;
  product_name: string;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Некорректные параметры акции');
  return value as Record<string, unknown>;
}
function percent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    invalid('Процент должен быть от 0 до 100');
  try {
    return Number(decimal(scaled(value, 2)));
  } catch {
    return invalid('Укажите процент с точностью до сотых');
  }
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid('Некорректный идентификатор');
  return value.toLowerCase();
}
function target(value: unknown): Target {
  const obj = record(value);
  if (obj.kind === 'product') return { kind: 'product', productId: uuid(obj.productId) };
  if (obj.kind !== 'folder' || typeof obj.path !== 'string' || !('warehouseId' in obj))
    invalid('Укажите папку и её склад');
  const path = normalizePath(obj.path);
  if (!path || path.length > 256) invalid('Некорректный путь папки');
  return {
    kind: 'folder',
    path,
    warehouseId: obj.warehouseId === null ? null : uuid(obj.warehouseId),
    ...(obj.categoryId === undefined ? {} : { categoryId: uuid(obj.categoryId) }),
  };
}
function targetKey(value: Target): string {
  return value.kind === 'product' ? `p:${value.productId}` : `f:${value.warehouseId}:${value.path}`;
}
function parseBulk(value: unknown): BulkInput {
  const obj = record(value);
  if (!Array.isArray(obj.targets) || !obj.targets.length || obj.targets.length > 1000)
    invalid('Выберите от 1 до 1000 товаров или папок');
  if (obj.active !== undefined && typeof obj.active !== 'boolean') invalid('Некорректная активность акции');
  if (obj.dryRun !== undefined && typeof obj.dryRun !== 'boolean') invalid('Некорректный режим просмотра');
  if (obj.previewRevision !== undefined && typeof obj.previewRevision !== 'string')
    invalid('Сначала обновите предварительный просмотр');
  const targets = Array.from(
    new Map(
      obj.targets.map((v) => {
        const t = target(v);
        return [targetKey(t), t];
      }),
    ).values(),
  ).sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
  if (
    obj.replaceLegacyPromos !== undefined &&
    (!Array.isArray(obj.replaceLegacyPromos) || obj.replaceLegacyPromos.length > 10000)
  )
    invalid('Некорректный список прежних акций');
  const replaceLegacyPromos = ((obj.replaceLegacyPromos || []) as unknown[])
    .map((v) => {
      const r = record(v);
      if (typeof r.updatedAt !== 'string' || !Number.isFinite(Date.parse(r.updatedAt)))
        invalid('Обновите список прежних акций');
      return { productId: uuid(r.productId), updatedAt: new Date(r.updatedAt).toISOString() };
    })
    .sort((a, b) => a.productId.localeCompare(b.productId));
  return {
    targets,
    percent: percent(obj.percent),
    active: obj.active as boolean | undefined,
    dryRun: obj.dryRun as boolean | undefined,
    requestId: uuid(obj.requestId),
    previewRevision: obj.previewRevision as string | undefined,
    replaceLegacyPromos,
  };
}

@Injectable()
export class MotivationRulesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async state(client: PoolClient, tenant: string) {
    const rules = await readRules(client, tenant);
    const products = (
      await client.query<CatalogProduct>(
        `SELECT id,name,category,warehouse_id,deleted_at FROM products WHERE tenant_id=$1 ORDER BY id`,
        [tenant],
      )
    ).rows;
    const categories = (
      await client.query<Category>(
        `SELECT id,path,warehouse_id,deleted_at FROM warehouse_categories WHERE tenant_id=$1 ORDER BY id`,
        [tenant],
      )
    ).rows;
    const legacy = (
      await client.query<Legacy>(
        `SELECT mp.*,p.name AS product_name FROM motivation_promo_products mp JOIN products p ON p.id=mp.product_id AND p.tenant_id=mp.tenant_id WHERE mp.tenant_id=$1 ORDER BY mp.product_id`,
        [tenant],
      )
    ).rows;
    return { rules, products, categories, legacy, revision: digest({ rules, products, categories, legacy }) };
  }

  async list(tenant: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockMotivation(client, tenant);
      const state = await this.state(client, tenant);
      // Legacy config endpoint remains the source of its full price/display metadata.
      const legacyPromos = (
        await client.query(
          `SELECT mp.*,p.name AS product_name,p.sell_price,p.cost_price,p.photo
        FROM motivation_promo_products mp JOIN products p ON p.id=mp.product_id AND p.tenant_id=mp.tenant_id WHERE mp.tenant_id=$1`,
          [tenant],
        )
      ).rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        percent: Number(r.percent),
        active: r.active,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        sellPrice: Number(r.sell_price),
        costPrice: Number(r.cost_price),
        photo: r.photo,
        estimatedBonusPerUnit: Math.max(
          0,
          Math.round(((Number(r.sell_price) - Number(r.cost_price)) * Number(r.percent)) / 100),
        ),
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      }));
      await client.query('COMMIT');
      return { rules: state.rules.map(mapRule), legacyPromos, previewRevision: state.revision };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async bulk(tenant: string, raw: unknown) {
    const input = parseBulk(raw),
      active = input.active ?? true;
    const payloadHash = digest({ ...input, dryRun: false });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockMotivation(client, tenant);
      if (!input.dryRun) {
        const receipt = (
          await client.query<{ payload_hash: string; result: Record<string, unknown> }>(
            `SELECT payload_hash,result FROM motivation_bulk_receipts WHERE tenant_id=$1 AND request_id=$2`,
            [tenant, input.requestId],
          )
        ).rows[0];
        if (receipt) {
          if (receipt.payload_hash !== payloadHash)
            conflict('MOTIVATION_REQUEST_CONFLICT', 'Этот запрос уже использован с другими параметрами');
          await client.query('COMMIT');
          return receipt.result;
        }
      }
      const state = await this.state(client, tenant);
      const selection = {
        targets: input.targets.map((t) => ({ ...t })),
        percent: input.percent,
        active,
        replaceLegacyPromos: input.replaceLegacyPromos,
      };
      const previewForState = (revision: string) => digest({ revision, selection });
      const expectedPreview = previewForState(state.revision);
      if (!input.dryRun && (!input.previewRevision || input.previewRevision !== expectedPreview)) {
        conflict(
          'MOTIVATION_PREVIEW_STALE',
          'Список товаров или правила изменились. Обновите предварительный просмотр',
        );
      }
      const projected = [...state.rules],
        selected = new Set<string>();
      const resolved: Target[] = [];
      for (const t of input.targets) {
        if (t.kind === 'product') {
          const p = state.products.find((p) => p.id === t.productId && p.deleted_at === null);
          if (!p) invalid('Товар не найден');
        } else {
          if (t.warehouseId !== null) {
            const warehouse = await client.query('SELECT 1 FROM warehouses WHERE tenant_id=$1 AND id=$2', [
              tenant,
              t.warehouseId,
            ]);
            if (!warehouse.rows.length) invalid('Склад не найден');
          }
          let category = t.categoryId
            ? state.categories.find((c) => c.id === t.categoryId)
            : state.categories.find(
                (c) => c.deleted_at === null && c.warehouse_id === t.warehouseId && normalizePath(c.path) === t.path,
              );
          if (
            category &&
            (category.deleted_at !== null ||
              category.warehouse_id !== t.warehouseId ||
              normalizePath(category.path) !== t.path)
          )
            invalid('Папка изменилась. Выберите её заново');
          if (!category) {
            const derived =
              state.products.some(
                (p) => p.deleted_at === null && p.warehouse_id === t.warehouseId && withinFolder(p.category, t.path!),
              ) ||
              state.categories.some(
                (c) => c.deleted_at === null && c.warehouse_id === t.warehouseId && withinFolder(c.path, t.path!),
              );
            if (t.categoryId || !derived) invalid('Папка не найдена');
            if (!input.dryRun) {
              category = (
                await client.query<Category>(
                  `INSERT INTO warehouse_categories(tenant_id,warehouse_id,path)
                VALUES($1,$2,$3) RETURNING id,path,warehouse_id,deleted_at`,
                  [tenant, t.warehouseId, t.path],
                )
              ).rows[0];
            }
          }
          t.categoryId = category?.id;
        }
        const existing = projected.find((r) =>
          t.kind === 'product' ? r.product_id === t.productId : !!t.categoryId && r.category_id === t.categoryId,
        );
        const id = existing?.id || `preview:${targetKey(t)}`;
        selected.add(id);
        const projectedRule: RuleRow = {
          id,
          tenant_id: tenant,
          target_kind: t.kind,
          product_id: t.productId || null,
          category_id: t.categoryId || null,
          percent: String(input.percent),
          active,
          revision: (existing?.revision || 0) + 1,
          created_at: existing?.created_at || new Date(),
          updated_at: new Date(),
          path: t.path || null,
          warehouse_id: t.warehouseId ?? null,
          folder_deleted_at: null,
          product_name: state.products.find((p) => p.id === t.productId)?.name || null,
        };
        if (existing) projected.splice(projected.indexOf(existing), 1, projectedRule);
        else projected.push(projectedRule);
        resolved.push(t);
      }
      const covered = state.products.filter(
        (p) =>
          p.deleted_at === null &&
          resolved.some((t) =>
            t.kind === 'product'
              ? p.id === t.productId
              : p.warehouse_id === t.warehouseId && withinFolder(p.category, t.path!),
          ),
      );
      const coveredIds = new Set(covered.map((p) => p.id));
      const replacing = new Set((input.replaceLegacyPromos || []).map((r) => r.productId));
      for (const replacement of input.replaceLegacyPromos || []) {
        const old = state.legacy.find((r) => r.product_id === replacement.productId);
        if (!old || !coveredIds.has(replacement.productId) || old.updated_at.toISOString() !== replacement.updatedAt) {
          conflict('MOTIVATION_LEGACY_CONFLICT', 'Прежняя акция изменилась или не входит в выбранные товары');
        }
      }
      const exceptions = state.legacy
        .filter((r) => coveredIds.has(r.product_id))
        .map((r) => ({
          productId: r.product_id,
          productName: r.product_name,
          percent: Number(r.percent),
          active: r.active,
          updatedAt: r.updated_at.toISOString(),
          replacing: replacing.has(r.product_id),
        }));
      const affectedProductCount = covered.filter((p) => {
        if (state.legacy.some((r) => r.product_id === p.id) && !replacing.has(p.id)) return false;
        const rule = effectiveRule(p, projected);
        return !!rule && selected.has(rule.id) && rule.active && Number(rule.percent) > 0;
      }).length;
      // A requested replacement must be effective, including when a deeper rule suppresses a selected parent.
      for (const id of replacing) {
        const rule = effectiveRule(covered.find((p) => p.id === id)!, projected);
        if (!rule || !selected.has(rule.id)) invalid('Для замены прежней акции выберите этот товар отдельно');
      }
      let actualRules = projected.filter((r) => selected.has(r.id) && UUID.test(r.id)).map(mapRule);
      if (!input.dryRun) {
        for (const id of replacing) {
          await archiveLegacyMotivation(client, tenant, null, id, true);
          await client.query('DELETE FROM motivation_promo_products WHERE tenant_id=$1 AND product_id=$2', [
            tenant,
            id,
          ]);
        }
        const ids: string[] = [];
        for (const t of resolved) {
          const existing = state.rules.find((r) =>
            t.kind === 'product' ? r.product_id === t.productId : r.category_id === t.categoryId,
          );
          const result = existing
            ? await client.query<{ id: string }>(
                `UPDATE motivation_rules SET percent=$3,active=$4,revision=revision+1,updated_at=clock_timestamp()
                WHERE tenant_id=$1 AND id=$2 RETURNING id`,
                [tenant, existing.id, input.percent, active],
              )
            : await client.query<{ id: string }>(
                `INSERT INTO motivation_rules(tenant_id,target_kind,product_id,category_id,percent,active)
                VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
                [tenant, t.kind, t.productId || null, t.categoryId || null, input.percent, active],
              );
          ids.push(result.rows[0].id);
        }
        actualRules = (await readRules(client, tenant)).filter((r) => ids.includes(r.id)).map(mapRule);
      }
      const result = {
        rules: actualRules,
        coveredProductCount: covered.length,
        affectedProductCount,
        legacyExceptions: exceptions,
        previewRevision: input.dryRun ? expectedPreview : previewForState((await this.state(client, tenant)).revision),
        requestId: input.requestId,
        dryRun: input.dryRun === true,
      };
      if (!input.dryRun)
        await client.query(
          `INSERT INTO motivation_bulk_receipts(tenant_id,request_id,payload_hash,result) VALUES($1,$2,$3,$4::jsonb)`,
          [tenant, input.requestId, payloadHash, JSON.stringify(result)],
        );
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async change(tenant: string, id: string, raw: unknown, remove = false) {
    uuid(id);
    const body = record(raw);
    const revision = Number(body.expectedRevision);
    if (!Number.isInteger(revision) || revision < 1) invalid('Укажите версию правила');
    if (body.active !== undefined && typeof body.active !== 'boolean') invalid('Некорректная активность акции');
    const rate = body.percent === undefined ? undefined : percent(body.percent);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockMotivation(client, tenant);
      const row = (await readRules(client, tenant)).find((r) => r.id === id);
      if (!row) missing();
      if (row.revision !== revision) conflict('MOTIVATION_REVISION_CONFLICT', 'Правило изменилось. Обновите список');
      if (remove) await client.query('DELETE FROM motivation_rules WHERE tenant_id=$1 AND id=$2', [tenant, id]);
      else
        await client.query(
          `UPDATE motivation_rules SET percent=$3,active=$4,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2`,
          [tenant, id, rate ?? row.percent, body.active ?? row.active],
        );
      const result = remove
        ? { message: 'Удалено' }
        : mapRule((await readRules(client, tenant)).find((r) => r.id === id)!);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
