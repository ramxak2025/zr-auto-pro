import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface TemplateProductSource {
  templateId: string;
  productIndex: number;
  version: string;
  expectedAssemblyRevision?: number;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const isRecipeTemplateProduct = (line: Record<string, unknown>): boolean =>
  line.kind === 'kitRecipe' || line.kitRecipeId !== undefined || line.kitRecipeVersion !== undefined;
export interface TemplateKitBatch {
  assemblyId: string;
  recipeId: string;
  recipeVersion: number;
  expectedRevision: number;
  warehouseId: string;
  pointId: string | null;
  requiresRevision?: boolean;
}
export const TEMPLATE_KIT_BATCH = Symbol('server resolved template kit batch');
export function templateKitBatch(line: unknown): TemplateKitBatch | null {
  return line !== null && typeof line === 'object'
    ? ((line as { [TEMPLATE_KIT_BATCH]?: TemplateKitBatch })[TEMPLATE_KIT_BATCH] ?? null)
    : null;
}

export const isManualTemplateProduct = (line: Record<string, unknown>): boolean =>
  !isRecipeTemplateProduct(line) && (line.productId == null || line.productId === '');

/** Missing, null and empty legacy values are unknown, never an actual zero. */
export function manualTemplateProductCost(line: Record<string, unknown>): number | null {
  if (!isManualTemplateProduct(line)) return null;
  const value = line.costPrice;
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

function parseSource(value: unknown): TemplateProductSource {
  const source = record(value);
  if (
    !source ||
    typeof source.templateId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.templateId) ||
    !Number.isSafeInteger(source.productIndex) ||
    Number(source.productIndex) < 0 ||
    typeof source.version !== 'string' ||
    !/^\d{1,10}$/.test(source.version) ||
    (source.expectedAssemblyRevision !== undefined &&
      (!Number.isSafeInteger(source.expectedAssemblyRevision) || Number(source.expectedAssemblyRevision) < 1))
  ) {
    throw new BadRequestException({ message: 'Некорректная ссылка на товар шаблона' });
  }
  return {
    templateId: source.templateId.toLowerCase(),
    productIndex: Number(source.productIndex),
    version: source.version,
    ...(source.expectedAssemblyRevision !== undefined
      ? { expectedAssemblyRevision: Number(source.expectedAssemblyRevision) }
      : {}),
  };
}

/**
 * Resolve only new template inputs, inside their caller's write transaction.
 * xmin is an opaque row revision, not a hash of hidden financial data. Share
 * locks pin every source until commit; sorted IDs also support mixed templates.
 * Only resolved costs are persisted in checks/templates, never these references.
 */
export async function resolveTemplateProductSources<T>(
  client: PoolClient,
  tenantId: string,
  actorId: string | null | undefined,
  products: T[],
  pointId: string | null = null,
  forTemplate = false,
): Promise<T[]> {
  const sources = products.map((value) => {
    const line = record(value);
    if (forTemplate && line && isRecipeTemplateProduct(line)) return null;
    if (!forTemplate && line && isRecipeTemplateProduct(line) && line.sourceTemplateProduct == null)
      throw new BadRequestException('Выберите конкретную партию комплекта из шаблона');
    return line?.sourceTemplateProduct == null ? null : parseSource(line.sourceTemplateProduct);
  });
  if (!sources.some(Boolean)) return products;
  if (!actorId) throw new NotFoundException({ message: 'Шаблон не найден' });
  const ids = [...new Set(sources.flatMap((source) => (source ? [source.templateId] : [])))].sort();
  const { rows } = await client.query<{ id: string; products: unknown; version: string }>(
    `SELECT id, products, xmin::text AS version FROM check_templates
      WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND (user_id IS NULL OR user_id=$3)
      ORDER BY id FOR SHARE`,
    [tenantId, ids, actorId],
  );
  const templates = new Map(rows.map((row) => [row.id, row]));
  const resolvedSources = products.map((value, index) => {
    const source = sources[index];
    if (!source) return null;
    const template = templates.get(source.templateId);
    if (!template) throw new NotFoundException({ message: 'Шаблон не найден' });
    if (template.version !== source.version) {
      throw new ConflictException({
        code: 'TEMPLATE_CHANGED',
        message: 'Шаблон изменился. Загрузите и примените его заново.',
      });
    }
    const line = record(value)!;
    const stored = Array.isArray(template.products) ? record(template.products[source.productIndex]) : null;
    if (
      !stored ||
      (!isRecipeTemplateProduct(stored) && stored.name !== line.name) ||
      (isRecipeTemplateProduct(stored)
        ? typeof line.productId !== 'string' || !sources[index]?.expectedAssemblyRevision
        : isManualTemplateProduct(stored)
          ? !isManualTemplateProduct(line)
          : stored.productId !== line.productId)
    ) {
      throw new BadRequestException({ message: 'Строка не соответствует товару шаблона' });
    }
    return stored;
  });
  const recipeSelections = new Map<
    number,
    { productId: string; name: string; batch: TemplateKitBatch; cost: string }
  >();
  const recipeIndices = resolvedSources.flatMap((stored, index) =>
    stored && isRecipeTemplateProduct(stored) ? [index] : [],
  );
  if (recipeIndices.length) {
    const selectedIds = recipeIndices.map((index) => String(record(products[index])!.productId));
    const { rows: selected } = await client.query(
      `SELECT p.id,p.name,p.stock,p.warehouse_id,COALESCE(p.assembly_exact_cost,p.cost_price) AS cost,p.assembly_revision,a.id AS assembly_id,a.recipe_id,a.recipe_version
      FROM products p JOIN product_assemblies a ON a.id=p.assembly_id AND a.tenant_id=p.tenant_id JOIN warehouses w ON w.id=p.warehouse_id
      WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND p.deleted_at IS NULL AND p.stock>0 AND ($3::uuid IS NULL OR w.point_id=$3)`,
      [tenantId, selectedIds, pointId],
    );
    for (const index of recipeIndices) {
      const stored = resolvedSources[index]!,
        line = record(products[index])!,
        row = selected.find((item) => item.id === line.productId);
      if (
        !row ||
        row.recipe_id !== stored.kitRecipeId ||
        row.recipe_version !== stored.kitRecipeVersion ||
        row.assembly_revision !== sources[index]!.expectedAssemblyRevision
      )
        throw new ConflictException({
          code: 'TEMPLATE_KIT_BATCH_CHANGED',
          message: 'Партия комплекта изменилась. Выберите доступную партию заново',
        });
      recipeSelections.set(index, {
        productId: row.id,
        name: row.name,
        cost: row.cost,
        batch: {
          assemblyId: row.assembly_id,
          recipeId: row.recipe_id,
          recipeVersion: row.recipe_version,
          expectedRevision: row.assembly_revision,
          warehouseId: row.warehouse_id,
          pointId,
        },
      });
    }
  }
  const productIds = [
    ...new Set(
      resolvedSources.flatMap((stored) =>
        stored &&
        !isManualTemplateProduct(stored) &&
        typeof stored.productId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored.productId)
          ? [stored.productId.toLowerCase()]
          : [],
      ),
    ),
  ];
  const catalog = productIds.length
    ? (
        await client.query<{ id: string; cost_price: string | null; cost_price_is_placeholder?: boolean }>(
          `SELECT p.id, COALESCE(p.assembly_exact_cost,p.cost_price) AS cost_price, p.cost_price_is_placeholder FROM products p WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[])
       AND p.deleted_at IS NULL AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM warehouses w WHERE w.id=p.warehouse_id AND w.point_id=$3::uuid))`,
          [tenantId, productIds, pointId],
        )
      ).rows
    : [];
  const catalogCosts = new Map(
    catalog.map((product) => [product.id, product.cost_price_is_placeholder ? null : product.cost_price]),
  );
  return products.map((value, index) => {
    const stored = resolvedSources[index];
    if (!stored) return value;
    const line = record(value)!;
    const selected = recipeSelections.get(index);
    if (selected) {
      const resolved: Record<string, unknown> & { [TEMPLATE_KIT_BATCH]: TemplateKitBatch } = {
        ...line,
        name: selected.name,
        costPrice: Number(selected.cost),
        [TEMPLATE_KIT_BATCH]: selected.batch,
      };
      delete resolved.sourceTemplateProduct;
      return resolved as T;
    }
    const rawCost = isManualTemplateProduct(stored)
      ? manualTemplateProductCost(stored)
      : catalogCosts.get(String(stored.productId).toLowerCase());
    const cost = rawCost == null ? null : Number(rawCost);
    if (cost === null || !Number.isFinite(cost) || cost < 0) {
      throw new ConflictException({
        code: 'TEMPLATE_PRODUCT_COST_UNKNOWN',
        message: 'Нет данных о себестоимости или товар недоступен на этом складе. Обновите и примените шаблон заново.',
      });
    }
    const resolved: Record<string, unknown> = { ...line, costPrice: cost };
    delete resolved.sourceTemplateProduct;
    return resolved as T;
  });
}

/** Only exact saved line IDs retain a batch choice. Id-less replacements remain ordinary. */
export async function restoreTemplateKitBatches<T extends { id?: string; productId?: string | null }>(
  client: PoolClient,
  tenant: string,
  checkId: string,
  lines: T[],
): Promise<T[]> {
  if (!lines.some((line) => line.id)) return lines;
  const { rows } = await client.query(
    `SELECT l.id,l.product_id,l.template_kit_batch,c.is_deferred FROM check_product_lines l
    JOIN checks c ON c.id=l.check_id AND c.tenant_id=$2 WHERE l.check_id=$1 AND jsonb_typeof(l.template_kit_batch)='object'`,
    [checkId, tenant],
  );
  return lines.map((line) => {
    if (templateKitBatch(line) || !line.id) return line;
    const saved = rows.find((row) => row.id === line.id && row.product_id === line.productId);
    return saved
      ? { ...line, [TEMPLATE_KIT_BATCH]: { ...saved.template_kit_batch, requiresRevision: saved.is_deferred === true } }
      : line;
  });
}
