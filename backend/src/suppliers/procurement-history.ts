import { BadRequestException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { cents, decimal } from './procurement-money';

export interface PreviousPurchase {
  price: number;
  date: string;
  deliveryId: string;
  deliveryItemId: string;
  supplierId: string;
}
export interface ReceiptProduct {
  id: string;
  name: string;
  stock: string;
  warehouse_id: string | null;
  cost_price: string;
  sell_price: string;
}

export async function lockReceiptProducts(
  client: PoolClient,
  tenantID: string,
  ids: string[],
  pointId: string | null,
): Promise<ReceiptProduct[]> {
  const unique = [...new Set(ids)];
  const { rows } = await client.query<ReceiptProduct>(
    `SELECT p.id, p.name, p.stock, p.warehouse_id, p.cost_price, p.sell_price FROM products p
     WHERE p.id = ANY($1::uuid[]) AND p.tenant_id=$2 AND p.deleted_at IS NULL
       AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM warehouses w WHERE w.id=p.warehouse_id AND w.tenant_id=$2 AND w.point_id=$3))
     ORDER BY p.id FOR UPDATE OF p`,
    [unique, tenantID, pointId],
  );
  if (rows.length !== unique.length)
    throw new BadRequestException({ message: 'Товар не найден на складе этого филиала' });
  return rows;
}

/** Actual invoices only; neither product cost basis nor arbitrary price edits
 * are evidence of a purchase. A date-only cutoff is resolved by the caller. */
export async function purchaseContext(
  client: Pool | PoolClient,
  tenantID: string,
  ids: string[],
  before: string | null,
  pointId: string | null,
) {
  if (!ids.length) return [];
  const { rows } = await client.query<{ id: string; sell_price: string; previous_purchase: PreviousPurchase | null }>(
    `SELECT p.id, p.sell_price, prior.previous_purchase FROM products p
     LEFT JOIN LATERAL (
       SELECT jsonb_build_object('price', di.price, 'date', d.date, 'deliveryId', d.id,
                  'deliveryItemId', di.id, 'supplierId', d.supplier_id) AS previous_purchase
       FROM delivery_items di JOIN deliveries d ON d.id=di.delivery_id
       WHERE di.product_id=p.id AND d.tenant_id=$1 AND d.deleted_at IS NULL AND di.quantity>0
         AND d.date <= COALESCE($3::timestamptz, now())
         AND ($4::uuid IS NULL OR d.point_id=$4)
       ORDER BY d.date DESC, d.id DESC, di.id DESC LIMIT 1
     ) prior ON true
     WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND p.deleted_at IS NULL
       AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM warehouses w WHERE w.id=p.warehouse_id AND w.tenant_id=$1 AND w.point_id=$4))`,
    [tenantID, [...new Set(ids)], before, pointId],
  );
  return rows.map((r) => ({ productId: r.id, sellPrice: Number(r.sell_price), previousPurchase: r.previous_purchase }));
}

/** Explicit retail edits also work on legacy stock-only receives. Omitted fields
 * preserve prices; zero retail is valid; zero/older cost cannot erase known cost. */
export async function updateReceiptPrices(
  client: PoolClient,
  tenantID: string,
  userID: string | null,
  product: ReceiptProduct,
  purchasePrice: number | undefined,
  sellPrice: number | undefined,
  backdated: boolean,
) {
  const oldCost = cents(product.cost_price ?? 0);
  const oldSell = cents(product.sell_price ?? 0);
  const purchase = purchasePrice === undefined ? 0n : cents(purchasePrice);
  const nextCost = purchase > 0n && (!backdated || oldCost === 0n) ? purchase : oldCost;
  const nextSell = sellPrice === undefined || sellPrice === null ? oldSell : cents(sellPrice);
  if (nextCost === oldCost && nextSell === oldSell) return;
  // Cost guard is also in SQL, preserving its existing backdated contract.
  if (nextCost !== oldCost) {
    await client.query(
      backdated
        ? 'UPDATE products SET cost_price=$1 WHERE id=$2 AND tenant_id=$3 AND COALESCE(cost_price,0)=0'
        : 'UPDATE products SET cost_price=$1 WHERE id=$2 AND tenant_id=$3',
      [decimal(nextCost, 2), product.id, tenantID],
    );
  }
  if (nextSell !== oldSell)
    await client.query('UPDATE products SET sell_price=$1 WHERE id=$2 AND tenant_id=$3', [
      decimal(nextSell, 2),
      product.id,
      tenantID,
    ]);
  await client.query(
    `INSERT INTO price_history (product_id, cost_price_before, cost_price_after, sell_price_before, sell_price_after, user_id, tenant_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      product.id,
      decimal(oldCost, 2),
      decimal(nextCost, 2),
      decimal(oldSell, 2),
      decimal(nextSell, 2),
      userID,
      tenantID,
    ],
  );
  product.cost_price = decimal(nextCost, 2);
  product.sell_price = decimal(nextSell, 2);
}
