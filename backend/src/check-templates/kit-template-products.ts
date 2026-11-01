import { BadRequestException, ConflictException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { isRecipeTemplateProduct } from './template-product-source';
import { assertInventoryFeature } from '../common/inventory-features';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export const hasRecipeTemplateProducts = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.some((line) => {
    const item = record(line);
    return item && isRecipeTemplateProduct(item);
  });
/** Saving a physical SKU deliberately stores its reusable immutable composition. */
export async function normalizeKitTemplateProducts(
  db: PoolClient,
  tenant: string,
  point: string | null,
  lines: unknown[],
  capable: boolean,
) {
  if (!Array.isArray(lines) || lines.length > 500) throw new BadRequestException('Проверьте товары шаблона');
  const ids = lines.flatMap((line) => {
    const item = record(line);
    return typeof item?.productId === 'string' && uuid.test(item.productId) ? [item.productId] : [];
  });
  const batches = ids.length
    ? (
        await db.query(
          `SELECT a.product_id,a.recipe_id,a.recipe_version FROM product_assemblies a JOIN products p ON p.id=a.product_id AND p.tenant_id=a.tenant_id
    JOIN warehouses w ON w.id=p.warehouse_id WHERE a.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND p.deleted_at IS NULL
    AND ($3::uuid IS NULL OR w.point_id=$3)`,
          [tenant, ids, point],
        )
      ).rows
    : [];
  const result = [];
  for (const value of lines) {
    const line = record(value);
    if (!line) throw new BadRequestException('Некорректная строка шаблона');
    const batch = batches.find((b) => b.product_id === line.productId);
    if (!isRecipeTemplateProduct(line) && !batch) {
      result.push(line);
      continue;
    }
    assertInventoryFeature(tenant);
    if (!capable)
      throw new ConflictException({
        code: 'TEMPLATE_KIT_CLIENT_UPDATE_REQUIRED',
        message: 'Обновите приложение для работы с шаблонами комплектов',
      });
    const recipeId = batch?.recipe_id ?? line.kitRecipeId,
      version = batch?.recipe_version ?? line.kitRecipeVersion;
    if (
      typeof recipeId !== 'string' ||
      !uuid.test(recipeId) ||
      !Number.isSafeInteger(version) ||
      Number(version) < 1 ||
      !Number.isInteger(line.quantity) ||
      Number(line.quantity) < 1 ||
      Number(line.quantity) > 10000
    )
      throw new BadRequestException('Проверьте рецепт, версию и количество комплекта');
    const found = await db.query(
      `SELECT v.name FROM kit_recipe_versions v JOIN kit_recipes r ON r.id=v.recipe_id AND r.tenant_id=v.tenant_id
      WHERE v.tenant_id=$1 AND v.recipe_id=$2 AND v.version=$3 AND ($4::uuid IS NULL OR r.point_id=$4)`,
      [tenant, recipeId, version, point],
    );
    if (!found.rows.length) throw new BadRequestException('Рецепт недоступен в текущем филиале');
    result.push({
      kind: 'kitRecipe',
      kitRecipeId: recipeId,
      kitRecipeVersion: version,
      name: typeof line.name === 'string' ? line.name : found.rows[0].name,
      quantity: Number(line.quantity),
    });
  }
  return result;
}
export async function recipeTemplateCandidates(
  db: Pool | PoolClient,
  tenant: string,
  point: string | null,
  lines: Record<string, unknown>[],
  cost: boolean,
) {
  const ids = [...new Set(lines.filter(isRecipeTemplateProduct).map((l) => String(l.kitRecipeId)))];
  if (!ids.length) return [];
  return (
    await db.query(
      `SELECT p.id AS product_id,p.name,p.stock,p.sell_price,p.warehouse_id,p.assembly_revision,a.id AS assembly_id,a.recipe_id,a.recipe_version${cost ? ',p.assembly_exact_cost' : ''}
    FROM product_assemblies a JOIN products p ON p.id=a.product_id AND p.assembly_id=a.id AND p.tenant_id=a.tenant_id
    JOIN warehouses w ON w.id=p.warehouse_id WHERE a.tenant_id=$1 AND a.recipe_id=ANY($2::uuid[]) AND p.stock>0 AND p.deleted_at IS NULL
    AND ($3::uuid IS NULL OR w.point_id=$3) ORDER BY p.id`,
      [tenant, ids, point],
    )
  ).rows;
}
