import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { userHasPermission } from '../common/guards/permissions.guard';
import { pointFilterSql } from '../common/point-scope';
import { getTenantTimezone, zonedMidnight } from '../common/timezone';

export interface StockHistoryQuery {
  warehouseId?: string;
  productId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  includeSales?: boolean | string;
  cursor?: string;
  limit?: string | number;
}

type Cursor = {
  v: 2;
  snapshot: string;
  transactionSnapshot: string;
  time: string;
  id: string;
  scope: string;
  epoch: string;
};
const staleHistory = () =>
  new ConflictException({ code: 'HISTORY_CURSOR_STALE', message: 'История изменилась. Обновите список' });
function validTransactionSnapshot(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 6000 ||
    !/^\d{1,20}:\d{1,20}:(?:\d{1,20}(?:,\d{1,20})*)?$/.test(value)
  )
    return false;
  const [low, high, list] = value.split(':');
  const xmin = BigInt(low),
    xmax = BigInt(high),
    maximum = (1n << 64n) - 1n;
  if (xmin > xmax || xmax > maximum) return false;
  const active = list ? list.split(',').map(BigInt) : [];
  return (
    active.length <= 256 &&
    active.every((id, index) => id >= xmin && id < xmax && id <= maximum && (index === 0 || active[index - 1] < id))
  );
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Date-only boundaries mean whole calendar days in the tenant timezone. */
export function stockHistoryDate(value: unknown, end: boolean, timezone: string): string | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('Некорректная дата');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
      throw new BadRequestException('Некорректная дата');
    return zonedMidnight(
      timezone,
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate() + Number(end),
    ).toISOString();
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new BadRequestException('Некорректная дата');
  }
  // Timestamp upper boundaries remain inclusive; the SQL operator is selected below.
  return value;
}

export async function loadStockHistory(
  pool: Pool,
  tenantID: string,
  query: StockHistoryQuery,
  pointId: string | null,
  actor?: JwtPayload,
) {
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(query.limit)) || 100));
  for (const key of ['productId', 'warehouseId'] as const) {
    if (query[key] !== undefined && (typeof query[key] !== 'string' || !uuid.test(query[key]!)))
      throw new BadRequestException('Некорректный фильтр товара или склада');
  }
  // This lookup is before acquiring the page client (including max-one pools).
  const timezone = await getTenantTimezone(pool, tenantID);
  const from = stockHistoryDate(query.dateFrom, false, timezone);
  const to = stockHistoryDate(query.dateTo, true, timezone);
  if (from && to && Date.parse(from) > Date.parse(to)) throw new BadRequestException('Обратный диапазон дат');
  const includeSales =
    (query.includeSales === true || query.includeSales === 'true') && userHasPermission(actor, 'checks_view');
  const scope = createHash('sha256')
    .update(
      JSON.stringify({
        tenantID,
        pointId,
        actor: actor?.userID,
        role: actor?.role,
        permissions: actor?.permissions,
        productId: query.productId,
        warehouseId: query.warehouseId,
        type: query.type,
        from,
        to,
        includeSales,
      }),
    )
    .digest('hex');
  let cursor: Cursor | null = null;
  if (query.cursor) {
    try {
      if (typeof query.cursor !== 'string' || query.cursor.length > 8192) throw new Error();
      const parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as Cursor;
      if (parsed.v !== 2) throw staleHistory();
      if (
        !validTransactionSnapshot(parsed.transactionSnapshot) ||
        typeof parsed.epoch !== 'string' ||
        !/^\d{1,20}$/.test(parsed.epoch) ||
        parsed.scope !== scope ||
        typeof parsed.id !== 'string' ||
        parsed.id.length > 100 ||
        typeof parsed.time !== 'string' ||
        parsed.time.length > 64 ||
        !Number.isFinite(Date.parse(parsed.time)) ||
        typeof parsed.snapshot !== 'string' ||
        parsed.snapshot.length > 64 ||
        !Number.isFinite(Date.parse(parsed.snapshot))
      )
        throw new Error();
      cursor = parsed;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new BadRequestException('Некорректный курсор истории');
    }
  }
  const client = await pool.connect();
  try {
    // One short page snapshot: epoch, native visibility snapshot and rows cannot
    // straddle a legacy cutover. No connection is retained between API pages.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const header = (
      await client.query(
        `SELECT clock_timestamp()::text AS snapshot,pg_current_snapshot()::text AS transaction_snapshot,
      (SELECT count(*)::text FROM stock_history_changes WHERE tenant_id=$1) AS epoch`,
        [tenantID],
      )
    ).rows[0];
    const epoch = String(header.epoch);
    if (cursor && cursor.epoch !== epoch) throw staleHistory();
    const snapshot = cursor?.snapshot ?? header.snapshot;
    const transactionSnapshot = cursor?.transactionSnapshot ?? header.transaction_snapshot;
    const params: unknown[] = [tenantID, snapshot, transactionSnapshot];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const point = pointId ? bind(pointId) : null;
    const transfer = '(sm.source_warehouse_id IS NOT NULL AND sm.target_warehouse_id IS NOT NULL)';
    const sourcePlace = 'COALESCE(sm.source_warehouse_id,sm.warehouse_id)';
    const sourceVisible = point
      ? `EXISTS(SELECT 1 FROM warehouses visible_source WHERE visible_source.id=${sourcePlace} AND visible_source.point_id=${point}::uuid)`
      : 'true';
    const targetVisible = point
      ? `EXISTS(SELECT 1 FROM warehouses visible_target WHERE visible_target.id=sm.target_warehouse_id AND visible_target.point_id=${point}::uuid)`
      : 'true';
    let sourceMatch = sourceVisible,
      targetMatch = `${transfer} AND ${targetVisible}`;
    let stockWhere = `sm.tenant_id=$1 AND sm.recorded_at<=$2::timestamptz AND (sm.recorded_xid IS NULL OR pg_visible_in_snapshot(sm.recorded_xid,$3::pg_snapshot))`;
    let saleWhere = `c.tenant_id=$1 AND c.product_history_version=0 AND c.deleted_at IS NULL AND c.is_deferred=false AND cpl.recorded_at<=$2::timestamptz
    AND (cpl.recorded_xid IS NULL OR pg_visible_in_snapshot(cpl.recorded_xid,$3::pg_snapshot))${includeSales ? pointFilterSql('c', pointId, params) : ''}`;
    let ledgerWhere = includeSales
      ? `e.tenant_id=$1 AND e.recorded_at<=$2::timestamptz AND(e.recorded_xid IS NULL OR pg_visible_in_snapshot(e.recorded_xid,$3::pg_snapshot))${pointFilterSql('e', pointId, params)}`
      : 'false';
    let productParameter: string | null = null,
      warehouseParameter: string | null = null;
    if (query.productId) {
      productParameter = bind(query.productId);
      sourceMatch += ` AND(sm.product_id=${productParameter} OR sm.source_product_id=${productParameter})`;
      targetMatch += ` AND sm.target_product_id=${productParameter}`;
      saleWhere += ` AND cpl.product_id=${productParameter}`;
      ledgerWhere += ` AND(e.product_id=${productParameter} OR e.source_product_id=${productParameter})`;
    }
    if (query.warehouseId) {
      warehouseParameter = bind(query.warehouseId);
      sourceMatch += ` AND ${sourcePlace}=${warehouseParameter}`;
      targetMatch += ` AND sm.target_warehouse_id=${warehouseParameter}`;
      saleWhere += ` AND p.warehouse_id=${warehouseParameter}`;
      ledgerWhere += ` AND e.warehouse_id=${warehouseParameter}`;
    }
    stockWhere += ` AND((${sourceMatch}) OR(${targetMatch}))`;
    const preferTarget = `${transfer} AND(${targetMatch}) AND(NOT(${sourceMatch})${productParameter ? ` OR sm.target_product_id=${productParameter}` : ''}${warehouseParameter ? ` OR sm.target_warehouse_id=${warehouseParameter}` : ''})`;
    const viewedProduct = `CASE WHEN ${preferTarget} AND sm.target_product_id IS NOT NULL THEN sm.target_product_id ELSE sm.product_id END`;
    const viewedName = `CASE WHEN ${preferTarget} AND sm.target_product_id IS NOT NULL THEN COALESCE(dst.name,p.name) ELSE p.name END`;
    const viewedBefore = `CASE WHEN ${preferTarget} THEN sm.target_stock_before ELSE sm.stock_before END`;
    const viewedAfter = `CASE WHEN ${preferTarget} THEN sm.target_stock_after ELSE sm.stock_after END`;
    const viewedWarehouse = `CASE WHEN ${preferTarget} THEN sm.target_warehouse_id WHEN ${transfer} THEN sm.source_warehouse_id ELSE sm.warehouse_id END`;
    const viewedWarehouseName = `CASE WHEN ${preferTarget} THEN tw.name WHEN ${transfer} THEN sw.name ELSE w.name END`;
    if (includeSales && !userHasPermission(actor, 'checks_view_all')) {
      const user = bind(actor!.userID);
      saleWhere += ` AND (c.master_id=${user} OR EXISTS(SELECT 1 FROM check_service_lines sl WHERE sl.check_id=c.id AND sl.master_id=${user})
      OR EXISTS(SELECT 1 FROM check_assignees ca WHERE ca.check_id=c.id AND ca.user_id=${user}))`;
      ledgerWhere += ` AND ((c.id IS NULL AND ${user}=ANY(e.visible_user_ids)) OR c.master_id=${user}
      OR EXISTS(SELECT 1 FROM check_service_lines sl WHERE sl.check_id=c.id AND sl.master_id=${user})
      OR EXISTS(SELECT 1 FROM check_assignees ca WHERE ca.check_id=c.id AND ca.user_id=${user}))`;
    }
    let eventWhere = 'true';
    if (query.type) eventWhere += ` AND type=${bind(query.type)}`;
    if (from) eventWhere += ` AND occurred_at>=${bind(from)}::timestamptz`;
    if (to) eventWhere += ` AND occurred_at${query.dateTo?.length === 10 ? '<' : '<='}${bind(to)}::timestamptz`;
    const pageWhere = cursor
      ? ` AND (occurred_at,event_id)<(${bind(cursor.time)}::timestamptz,${bind(cursor.id)}::text)`
      : '';
    let linkedVisible = userHasPermission(actor, 'checks_view')
      ? 'linked.id IS NOT NULL AND linked.deleted_at IS NULL'
      : 'false';
    if (userHasPermission(actor, 'checks_view') && !userHasPermission(actor, 'checks_view_all')) {
      const user = bind(actor!.userID);
      linkedVisible += ` AND (linked.master_id=${user} OR EXISTS(SELECT 1 FROM check_service_lines sl WHERE sl.check_id=linked.id AND sl.master_id=${user})
      OR EXISTS(SELECT 1 FROM check_assignees ca WHERE ca.check_id=linked.id AND ca.user_id=${user}))`;
    }
    const stockSql = `SELECT sm.id::text AS event_id,sm.type,sm.created_at AS occurred_at,
    jsonb_build_object('id',sm.id,'productId',${viewedProduct},'product',jsonb_build_object('id',${viewedProduct},'name',${viewedName}),
      'type',sm.type,'quantity',sm.quantity,'stockBefore',${viewedBefore},'stockAfter',${viewedAfter},'stockDelta',(${viewedAfter})-(${viewedBefore}),
      'direction',CASE WHEN(${viewedAfter})>(${viewedBefore}) THEN 'in' WHEN(${viewedAfter})<(${viewedBefore}) THEN 'out' END,
      'reason',sm.reason,'userId',sm.user_id,'user',CASE WHEN sm.user_id IS NULL THEN NULL ELSE jsonb_build_object('id',sm.user_id,'fullName',u.full_name) END,
      'warehouseId',${viewedWarehouse},'warehouseName',${viewedWarehouseName},'sourceWarehouseId',sm.source_warehouse_id,'sourceWarehouseName',sw.name,
      'targetWarehouseId',sm.target_warehouse_id,'targetWarehouseName',tw.name,'supplierId',sm.supplier_id,'supplierName',s.name,
      'recordAsExpense',sm.record_as_expense,'linkedExpenseId',sm.linked_expense_id,'isUsedPurchase',sm.is_used_purchase,
      'checkId',CASE WHEN ${linkedVisible} THEN linked.id END,'checkNumber',CASE WHEN ${linkedVisible} THEN linked.number END,
      'returnId',sm.return_id,'sourceProductId',sm.source_product_id,'targetProductId',sm.target_product_id,
      'targetStockBefore',CASE WHEN ${targetVisible} THEN sm.target_stock_before END,'targetStockAfter',CASE WHEN ${targetVisible} THEN sm.target_stock_after END,'createdAt',sm.created_at) AS item
    FROM stock_movements sm JOIN products p ON p.id=sm.product_id AND p.tenant_id=sm.tenant_id
      LEFT JOIN products dst ON dst.id=sm.target_product_id AND dst.tenant_id=sm.tenant_id
      LEFT JOIN users u ON u.id=sm.user_id LEFT JOIN warehouses w ON w.id=sm.warehouse_id
      LEFT JOIN warehouses sw ON sw.id=sm.source_warehouse_id LEFT JOIN warehouses tw ON tw.id=sm.target_warehouse_id
      LEFT JOIN checks linked ON linked.id=sm.check_id AND linked.tenant_id=sm.tenant_id
      LEFT JOIN suppliers s ON s.id=sm.supplier_id WHERE ${stockWhere}`;
    const salesSql = `SELECT 'sale:'||cpl.id::text AS event_id,'sale'::text AS type,COALESCE(c.date,c.created_at) AS occurred_at,
    jsonb_build_object('id','sale:'||cpl.id::text,'productId',cpl.product_id,'product',jsonb_build_object('id',cpl.product_id,'name',cpl.name),
      'type','sale','quantity',cpl.quantity,'stockBefore',NULL,'stockAfter',NULL,'stockDelta',NULL,'legacyBaseline',true,'reason',NULL,
      'userId',c.master_id,'user',CASE WHEN c.master_id IS NULL THEN NULL ELSE jsonb_build_object('id',c.master_id,'fullName',u.full_name) END,
      'warehouseId',p.warehouse_id,'warehouseName',w.name,'checkId',c.id,'checkNumber',c.number,
      'isReturned',c.is_returned,'returnScope',c.return_scope,'createdAt',COALESCE(c.date,c.created_at)) AS item
    FROM check_product_lines cpl JOIN checks c ON c.id=cpl.check_id
      JOIN products p ON p.id=cpl.product_id AND p.tenant_id=c.tenant_id
      LEFT JOIN users u ON u.id=c.master_id LEFT JOIN warehouses w ON w.id=p.warehouse_id WHERE ${saleWhere}`;
    const ledgerSql = `SELECT 'check-event:'||e.id::text AS event_id,e.kind AS type,e.occurred_at,
    jsonb_build_object('id','check-event:'||e.id::text,'productId',e.product_id,'product',jsonb_build_object('id',e.product_id,'name',e.product_name),
      'type',e.kind,'quantity',e.quantity,'stockDelta',e.stock_delta,'stockBefore',e.stock_before,'stockAfter',e.stock_after,
      'userId',e.actor_id,'user',CASE WHEN e.actor_id IS NULL THEN NULL ELSE jsonb_build_object('id',e.actor_id,'fullName',u.full_name) END,
      'warehouseId',e.warehouse_id,'warehouseName',w.name,'category',e.category,'storageCellId',e.storage_cell_id,
      'checkId',CASE WHEN c.deleted_at IS NULL THEN c.id END,'checkNumber',e.check_number,
      'receiptAvailable',c.id IS NOT NULL AND c.deleted_at IS NULL,'legacyBaseline',e.kind='legacy_baseline',
      'documentDate',e.document_date,'sourceProductId',e.source_product_id,'createdAt',e.occurred_at) AS item
    FROM check_product_events e LEFT JOIN checks c ON c.id=e.check_id AND c.tenant_id=e.tenant_id
      LEFT JOIN users u ON u.id=e.actor_id AND u.tenant_id=e.tenant_id LEFT JOIN warehouses w ON w.id=e.warehouse_id
      WHERE ${ledgerWhere}`;
    const result = await client.query(
      `WITH events AS (${stockSql}${includeSales ? ` UNION ALL ${salesSql} UNION ALL ${ledgerSql}` : ''}),
    filtered AS (SELECT * FROM events WHERE ${eventWhere})
    SELECT item,occurred_at::text AS cursor_time,event_id FROM filtered WHERE true${pageWhere}
      ORDER BY occurred_at DESC,event_id DESC LIMIT ${bind(limit + 1)}`,
      params,
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    const response = {
      data: rows.map((r) => r.item),
      limit,
      snapshotAt: snapshot,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                v: 2,
                snapshot,
                transactionSnapshot,
                time: last.cursor_time,
                id: last.event_id,
                scope,
                epoch,
              }),
            ).toString('base64url')
          : null,
    };
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
