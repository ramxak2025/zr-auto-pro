import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface TemplateProductSource {
  templateId: string;
  productIndex: number;
  version: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const isManualTemplateProduct = (line: Record<string, unknown>): boolean =>
  line.productId == null || line.productId === '';

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
    !/^\d{1,10}$/.test(source.version)
  ) {
    throw new BadRequestException({ message: 'Некорректная ссылка на товар шаблона' });
  }
  return {
    templateId: source.templateId.toLowerCase(),
    productIndex: Number(source.productIndex),
    version: source.version,
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
): Promise<T[]> {
  const sources = products.map((value) => {
    const line = record(value);
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
      stored.name !== line.name ||
      (isManualTemplateProduct(stored) ? !isManualTemplateProduct(line) : stored.productId !== line.productId)
    ) {
      throw new BadRequestException({ message: 'Строка не соответствует товару шаблона' });
    }
    return stored;
  });
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
          `SELECT p.id, p.cost_price, p.cost_price_is_placeholder FROM products p WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[])
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
