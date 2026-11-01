import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { userHasPermission } from '../common/guards/permissions.guard';
import { pointFilterSql, warehousePointFilterSql } from '../common/point-scope';
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

type Cursor = { v: 1; snapshot: string; time: string; id: string; scope: string };
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
    if (query[key] !== undefined && !uuid.test(query[key]!))
      throw new BadRequestException('Некорректный фильтр товара или склада');
  }
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
      if (query.cursor.length > 1500) throw new Error();
      const parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as Cursor;
      if (
        parsed.v !== 1 ||
        parsed.scope !== scope ||
        typeof parsed.id !== 'string' ||
        parsed.id.length > 100 ||
        !Number.isFinite(Date.parse(parsed.time)) ||
        !Number.isFinite(Date.parse(parsed.snapshot))
      )
        throw new Error();
      cursor = parsed;
    } catch {
      throw new BadRequestException('Курсор истории устарел. Обновите список');
    }
  }
  const snapshot =
    cursor?.snapshot ?? (await pool.query('SELECT clock_timestamp()::text AS snapshot')).rows[0].snapshot;
  const params: unknown[] = [tenantID, snapshot];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  let stockWhere = `sm.tenant_id=$1 AND sm.recorded_at <= $2::timestamptz${warehousePointFilterSql('sm', pointId, params)}`;
  let saleWhere = `c.tenant_id=$1 AND c.deleted_at IS NULL AND c.is_deferred=false AND cpl.recorded_at <= $2::timestamptz${includeSales ? pointFilterSql('c', pointId, params) : ''}`;
  if (query.productId) {
    const id = bind(query.productId);
    stockWhere += ` AND sm.product_id=${id}`;
    saleWhere += ` AND cpl.product_id=${id}`;
  }
  if (query.warehouseId) {
    const id = bind(query.warehouseId);
    stockWhere += ` AND sm.warehouse_id=${id}`;
    saleWhere += ` AND p.warehouse_id=${id}`;
  }
  if (includeSales && !userHasPermission(actor, 'checks_view_all')) {
    const user = bind(actor!.userID);
    saleWhere += ` AND (c.master_id=${user} OR EXISTS(SELECT 1 FROM check_service_lines sl WHERE sl.check_id=c.id AND sl.master_id=${user})
      OR EXISTS(SELECT 1 FROM check_assignees ca WHERE ca.check_id=c.id AND ca.user_id=${user}))`;
  }
  let eventWhere = 'true';
  if (query.type) eventWhere += ` AND type=${bind(query.type)}`;
  if (from) eventWhere += ` AND occurred_at>=${bind(from)}::timestamptz`;
  if (to) eventWhere += ` AND occurred_at${query.dateTo?.length === 10 ? '<' : '<='}${bind(to)}::timestamptz`;
  const pageWhere = cursor
    ? ` AND (occurred_at,event_id)<(${bind(cursor.time)}::timestamptz,${bind(cursor.id)}::text)`
    : '';
  const stockSql = `SELECT sm.id::text AS event_id,sm.type,sm.created_at AS occurred_at,
    jsonb_build_object('id',sm.id,'productId',sm.product_id,'product',jsonb_build_object('id',sm.product_id,'name',p.name),
      'type',sm.type,'quantity',sm.quantity,'stockBefore',sm.stock_before,'stockAfter',sm.stock_after,
      'reason',sm.reason,'userId',sm.user_id,'user',CASE WHEN sm.user_id IS NULL THEN NULL ELSE jsonb_build_object('id',sm.user_id,'fullName',u.full_name) END,
      'warehouseId',sm.warehouse_id,'warehouseName',w.name,'sourceWarehouseId',sm.source_warehouse_id,'sourceWarehouseName',sw.name,
      'targetWarehouseId',sm.target_warehouse_id,'targetWarehouseName',tw.name,'supplierId',sm.supplier_id,'supplierName',s.name,
      'recordAsExpense',sm.record_as_expense,'linkedExpenseId',sm.linked_expense_id,'isUsedPurchase',sm.is_used_purchase,
      'checkId',NULL,'checkNumber',NULL,'createdAt',sm.created_at) AS item
    FROM stock_movements sm JOIN products p ON p.id=sm.product_id AND p.tenant_id=sm.tenant_id
      LEFT JOIN users u ON u.id=sm.user_id LEFT JOIN warehouses w ON w.id=sm.warehouse_id
      LEFT JOIN warehouses sw ON sw.id=sm.source_warehouse_id LEFT JOIN warehouses tw ON tw.id=sm.target_warehouse_id
      LEFT JOIN suppliers s ON s.id=sm.supplier_id WHERE ${stockWhere}`;
  const salesSql = `SELECT 'sale:'||cpl.id::text AS event_id,'sale'::text AS type,COALESCE(c.date,c.created_at) AS occurred_at,
    jsonb_build_object('id','sale:'||cpl.id::text,'productId',cpl.product_id,'product',jsonb_build_object('id',cpl.product_id,'name',cpl.name),
      'type','sale','quantity',cpl.quantity,'stockBefore',0,'stockAfter',0,'reason',NULL,
      'userId',c.master_id,'user',CASE WHEN c.master_id IS NULL THEN NULL ELSE jsonb_build_object('id',c.master_id,'fullName',u.full_name) END,
      'warehouseId',p.warehouse_id,'warehouseName',w.name,'checkId',c.id,'checkNumber',c.number,
      'isReturned',c.is_returned,'returnScope',c.return_scope,'createdAt',COALESCE(c.date,c.created_at)) AS item
    FROM check_product_lines cpl JOIN checks c ON c.id=cpl.check_id
      JOIN products p ON p.id=cpl.product_id AND p.tenant_id=c.tenant_id
      LEFT JOIN users u ON u.id=c.master_id LEFT JOIN warehouses w ON w.id=p.warehouse_id WHERE ${saleWhere}`;
  const result = await pool.query(
    `WITH events AS (${stockSql}${includeSales ? ` UNION ALL ${salesSql}` : ''}),
    filtered AS (SELECT * FROM events WHERE ${eventWhere})
    SELECT item,occurred_at::text AS cursor_time,event_id FROM filtered WHERE true${pageWhere}
      ORDER BY occurred_at DESC,event_id DESC LIMIT ${bind(limit + 1)}`,
    params,
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    data: rows.map((r) => r.item),
    limit,
    snapshotAt: snapshot,
    nextCursor:
      hasMore && last
        ? Buffer.from(JSON.stringify({ v: 1, snapshot, time: last.cursor_time, id: last.event_id, scope })).toString(
            'base64url',
          )
        : null,
  };
}
