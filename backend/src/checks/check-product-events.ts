import { checkKitWrite } from '../product-kits/kit-stock';
import { PoolClient } from 'pg';
import { inventoryFeatureEnabled } from '../common/inventory-features';

type LineFact = {
  name: string;
  quantity: number;
  costPrice: number;
  sellPrice: number;
  totalCost: number;
  totalSell: number;
  kitSource?: { intentId: string; sourceProductId: string };
};
interface CheckFact {
  id: string;
  tenant_id: string;
  point_id: string | null;
  number: number;
  date: Date;
  is_deferred: boolean;
  product_history_version: number;
  master_id: string | null;
  payment_received_by: string | null;
}
interface ProductFact {
  id: string;
  name: string;
  unit: string;
  stock: string;
  warehouse_id: string | null;
  category: string | null;
  storage_cell_id: string | null;
}
interface HistoryCapture {
  check: CheckFact;
  before: Map<string, ProductFact>;
  beforeLines: Map<string, LineFact[]>;
  actorId: string | null;
  kind: 'sale' | 'sale_correction' | 'sale_annulment' | 'sale_restore';
  visible: string[];
}

async function lineFacts(client: PoolClient, checkId: string): Promise<Map<string, LineFact[]>> {
  const { rows } = await client.query(
    `SELECT product_id,name,quantity,cost_price,sell_price,total_cost,total_sell,kit_source
    FROM check_product_lines WHERE check_id=$1 AND product_id IS NOT NULL
    ORDER BY product_id,name,quantity,cost_price,sell_price,total_cost,total_sell`,
    [checkId],
  );
  const result = new Map<string, LineFact[]>();
  for (const row of rows) {
    const lines = result.get(row.product_id) ?? [];
    lines.push({
      name: row.name,
      quantity: Number(row.quantity),
      costPrice: Number(row.cost_price),
      sellPrice: Number(row.sell_price),
      totalCost: Number(row.total_cost),
      totalSell: Number(row.total_sell),
      ...(row.kit_source ? { kitSource: row.kit_source } : {}),
    });
    result.set(row.product_id, lines);
  }
  return result;
}

async function visibility(client: PoolClient, checkId: string): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT user_id FROM (
    SELECT master_id AS user_id FROM checks WHERE id=$1 UNION
    SELECT master_id FROM check_service_lines WHERE check_id=$1 UNION
    SELECT user_id FROM check_assignees WHERE check_id=$1) people WHERE user_id IS NOT NULL ORDER BY user_id`,
    [checkId],
  );
  return rows.map((row) => row.user_id);
}

async function insertEvent(
  client: PoolClient,
  capture: HistoryCapture,
  product: ProductFact,
  revision: number,
  kind: string,
  beforeLines: LineFact[],
  afterLines: LineFact[],
  delta: number | null,
  before: number | null,
  after: number | null,
  legacy = false,
) {
  const check = capture.check;
  await client.query(
    `INSERT INTO check_product_events(tenant_id,point_id,check_id,check_number,revision,product_id,product_name,unit,
    kind,quantity,stock_delta,stock_before,stock_after,warehouse_id,category,storage_cell_id,actor_id,visible_user_ids,before_lines,after_lines,occurred_at,document_date,source_product_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      CASE WHEN $21 THEN $22::timestamptz ELSE clock_timestamp() END,$22,$23)`,
    [
      check.tenant_id,
      check.point_id,
      check.id,
      check.number,
      revision,
      product.id,
      legacy ? (afterLines[0]?.name ?? product.name) : product.name,
      legacy ? null : product.unit,
      kind,
      legacy ? afterLines.reduce((sum, line) => sum + line.quantity, 0) : Math.abs(delta ?? 0),
      delta,
      before,
      after,
      legacy ? null : product.warehouse_id,
      legacy ? null : product.category,
      legacy ? null : product.storage_cell_id,
      capture.actorId,
      capture.visible,
      JSON.stringify(beforeLines),
      JSON.stringify(afterLines),
      legacy,
      check.date,
      afterLines.find((line) => line.kitSource)?.kitSource?.sourceProductId ??
        beforeLines.find((line) => line.kitSource)?.kitSource?.sourceProductId ??
        null,
    ],
  );
}

/** Call under the check row lock, before any stock or destructive line mutation.
 * Locks OLD union NEW product IDs in the same global order as all stock writers.
 */
export async function captureCheckProductHistory(
  client: PoolClient,
  tenantId: string,
  checkId: string,
  kind: HistoryCapture['kind'],
  actorId: string | null = null,
  newProductIds: string[] = [],
  newCheck = false,
): Promise<HistoryCapture | null> {
  const { rows } = await client.query('SELECT * FROM checks WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
    checkId,
    tenantId,
  ]);
  if (!rows.length) return null;
  const check = rows[0] as CheckFact;
  if (!check.product_history_version && !inventoryFeatureEnabled(tenantId)) return null;
  await checkKitWrite(client);
  const facts = await lineFacts(client, checkId);
  const ids = [...new Set([...facts.keys(), ...newProductIds])].sort();
  const products = ids.length
    ? ((
        await client.query(
          'SELECT id,name,unit,stock,warehouse_id,category,storage_cell_id FROM products WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
          [tenantId, ids],
        )
      ).rows as ProductFact[])
    : [];
  const capture: HistoryCapture = {
    check,
    before: new Map(products.map((product) => [product.id, product])),
    beforeLines: facts,
    actorId: actorId ?? check.payment_received_by ?? check.master_id,
    kind,
    visible: await visibility(client, checkId),
  };
  if (!check.product_history_version) {
    // Only persisted, already-active legacy documents get a baseline. Its stock
    // balances/delta are unknown; it never mutates inventory or claims a new sale.
    if (!newCheck && !check.is_deferred)
      await client.query('INSERT INTO stock_history_changes(tenant_id) VALUES($1)', [tenantId]);
    if (!newCheck && !check.is_deferred)
      for (const product of products) {
        const lines = facts.get(product.id) ?? [];
        if (lines.length)
          await insertEvent(client, capture, product, 1, 'legacy_baseline', [], lines, null, null, null, true);
      }
    await client.query('UPDATE checks SET product_history_version=1 WHERE id=$1 AND tenant_id=$2', [checkId, tenantId]);
    check.product_history_version = 1;
  }
  return capture;
}

/** Records successful net stock changes only; never performs a stock mutation. */
export async function finishCheckProductHistory(client: PoolClient, capture: HistoryCapture | null) {
  if (!capture) return;
  const { check } = capture;
  const afterLines = await lineFacts(client, check.id);
  const products = (
    await client.query(
      'SELECT id,name,unit,stock,warehouse_id,category,storage_cell_id FROM products WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
      [check.tenant_id, [...capture.before.keys()]],
    )
  ).rows as ProductFact[];
  const revision = check.product_history_version + 1;
  let changed = false;
  for (const product of products) {
    const original = capture.before.get(product.id)!;
    const before = Number(original.stock),
      after = Number(product.stock),
      delta = Math.round((after - before) * 1000) / 1000;
    const oldLines = capture.beforeLines.get(product.id) ?? [],
      newLines = afterLines.get(product.id) ?? [];
    // Echo saves may rewrite identities; the comparable facts deliberately omit IDs.
    if (delta === 0 && (capture.kind !== 'sale_correction' || JSON.stringify(oldLines) === JSON.stringify(newLines)))
      continue;
    await insertEvent(client, capture, original, revision, capture.kind, oldLines, newLines, delta, before, after);
    changed = true;
  }
  if (changed)
    await client.query('UPDATE checks SET product_history_version=$3 WHERE id=$1 AND tenant_id=$2', [
      check.id,
      check.tenant_id,
      revision,
    ]);
}
