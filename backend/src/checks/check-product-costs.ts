import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';

interface ProductCostInput {
  productId?: string | null;
  name: string;
  sellPrice?: number;
  quantity?: number;
}
interface SavedProductCost {
  id: string;
  product_id: string;
  name: string;
  sell_price: string;
  cost_price: string;
  quantity: string;
}

/** Provisional seed cost cannot enter financial calculations. Retained historical rows keep their own cost. */
export async function resolveConfirmedProductCosts(
  client: PoolClient,
  tenantId: string,
  lines: readonly ProductCostInput[],
  priorCheckId: string | null,
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const ids = [...new Set(lines.map((line) => line.productId).filter((id): id is string => !!id))];
  if (!ids.length) return result;
  const { rows } = await client.query<{ id: string; provisional: boolean }>(
    `SELECT id, COALESCE((to_jsonb(products)->>'cost_price_is_placeholder')::boolean, false) AS provisional
       FROM products WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`,
    [tenantId, ids],
  );
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
    if (!line.productId || !provisional.has(line.productId.toLowerCase())) continue;
    const candidates = prior.filter(
      (row) =>
        !used.has(row.id) &&
        row.product_id.toLowerCase() === line.productId?.toLowerCase() &&
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
