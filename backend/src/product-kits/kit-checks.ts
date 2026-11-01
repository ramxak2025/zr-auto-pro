import { restoreTemplateKitBatches } from '../check-templates/template-product-source';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { assertInventoryFeature } from '../common/inventory-features';
import {
  AssemblyComponent,
  disassembleKitTx,
  KitSourceRelease,
  KitProduct,
  assertKitPlace,
  isCapturedKitPosition,
  createCapturedKitPosition,
  kitOperationId,
} from './kit-stock';
import { positiveQuantity } from '../suppliers/procurement-money';

export interface KitSplitIntent {
  intentId: string;
  productId: string;
  expectedRevision: number;
  quantity: number;
}
export interface KitSourceReference {
  intentId: string;
  sourceProductId: string;
}
export interface KitCheckLine {
  id?: string;
  productId?: string | null;
  name?: string;
  quantity?: number;
  sellPrice?: number;
  costPrice?: number;
  kitSource?: KitSourceReference;
}
/** Unserializable server proof: no HTTP/client cost field can create this value. */
export const KIT_CAPTURED_COST = Symbol('kit captured cost');
export type ResolvedKitLine<T> = T & { [KIT_CAPTURED_COST]?: number };
interface SplitResult {
  intent: KitSplitIntent;
  assemblyId: string;
  revision: number;
  sources: KitSourceRelease[];
  operationId: string;
}

function intentsFrom(value: unknown): KitSplitIntent[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new BadRequestException('Не больше 20 намерений разборки в заказ-наряде');
  const result: KitSplitIntent[] = value.map((raw) => {
    const row = raw as Partial<KitSplitIntent> | null;
    if (
      !row ||
      !isUUID(row.intentId, '4') ||
      !isUUID(row.productId, '4') ||
      !Number.isInteger(row.expectedRevision) ||
      Number(row.expectedRevision) < 1 ||
      !Number.isInteger(row.quantity) ||
      Number(row.quantity) < 1 ||
      Number(row.quantity) > 10000
    )
      throw new BadRequestException('Проверьте идентификатор, версию и количество разборки');
    return {
      intentId: row.intentId!.toLowerCase(),
      productId: row.productId!.toLowerCase(),
      expectedRevision: row.expectedRevision!,
      quantity: row.quantity!,
    };
  });
  if (new Set(result.map((item) => item.intentId)).size !== result.length)
    throw new BadRequestException('Объедините количество одного комплекта в одно намерение разборки');
  return result;
}

/** Drafts validate intent only. Active saves convert once, in the check's own
 * transaction, BEFORE the cost guard/product locks. All assembly locks precede
 * the globally ordered union of component, kit, replacement and old sale rows.
 */
export async function prepareKitCheckProducts<T extends KitCheckLine>(
  client: PoolClient,
  tenant: string,
  point: string | null,
  actorId: string | null,
  checkId: string | null,
  rawIntents: unknown,
  rawProducts: T[],
  active: boolean,
  extraLockIds: string[] = [],
): Promise<{ products: ResolvedKitLine<T>[]; intents: KitSplitIntent[] }> {
  let products = rawProducts.map((line) => ({ ...line }));
  let saved: KitSplitIntent[] = [];
  let savedSources: Array<{ id: string; product_id: string; kit_source: KitSourceReference }> = [];
  if (checkId) {
    products = await restoreTemplateKitBatches(client, tenant, checkId, products);
    const check = (await client.query('SELECT kit_splits FROM checks WHERE id=$1 AND tenant_id=$2', [checkId, tenant]))
      .rows[0];
    saved = intentsFrom(check?.kit_splits ?? []);
    const persistedLines = (
      await client.query(
        'SELECT id,product_id,name,quantity,sell_price,kit_source FROM check_product_lines WHERE check_id=$1',
        [checkId],
      )
    ).rows;
    const priorLines = persistedLines.filter((line) => line.kit_source != null);
    savedSources = priorLines;
    if (
      rawIntents === undefined &&
      !products.some((line) => line.kitSource) &&
      products.some(
        (line) =>
          !line.kitSource &&
          !persistedLines.some(
            (previous) => previous.id === line.id && previous.product_id === (line.productId ?? null),
          ),
      ) &&
      priorLines.some(
        (previous) =>
          !products.some(
            (line) =>
              line.id === previous.id ||
              (line.kitSource?.intentId === previous.kit_source.intentId &&
                line.kitSource?.sourceProductId === previous.kit_source.sourceProductId),
          ),
      )
    )
      throw new ConflictException({
        code: 'KIT_PROVENANCE_REQUIRED',
        message:
          'Обновите приложение для изменения чека с разобранным комплектом. Сохраните исходные строки или укажите разборку явно',
      });
    products = products.map((line) => {
      if (line.kitSource) return line;
      // A new id-less ordinary replacement must never regain captured lineage
      // merely because SKU/name/quantity/price happen to match a removed line.
      if (!line.id) return line;
      const previous = priorLines.find((old) => old.id === line.id);
      if (previous && previous.product_id !== line.productId)
        throw new ConflictException({
          code: 'KIT_PROVENANCE_REQUIRED',
          message: 'Обновите строку комплекта. Замену добавьте отдельной новой строкой',
        });
      if (previous) return { ...line, kitSource: previous.kit_source as KitSourceReference };
      return line;
    });
  }
  const intents = intentsFrom(rawIntents === undefined ? saved : rawIntents);
  if (checkId) {
    const applied = await client.query(
      "SELECT response FROM kit_operations WHERE tenant_id=$1 AND check_id=$2 AND kind='split'",
      [tenant, checkId],
    );
    // Already committed conversion is a warehouse fact; removing a sale line
    // cannot erase that association or reassemble components consumed elsewhere.
    for (const row of applied.rows) {
      const intent = (row.response as SplitResult).intent;
      if (!intents.some((item) => item.intentId === intent.intentId)) intents.push(intent);
    }
  }
  if (!intents.length) {
    if (products.some((line) => line.kitSource))
      throw new BadRequestException('Не указано намерение разборки для компонента');
    return { products, intents };
  }
  assertInventoryFeature(tenant);
  for (const intent of [...intents].sort((a, b) => a.intentId.localeCompare(b.intentId))) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `kit-request:${tenant}:${intent.intentId}`,
    ]);
  }
  const priorOps = await client.query(
    'SELECT * FROM kit_operations WHERE tenant_id=$1 AND request_id=ANY($2::uuid[])',
    [tenant, intents.map((item) => item.intentId)],
  );
  const operations = new Map(priorOps.rows.map((row) => [row.request_id, row]));
  const fresh = intents.filter((intent) => !operations.has(intent.intentId));
  if (fresh.some((intent) => !products.some((line) => line.kitSource?.intentId.toLowerCase() === intent.intentId)))
    throw new BadRequestException('Намерение разборки не используется ни одной строкой компонента');
  if (new Set(fresh.map((intent) => intent.productId)).size !== fresh.length)
    throw new BadRequestException('Объедините количество одного комплекта в одно новое намерение разборки');
  const freshRows = fresh.length
    ? (
        await client.query(
          `SELECT p.id AS product_id,a.id AS assembly_id FROM products p
    JOIN product_assemblies a ON a.id=p.assembly_id AND a.tenant_id=p.tenant_id JOIN warehouses w ON w.id=p.warehouse_id
    WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND p.deleted_at IS NULL AND ($3::uuid IS NULL OR w.point_id=$3)`,
          [tenant, fresh.map((intent) => intent.productId), point],
        )
      ).rows
    : [];
  if (freshRows.length !== fresh.length)
    throw new BadRequestException('Собранный комплект не найден в текущем филиале');
  const assemblyIds = [...new Set<string>(freshRows.map((row) => row.assembly_id))].sort();
  if (assemblyIds.length)
    try {
      await client.query(
        'SELECT id FROM product_assemblies WHERE id=ANY($1::uuid[]) AND tenant_id=$2 ORDER BY id FOR UPDATE NOWAIT',
        [assemblyIds, tenant],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '55P03')
        throw new ConflictException({
          code: 'KIT_STOCK_BUSY',
          message: 'Комплект сейчас меняется. Повторите операцию',
        });
      throw error;
    }
  const components = assemblyIds.length
    ? ((
        await client.query(
          'SELECT * FROM product_assembly_components WHERE tenant_id=$1 AND assembly_id=ANY($2::uuid[]) ORDER BY assembly_id,source_product_id',
          [tenant, assemblyIds],
        )
      ).rows as Array<AssemblyComponent & { assembly_id: string }>)
    : [];
  const allSourceIds = components.map((component) => component.source_product_id);
  const candidates =
    active && fresh.length
      ? (
          await client.query(
            `SELECT id FROM products WHERE tenant_id=$1 AND
    (assembly_id=ANY($2::uuid[]) OR id=ANY($3::uuid[]) OR restored_from_source_id=ANY($3::uuid[]))`,
            [tenant, assemblyIds, allSourceIds],
          )
        ).rows
      : [];
  const allLocks = [
    ...new Set([
      ...candidates.map((row) => row.id),
      ...allSourceIds,
      ...fresh.map((intent) => intent.productId),
      ...products.flatMap((line) => (line.productId ? [line.productId] : [])),
      ...extraLockIds,
    ]),
  ].sort();
  if (active && allLocks.length)
    await client.query('SELECT id FROM products WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [
      tenant,
      allLocks,
    ]);
  const results = new Map<string, SplitResult>();
  for (const intent of intents) {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ kind: 'split', intent, point }))
      .digest('hex');
    const prior = operations.get(intent.intentId);
    if (prior) {
      if (prior.kind !== 'split' || prior.fingerprint !== fingerprint || prior.check_id !== checkId)
        throw new ConflictException({
          code: 'KIT_INTENT_CONFLICT',
          message: 'Намерение разборки уже принадлежит другому заказ-наряду или изменилось',
        });
      results.set(intent.intentId, prior.response as SplitResult);
      continue;
    }
    const row = freshRows.find((row) => row.product_id === intent.productId)!;
    if (!active) {
      const assembly = (
        await client.query('SELECT revision FROM product_assemblies WHERE id=$1 AND tenant_id=$2', [
          row.assembly_id,
          tenant,
        ])
      ).rows[0];
      if (assembly.revision !== intent.expectedRevision)
        throw new ConflictException({ code: 'KIT_REVISION_CONFLICT', message: 'Комплект изменился. Обновите состав' });
      results.set(intent.intentId, {
        intent,
        assemblyId: row.assembly_id,
        revision: assembly.revision,
        operationId: '',
        sources: components
          .filter((component) => component.assembly_id === row.assembly_id)
          .map((component) => ({
            sourceProductId: component.source_product_id,
            productId: component.source_product_id,
            quantity: Number(component.quantity) * intent.quantity,
            costPrice: Number(component.unit_cost),
          })),
      });
      continue;
    }
    const operationId = kitOperationId();
    const released = await disassembleKitTx(
      client,
      tenant,
      point,
      actorId,
      intent.productId,
      intent.expectedRevision,
      intent.quantity,
      operationId,
      allLocks,
    );
    const result: SplitResult = { ...released, intent, operationId };
    await client.query(
      "INSERT INTO kit_operations(id,tenant_id,request_id,fingerprint,kind,check_id,response,created_by) VALUES($1,$2,$3,$4,'split',$5,$6,$7)",
      [operationId, tenant, intent.intentId, fingerprint, checkId, JSON.stringify(result), actorId],
    );
    results.set(intent.intentId, result);
  }
  const sold = new Map<string, bigint>();
  const resolved = products.map((line) => {
    if (!line.kitSource) return line;
    const reference = line.kitSource;
    if (!isUUID(reference.intentId, '4') || !isUUID(reference.sourceProductId, '4'))
      throw new BadRequestException('Некорректное происхождение компонента');
    const result = results.get(reference.intentId.toLowerCase());
    const source = result?.sources.find((source) => source.sourceProductId === reference.sourceProductId.toLowerCase());
    if (!source) throw new BadRequestException('Компонент отсутствует в исходном составе комплекта');
    const key = `${reference.intentId.toLowerCase()}:${reference.sourceProductId.toLowerCase()}`;
    const quantity = (sold.get(key) ?? 0n) + positiveQuantity(line.quantity ?? 1);
    sold.set(key, quantity);
    if (quantity > positiveQuantity(source.quantity))
      throw new BadRequestException(
        'Количество компонента превышает разобранный состав. Добавьте замену отдельной строкой',
      );
    const savedPosition =
      checkId && operations.has(reference.intentId.toLowerCase())
        ? savedSources.find(
            (old) =>
              old.id === line.id &&
              old.kit_source.intentId === reference.intentId &&
              old.kit_source.sourceProductId === reference.sourceProductId,
          )
        : undefined;
    return {
      ...line,
      productId: savedPosition?.product_id ?? source.productId,
      kitSource: {
        intentId: reference.intentId.toLowerCase(),
        sourceProductId: reference.sourceProductId.toLowerCase(),
      },
      [KIT_CAPTURED_COST]: source.costPrice,
    };
  });
  return { products: resolved, intents };
}

export async function saveCheckKitIntents(
  client: PoolClient,
  tenant: string,
  checkId: string,
  intents: KitSplitIntent[],
) {
  await client.query(
    'UPDATE checks SET kit_splits=$3 WHERE id=$1 AND tenant_id=$2 AND kit_splits IS DISTINCT FROM $3::jsonb',
    [checkId, tenant, JSON.stringify(intents)],
  );
  if (!intents.length) return;
  await client.query(
    "UPDATE kit_operations SET check_id=$3 WHERE tenant_id=$1 AND request_id=ANY($2::uuid[]) AND kind='split' AND check_id IS NULL",
    [tenant, intents.map((intent) => intent.intentId), checkId],
  );
}

/** Kit-only basis resolver. A later catalog cost/location edit must not cause a
 * sale reversal to reprice remaining stock. New rows start at zero: callers
 * perform the actual reversal/restore once through the existing check logic.
 */
export async function resolveSavedKitPositions(
  client: PoolClient,
  tenant: string,
  point: string | null,
  checkId: string,
  extraLockIds: string[] = [],
) {
  const rows = (
    await client.query(
      `SELECT pl.id AS line_id,pl.product_id,ac.* FROM check_product_lines pl
    JOIN kit_operations o ON o.tenant_id=$2 AND o.request_id=(pl.kit_source->>'intentId')::uuid AND o.check_id=pl.check_id AND o.kind='split'
    JOIN product_assembly_components ac ON ac.tenant_id=$2 AND ac.assembly_id=(o.response->>'assemblyId')::uuid AND ac.source_product_id=(pl.kit_source->>'sourceProductId')::uuid
    WHERE pl.check_id=$1`,
      [checkId, tenant],
    )
  ).rows as Array<AssemblyComponent & { line_id: string; product_id: string }>;
  if (!rows.length) return;
  const ids = [...new Set([...rows.map((row) => row.product_id), ...extraLockIds])].sort();
  let products: KitProduct[];
  try {
    products = (
      await client.query(
        'SELECT * FROM products WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE NOWAIT',
        [tenant, ids],
      )
    ).rows as KitProduct[];
  } catch (error) {
    if ((error as { code?: string }).code === '55P03')
      throw new ConflictException({
        code: 'KIT_STOCK_BUSY',
        message: 'Остатки компонентов сейчас меняются. Повторите операцию',
      });
    throw error;
  }
  const created = new Map<string, KitProduct>();
  for (const component of rows) {
    await assertKitPlace(
      client,
      tenant,
      point,
      component.source_warehouse_id,
      component.source_category,
      component.source_cell_id,
    );
    const product = products.find((product) => product.id === component.product_id);
    if (isCapturedKitPosition(product, component)) continue;
    const key = JSON.stringify([
      component.source_product_id,
      component.unit_cost,
      component.source_warehouse_id,
      component.source_category,
      component.source_cell_id,
    ]);
    let destination = created.get(key);
    if (!destination) {
      destination = await createCapturedKitPosition(client, tenant, component);
      created.set(key, destination);
    }
    await client.query('UPDATE check_product_lines SET product_id=$3 WHERE id=$1 AND check_id=$2', [
      component.line_id,
      checkId,
      destination.id,
    ]);
  }
}

export function kitCanonicalProductId(line: KitCheckLine): string | null {
  return line.kitSource?.sourceProductId ?? line.productId ?? null;
}
