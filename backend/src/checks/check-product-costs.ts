import { templateKitBatch } from '../check-templates/template-product-source';
import { KIT_EXACT_UNIT_COST } from '../product-kits/kit-stock';
import { KIT_CAPTURED_COST } from '../product-kits/kit-checks';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';

interface ProductCostInput {
  productId?: string | null;
  name: string;
  sellPrice?: number;
  quantity?: number;
  [KIT_CAPTURED_COST]?: number;
  [KIT_EXACT_UNIT_COST]?: string;
}
interface SavedProductCost {
  id: string;
  product_id: string | null;
  name: string;
  sell_price: string;
  cost_price: string;
  quantity: string;
}

/**
 * Pin cost provenance until commit; retained historical rows keep their own cost.
 * Take the final stock-write lock immediately: SHARE followed by UPDATE can
 * deadlock two sales, including one waiting on create's tenant counter. Every
 * caller locks products in id order; a closed edit must first lock the union of
 * old and new products, before this helper can lock only the new subset.
 */
export async function resolveConfirmedProductCosts(
  client: PoolClient,
  tenantId: string,
  lines: readonly ProductCostInput[],
  priorCheckId: string | null,
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  lines.forEach((line, index) => {
    const captured = line[KIT_CAPTURED_COST];
    if (captured !== undefined) result.set(index, captured);
  });
  const ids = [
    ...new Set(lines.map((line) => line.productId).filter((id): id is string => typeof id === 'string' && !!id)),
  ];
  if (!ids.length) return result;
  const { rows } = await client.query<{ id: string; provisional: boolean; assembly_exact_cost: string | null }>(
    `SELECT id, COALESCE((to_jsonb(products)->>'cost_price_is_placeholder')::boolean, false) AS provisional, assembly_exact_cost
       FROM products WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [tenantId, ids],
  );
  const selected = lines.filter((line) => templateKitBatch(line)?.requiresRevision !== false && templateKitBatch(line));
  if (selected.length) {
    const batches = (
      await client.query(
        `SELECT p.id,p.assembly_id,p.assembly_revision,p.stock,p.deleted_at,p.warehouse_id,w.point_id,a.recipe_id,a.recipe_version
      FROM products p JOIN product_assemblies a ON a.id=p.assembly_id AND a.tenant_id=p.tenant_id JOIN warehouses w ON w.id=p.warehouse_id
      WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[])`,
        [tenantId, selected.map((line) => line.productId)],
      )
    ).rows;
    // A paid edit replaces this same locked check's footprint. Its persisted
    // old stock is restored later in the transaction, so credit exactly that
    // product/batch here. Drafts, returned/deleted and other checks earn no credit.
    const credits = priorCheckId
      ? (
          await client.query(
            `SELECT l.product_id,p.assembly_id,SUM(l.quantity) AS quantity
      FROM check_product_lines l JOIN checks c ON c.id=l.check_id AND c.tenant_id=$2
      JOIN products p ON p.id=l.product_id AND p.tenant_id=c.tenant_id
      WHERE l.check_id=$1 AND c.is_deferred=false AND c.deleted_at IS NULL AND COALESCE(c.is_returned,false)=false
        AND l.product_id=ANY($3::uuid[]) GROUP BY l.product_id,p.assembly_id`,
            [priorCheckId, tenantId, selected.map((line) => line.productId)],
          )
        ).rows
      : [];
    for (const line of selected) {
      const expected = templateKitBatch(line)!,
        batch = batches.find((row) => row.id === line.productId);
      const credit = Number(
        credits.find((row) => row.product_id === line.productId && row.assembly_id === expected.assemblyId)?.quantity ??
          0,
      );
      const quantity = lines
        .filter((item) => item.productId === line.productId)
        .reduce((sum, item) => sum + Number(item.quantity ?? 1), 0);
      if (
        !batch ||
        batch.deleted_at ||
        batch.assembly_id !== expected.assemblyId ||
        batch.recipe_id !== expected.recipeId ||
        batch.recipe_version !== expected.recipeVersion ||
        batch.assembly_revision !== expected.expectedRevision ||
        batch.warehouse_id !== expected.warehouseId ||
        (expected.pointId !== null && batch.point_id !== expected.pointId) ||
        Number(batch.stock) + credit < quantity
      )
        throw new ConflictException({
          code: 'TEMPLATE_KIT_BATCH_CHANGED',
          message: 'Выбранной партии комплекта недостаточно или она изменилась. Выберите партию заново',
        });
    }
  }
  lines.forEach((line, index) => {
    const exact = rows.find((row) => row.id === line.productId)?.assembly_exact_cost;
    if (exact != null) {
      line[KIT_EXACT_UNIT_COST] = exact;
      result.set(index, Number(exact));
    }
  });
  const provisional = new Set(rows.filter((row) => row.provisional).map((row) => row.id.toLowerCase()));
  if (!provisional.size) return result;
  const prior = priorCheckId
    ? (
        await client.query<SavedProductCost>(
          `SELECT pl.* FROM check_product_lines pl JOIN checks ch ON ch.id=pl.check_id AND ch.tenant_id=$2
      WHERE pl.check_id=$1 ORDER BY pl.id`,
          [priorCheckId, tenantId],
        )
      ).rows
    : [];
  const used = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const productId = typeof line.productId === 'string' ? line.productId.toLowerCase() : null;
    if (result.has(index) || !productId || !provisional.has(productId)) continue;
    const candidates = prior.filter(
      (row) =>
        !used.has(row.id) &&
        row.product_id?.toLowerCase() === productId &&
        row.name === line.name &&
        Number(row.sell_price) === Number(line.sellPrice || 0) &&
        Number(row.quantity) === (line.quantity || 1),
    );
    if (new Set(candidates.map((row) => Number(row.cost_price))).size > 1) {
      throw new ConflictException({
        code: 'PRODUCT_COST_CONFIRMATION_REQUIRED',
        message:
          'У строк товара разная закупочная цена. Подтвердите закупочную цену товара на складе перед изменением заказ-наряда.',
      });
    }
    const old = candidates[0];
    if (!old)
      throw new BadRequestException({
        code: 'PRODUCT_COST_CONFIRMATION_REQUIRED',
        message: 'Подтвердите закупочную цену товара на складе перед добавлением в заказ-наряд.',
      });
    used.add(old.id);
    result.set(index, Number(old.cost_price));
  }
  return result;
}
