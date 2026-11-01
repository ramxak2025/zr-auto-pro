import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { cents, decimal, positiveQuantity, stockUnits } from '../suppliers/procurement-money';

export interface KitProduct {
  id: string;
  name: string;
  unit: string | null;
  stock: string;
  cost_price: string;
  sell_price: string;
  warehouse_id: string | null;
  category: string | null;
  storage_cell_id: string | null;
  assembly_id: string | null;
  assembly_revision: number;
  deleted_at: Date | null;
  cost_price_is_placeholder: boolean;
  restored_from_source_id: string | null;
  photo: string | null;
  photos: string[];
  brand: string;
  article: string;
  packaging: string;
  barcode: string | null;
  warranty_days: number | null;
  supplier_id: string | null;
}
export interface AssemblyComponent {
  source_product_id: string;
  source_warehouse_id: string;
  source_category: string | null;
  source_cell_id: string | null;
  quantity: string;
  unit_cost: string;
  product_snapshot: KitProduct;
}
export interface KitSourceRelease {
  sourceProductId: string;
  productId: string;
  quantity: number;
  costPrice: number;
}
export const kitConflict = () =>
  new ConflictException({
    code: 'ASSEMBLED_KIT_OPERATION_REQUIRED',
    message: 'Остаток, себестоимость и состав собранного комплекта меняются только сборкой или разборкой',
  });

export async function kitWrite(client: PoolClient) {
  await client.query("SELECT set_config('app.kit_operation','true',true)");
}
export async function checkKitWrite(client: PoolClient) {
  await client.query("SELECT set_config('app.kit_check_stock','true',true)");
}

export async function decrementKitAwareCheckStock(
  client: PoolClient,
  sql: string,
  params: [number, string, string, string],
) {
  await checkKitWrite(client);
  const result = await client.query(`${sql} AND (assembly_id IS NULL OR stock >= $1) RETURNING id`, params);
  if (result.rowCount === 0) {
    const found = await client.query('SELECT assembly_id FROM products WHERE id=$1 AND tenant_id=$2', [
      params[1],
      params[2],
    ]);
    if (found.rows[0]?.assembly_id)
      throw new ConflictException({
        code: 'KIT_INSUFFICIENT_STOCK',
        message: 'Недостаточно собранных комплектов на складе текущего филиала',
      });
  }
}

export async function assertKitPlace(
  client: PoolClient,
  tenant: string,
  point: string | null,
  warehouse: string | null,
  category: string | null,
  cell: string | null,
) {
  const wh = await client.query(
    'SELECT id FROM warehouses WHERE id=$1 AND tenant_id=$2 AND ($3::uuid IS NULL OR point_id=$3) FOR SHARE NOWAIT',
    [warehouse, tenant, point],
  );
  if (!wh.rows.length)
    throw new ConflictException({
      code: 'KIT_SOURCE_PLACE_UNAVAILABLE',
      message: 'Исходный склад комплекта недоступен',
    });
  if (category) {
    const folder = await client.query(
      'SELECT id FROM warehouse_categories WHERE tenant_id=$1 AND warehouse_id=$2 AND path=$3 AND deleted_at IS NULL FOR SHARE NOWAIT',
      [tenant, warehouse, category],
    );
    if (!folder.rows.length)
      throw new ConflictException({
        code: 'KIT_SOURCE_PLACE_UNAVAILABLE',
        message: 'Исходная папка комплекта удалена. Восстановите её перед разборкой',
      });
  }
  if (cell) {
    const address = await client.query(
      'SELECT id FROM storage_cells WHERE id=$1 AND tenant_id=$2 AND warehouse_id=$3 FOR SHARE NOWAIT',
      [cell, tenant, warehouse],
    );
    if (!address.rows.length)
      throw new ConflictException({
        code: 'KIT_SOURCE_PLACE_UNAVAILABLE',
        message: 'Исходная ячейка комплекта удалена. Восстановите адрес перед разборкой',
      });
  }
}

export async function kitMovement(
  client: PoolClient,
  tenant: string,
  actor: string | null,
  product: KitProduct,
  type: 'kit_assembly' | 'kit_disassembly',
  delta: bigint,
  operation: string,
  assembly: string,
  sourceProductId?: string,
) {
  const before = stockUnits(product.stock),
    after = before + delta;
  stockUnits(decimal(after, 3));
  await client.query('UPDATE products SET stock=$3 WHERE id=$1 AND tenant_id=$2', [
    product.id,
    tenant,
    decimal(after, 3),
  ]);
  await client.query(
    `INSERT INTO stock_movements(tenant_id,user_id,product_id,type,quantity,stock_before,stock_after,warehouse_id,kit_operation_id,assembly_id,source_product_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      tenant,
      actor,
      product.id,
      type,
      decimal(delta < 0n ? -delta : delta, 3),
      decimal(before, 3),
      decimal(after, 3),
      product.warehouse_id,
      operation,
      assembly,
      sourceProductId ?? null,
    ],
  );
  product.stock = decimal(after, 3);
}

/** Caller holds assembly rows first, then globally sorted product locks. */
export async function disassembleKitTx(
  client: PoolClient,
  tenant: string,
  point: string | null,
  actor: string | null,
  productId: string,
  expectedRevision: number,
  quantity: number,
  operationId: string,
  extraLockIds: string[] = [],
): Promise<{ assemblyId: string; revision: number; sources: KitSourceRelease[] }> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000)
    throw new BadRequestException('Количество комплектов должно быть целым и положительным');
  const assemblyQuery = await client.query(
    `SELECT a.* FROM product_assemblies a JOIN products p ON p.assembly_id=a.id
    JOIN warehouses w ON w.id=p.warehouse_id WHERE p.id=$1 AND p.tenant_id=$2 AND a.tenant_id=$2
      AND p.deleted_at IS NULL AND ($3::uuid IS NULL OR w.point_id=$3) FOR UPDATE OF a`,
    [productId, tenant, point],
  );
  if (!assemblyQuery.rows.length) throw new NotFoundException('Собранный комплект не найден');
  const assembly = assemblyQuery.rows[0];
  if (assembly.revision !== expectedRevision)
    throw new ConflictException({ code: 'KIT_REVISION_CONFLICT', message: 'Комплект изменился. Обновите карточку' });
  if (assembly.disassembled_quantity + quantity > assembly.assembled_quantity)
    throw new ConflictException('Недостаточно собранных комплектов');
  const components = (
    await client.query(
      'SELECT * FROM product_assembly_components WHERE assembly_id=$1 AND tenant_id=$2 ORDER BY source_product_id',
      [assembly.id, tenant],
    )
  ).rows as AssemblyComponent[];
  for (const component of components)
    await assertKitPlace(
      client,
      tenant,
      point,
      component.source_warehouse_id,
      component.source_category,
      component.source_cell_id,
    );
  const sourceIds = components.map((component) => component.source_product_id);
  const candidates = (
    await client.query(
      `SELECT id FROM products WHERE tenant_id=$1 AND (assembly_id=$2 OR id=ANY($3::uuid[]) OR restored_from_source_id=ANY($3::uuid[]))`,
      [tenant, assembly.id, sourceIds],
    )
  ).rows;
  const ids = [...new Set([...sourceIds, ...candidates.map((row) => row.id), ...extraLockIds, productId])].sort();
  const products = (
    await client.query('SELECT * FROM products WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [
      tenant,
      ids,
    ])
  ).rows as KitProduct[];
  const kit = products.find((product) => product.id === productId);
  if (!kit || kit.deleted_at || stockUnits(kit.stock) < BigInt(quantity) * 1000n)
    throw new ConflictException({
      code: 'KIT_INSUFFICIENT_STOCK',
      message: 'Недостаточно собранных комплектов на складе',
    });
  await kitWrite(client);
  const destinations: Array<{ product: KitProduct; component: AssemblyComponent; units: bigint }> = [];
  for (const component of components) {
    const snapshot = component.product_snapshot;
    let destination = products.find(
      (product) =>
        !product.deleted_at &&
        !product.assembly_id &&
        (product.id === component.source_product_id ||
          product.restored_from_source_id === component.source_product_id) &&
        product.warehouse_id === component.source_warehouse_id &&
        (product.category ?? '') === (component.source_category ?? '') &&
        product.storage_cell_id === component.source_cell_id &&
        cents(product.cost_price) === cents(component.unit_cost) &&
        (product.unit || 'шт') === (snapshot.unit || 'шт'),
    );
    if (!destination) {
      // A changed/moved source is a different stock position. Recreate the captured
      // basis at the original place, without rewriting any existing stock's cost.
      const { rows } = await client.query(
        `INSERT INTO products(tenant_id,name,category,unit,cost_price,sell_price,stock,min_stock,warehouse_id,storage_cell_id,
        photo,photos,brand,article,packaging,barcode,warranty_days,restored_from_source_id,cost_price_is_placeholder,sell_price_is_placeholder)
        VALUES($1,$2,$3,$4,$5,$6,0,0,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false,false) RETURNING *`,
        [
          tenant,
          snapshot.name,
          component.source_category,
          snapshot.unit || 'шт',
          component.unit_cost,
          snapshot.sell_price,
          component.source_warehouse_id,
          component.source_cell_id,
          snapshot.photo,
          JSON.stringify(snapshot.photos ?? []),
          snapshot.brand ?? '',
          snapshot.article ?? '',
          snapshot.packaging ?? '',
          snapshot.barcode,
          snapshot.warranty_days,
          component.source_product_id,
        ],
      );
      destination = rows[0] as KitProduct;
      products.push(destination);
    }
    destinations.push({
      product: destination,
      component,
      units: positiveQuantity(component.quantity) * BigInt(quantity),
    });
  }
  await kitMovement(client, tenant, actor, kit, 'kit_disassembly', -BigInt(quantity) * 1000n, operationId, assembly.id);
  const sources: KitSourceRelease[] = [];
  for (const { product, component, units } of destinations) {
    await kitMovement(
      client,
      tenant,
      actor,
      product,
      'kit_disassembly',
      units,
      operationId,
      assembly.id,
      component.source_product_id,
    );
    sources.push({
      sourceProductId: component.source_product_id,
      productId: product.id,
      quantity: Number(decimal(units, 3)),
      costPrice: Number(component.unit_cost),
    });
  }
  const revision = assembly.revision + 1;
  await client.query(
    'UPDATE product_assemblies SET disassembled_quantity=disassembled_quantity+$3,revision=$4 WHERE id=$1 AND tenant_id=$2',
    [assembly.id, tenant, quantity, revision],
  );
  await client.query('UPDATE products SET assembly_revision=$3 WHERE assembly_id=$1 AND tenant_id=$2', [
    assembly.id,
    tenant,
    revision,
  ]);
  return { assemblyId: assembly.id, revision, sources };
}

export function kitOperationId() {
  return randomUUID();
}
