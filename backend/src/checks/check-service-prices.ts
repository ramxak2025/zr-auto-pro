import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';

interface ServiceLineInput {
  id?: string;
  serviceId?: string | null;
  masterId?: string | null;
  name: string;
  price?: number;
  quantity?: number;
  total: number;
  salaryAmount?: number;
}

interface ProductLineSnapshot {
  id: string;
  productId: string | null;
  name: string;
  sellPrice: number;
  costPrice: number;
  quantity: number;
  totalSell: number;
  totalCost: number;
}

interface PriceSnapshotRow {
  price_snapshot_status: 'catalog' | 'legacy_unknown' | 'no_catalog';
  catalog_price_type: 'fixed' | 'range' | null;
  catalog_default_price: string | number | null;
  catalog_min_price: string | number | null;
  catalog_max_price: string | number | null;
  catalog_price_version: number | null;
  price_threshold: string | number | null;
  price_changed_by: string | null;
  price_changed_at: Date | string | null;
}

export interface SavedServiceLine extends PriceSnapshotRow {
  id: string;
  service_id: string | null;
  master_id: string | null;
  name: string;
  price: string | number;
  quantity: number | null;
  total: string | number;
  salary_amount?: string | number | null;
  master_name?: string;
  matching_master_id?: string | null;
  price_changed_by_name?: string | null;
  price_excess?: string | number;
}

interface CatalogPriceRow {
  id: string;
  price_type: 'fixed' | 'range';
  default_price: string;
  min_price: string;
  max_price: string;
  price_version: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ref = (value?: string | null) => value?.toLowerCase() || null;
const money = (value: string | number | null) => (value == null ? null : Number(value));

function unknownSnapshot(status: 'legacy_unknown' | 'no_catalog'): PriceSnapshotRow {
  return {
    price_snapshot_status: status,
    catalog_price_type: null,
    catalog_default_price: null,
    catalog_min_price: null,
    catalog_max_price: null,
    catalog_price_version: null,
    price_threshold: null,
    price_changed_by: null,
    price_changed_at: null,
  };
}

function snapshot(row: SavedServiceLine): PriceSnapshotRow {
  return {
    ...unknownSnapshot('legacy_unknown'),
    price_snapshot_status: row.price_snapshot_status ?? 'legacy_unknown',
    catalog_price_type: row.catalog_price_type ?? null,
    catalog_default_price: money(row.catalog_default_price),
    catalog_min_price: money(row.catalog_min_price),
    catalog_max_price: money(row.catalog_max_price),
    catalog_price_version: row.catalog_price_version ?? null,
    price_threshold: money(row.price_threshold),
    price_changed_by: row.price_changed_by ?? null,
    price_changed_at: row.price_changed_at ?? null,
  };
}

/** Do not guess between duplicate historical lines with different provenance. */
function choose(candidates: SavedServiceLine[]): SavedServiceLine | undefined {
  if (candidates.length < 2) return candidates[0];
  if (new Set(candidates.map((row) => JSON.stringify(snapshot(row)))).size > 1) {
    throw new ConflictException({
      code: 'SERVICE_LINE_ID_REQUIRED',
      message:
        'Не удалось однозначно определить строки услуг с разной историей цен. Обновите приложение и заново откройте заказ-наряд.',
    });
  }
  return candidates[0];
}

/** Exact matches are reserved before price-only edits, independent of input order. */
export function matchServiceLineIds(lines: readonly ServiceLineInput[], prior: readonly SavedServiceLine[]) {
  const byId = new Map(prior.map((row) => [row.id, row]));
  const used = new Set<string>();
  const matches: Array<SavedServiceLine | undefined> = lines.map((line) => {
    if (line.id === undefined || line.id === null) return undefined;
    const id = typeof line.id === 'string' ? line.id.toLowerCase() : '';
    if (!UUID.test(id) || !byId.has(id)) {
      throw new BadRequestException({ message: 'Строка услуги не принадлежит этому заказ-наряду' });
    }
    if (used.has(id)) throw new BadRequestException({ message: 'Идентификатор строки услуги указан несколько раз' });
    used.add(id);
    return byId.get(id);
  });
  const sameTuple = (line: ServiceLineInput, row: SavedServiceLine) =>
    ref(line.serviceId) === ref(row.service_id) &&
    line.name === row.name &&
    ref(line.masterId) === ref(row.matching_master_id ?? row.master_id) &&
    (line.quantity || 1) === (row.quantity || 1);
  for (const exact of [true, false]) {
    for (let i = 0; i < lines.length; i++) {
      if (matches[i]) continue;
      const candidates = prior.filter(
        (row) =>
          !used.has(row.id) &&
          sameTuple(lines[i], row) &&
          (!exact || round2(Number(lines[i].price || 0)) === Number(row.price)),
      );
      const selected = choose(candidates);
      if (selected) {
        matches[i] = selected;
        used.add(selected.id);
      }
    }
  }
  // A legacy client may have changed the executor/name/quantity as well. That
  // is not proof that the old line was removed and a new line added: taking a
  // fresh snapshot here could turn an unknown historical price into an excess.
  for (let i = 0; i < lines.length; i++) {
    if (matches[i]) continue;
    const line = lines[i];
    if (
      prior.some(
        (row) =>
          !used.has(row.id) && (line.serviceId ? ref(line.serviceId) === ref(row.service_id) : line.name === row.name),
      )
    ) {
      throw new ConflictException({
        code: 'SERVICE_LINE_ID_REQUIRED',
        message:
          'Не удалось однозначно определить изменённую строку услуги. Обновите приложение и заново откройте заказ-наряд.',
      });
    }
  }
  return matches;
}

/** Caller holds the parent check lock (or has just inserted it) in this transaction. */
export async function saveCheckServiceLines(
  client: PoolClient,
  tenantId: string,
  checkId: string,
  lines: readonly ServiceLineInput[],
  actorId: string | null,
): Promise<void> {
  const { rows: prior } = await client.query<SavedServiceLine>(
    `SELECT sl.*, COALESCE(sl.master_id, ch.master_id) AS matching_master_id FROM check_service_lines sl
       JOIN checks ch ON ch.id=sl.check_id AND ch.tenant_id=$2
      WHERE sl.check_id=$1 ORDER BY sl.id FOR UPDATE OF sl`,
    [checkId, tenantId],
  );
  const matches = matchServiceLineIds(lines, prior);
  const needsCatalog = [
    ...new Set(
      lines
        .filter((line, i) => line.serviceId && (!matches[i] || ref(matches[i]?.service_id) !== ref(line.serviceId)))
        .map((line) => ref(line.serviceId) as string),
    ),
  ];
  const catalog = new Map<string, CatalogPriceRow>();
  if (needsCatalog.length) {
    // Deterministic row locks serialize the first snapshot with catalogue changes.
    const { rows } = await client.query<CatalogPriceRow>(
      `SELECT id, price_type, default_price, min_price, max_price, price_version
         FROM services WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE`,
      [tenantId, needsCatalog],
    );
    for (const row of rows) catalog.set(row.id, row);
    if (catalog.size !== needsCatalog.length) throw new BadRequestException({ message: 'Услуга не найдена' });
  }
  const now = new Date();
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const old = matches[i];
    const sameService = old && ref(old.service_id) === ref(line.serviceId);
    let saved = sameService ? snapshot(old) : unknownSnapshot('no_catalog');
    if (!sameService && line.serviceId) {
      const price = catalog.get(ref(line.serviceId) as string);
      if (!price) throw new BadRequestException({ message: 'Услуга не найдена' });
      saved = {
        ...saved,
        price_snapshot_status: 'catalog',
        catalog_price_type: price.price_type,
        catalog_default_price: price.default_price,
        catalog_min_price: price.min_price,
        catalog_max_price: price.max_price,
        catalog_price_version: price.price_version,
        price_threshold: price.price_type === 'range' ? price.max_price : price.default_price,
      };
    }
    const unitPrice = round2(Number(line.price || 0));
    // Initial price differing from the catalogue is an explicit price choice;
    // subsequent provenance changes only when the persisted unit price changes.
    const priceChanged = old
      ? unitPrice !== Number(old.price)
      : saved.price_snapshot_status === 'catalog' && unitPrice !== Number(saved.catalog_default_price);
    if (priceChanged) {
      saved.price_changed_by = actorId;
      saved.price_changed_at = now;
    } else if (old) {
      saved.price_changed_by = old.price_changed_by;
      saved.price_changed_at = old.price_changed_at;
    }
    const id = old?.id ?? randomUUID();
    kept.push(id);
    const values: unknown[] = [
      id,
      checkId,
      ref(line.serviceId),
      ref(line.masterId),
      line.name,
      unitPrice,
      line.quantity || 1,
      line.total,
      line.salaryAmount ?? 0,
      saved.price_snapshot_status,
      saved.catalog_price_type,
      saved.catalog_default_price,
      saved.catalog_min_price,
      saved.catalog_max_price,
      saved.catalog_price_version,
      saved.price_threshold,
      saved.price_changed_by ?? null,
      saved.price_changed_at ?? null,
    ];
    const columns = [
      'id',
      'check_id',
      'service_id',
      'master_id',
      'name',
      'price',
      'quantity',
      'total',
      'salary_amount',
      'price_snapshot_status',
      'catalog_price_type',
      'catalog_default_price',
      'catalog_min_price',
      'catalog_max_price',
      'catalog_price_version',
      'price_threshold',
      'price_changed_by',
      'price_changed_at',
    ];
    if (old) {
      await client.query(
        `UPDATE check_service_lines SET ${columns
          .slice(2)
          .map((column, n) => `${column}=$${n + 3}`)
          .join(', ')}
        WHERE id=$1 AND check_id=$2`,
        values,
      );
    } else {
      await client.query(
        `INSERT INTO check_service_lines (${columns.join(', ')})
        VALUES (${values.map((_, n) => `$${n + 1}`).join(', ')})`,
        values,
      );
    }
  }
  // Preserve identities referenced by returns; existing edit-return guards run
  // before this helper. There is no delete/reinsert for retained service lines.
  await client.query('DELETE FROM check_service_lines WHERE check_id=$1 AND NOT (id=ANY($2::uuid[]))', [checkId, kept]);
}

export function mapServiceLinePrice(row: SavedServiceLine) {
  return {
    priceSnapshotStatus: row.price_snapshot_status ?? 'legacy_unknown',
    catalogPriceType: row.catalog_price_type ?? null,
    catalogDefaultPrice: money(row.catalog_default_price),
    catalogMinPrice: money(row.catalog_min_price),
    catalogMaxPrice: money(row.catalog_max_price),
    catalogPriceVersion: row.catalog_price_version ?? null,
    priceThreshold: money(row.price_threshold),
    priceChangedBy: row.price_changed_by ?? null,
    priceChangedByName: row.price_changed_by_name ?? null,
    priceChangedAt: row.price_changed_at ?? null,
    priceExcess: Number(row.price_excess) || 0,
  };
}

/** PATCH omission preserves the stored rows. Called only under the parent lock. */
export async function hydrateOmittedCheckLines(
  client: PoolClient,
  tenantId: string,
  checkId: string,
  omitted: { services: boolean; products: boolean },
): Promise<{ services?: ServiceLineInput[]; products?: ProductLineSnapshot[] }> {
  const result: { services?: ServiceLineInput[]; products?: ProductLineSnapshot[] } = {};
  if (omitted.services) {
    const { rows } = await client.query<SavedServiceLine>(
      `SELECT sl.* FROM check_service_lines sl JOIN checks ch ON ch.id=sl.check_id AND ch.tenant_id=$2
        WHERE sl.check_id=$1 ORDER BY sl.id`,
      [checkId, tenantId],
    );
    result.services = rows.map((row) => ({
      id: row.id,
      serviceId: row.service_id,
      masterId: row.master_id,
      name: row.name,
      price: Number(row.price),
      quantity: row.quantity || 1,
      total: Number(row.total),
      salaryAmount: Number(row.salary_amount) || 0,
    }));
  }
  if (omitted.products) {
    const { rows } = await client.query<{
      id: string;
      product_id: string | null;
      name: string;
      sell_price: string;
      cost_price: string;
      quantity: string;
      total_sell: string;
      total_cost: string;
    }>(
      `SELECT pl.* FROM check_product_lines pl JOIN checks ch ON ch.id=pl.check_id AND ch.tenant_id=$2
        WHERE pl.check_id=$1 ORDER BY pl.id`,
      [checkId, tenantId],
    );
    result.products = rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      name: row.name,
      sellPrice: Number(row.sell_price),
      costPrice: Number(row.cost_price),
      quantity: Number(row.quantity),
      totalSell: Number(row.total_sell),
      totalCost: Number(row.total_cost),
    }));
  }
  return result;
}
