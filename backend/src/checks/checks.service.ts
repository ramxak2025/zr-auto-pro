import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { WarrantyService } from '../warranty/warranty.service';
import { PushService } from '../push/push.service';
import { MarketingService } from '../marketing/marketing.service';
import { parseFields, filterShape } from '../common/field-filter';
import { ttlCache } from '../common/ttl-cache';
import { invalidateReportsForTenant } from '../common/reports-cache';
import { userHasPermission } from '../common/guards/permissions.guard';

/** Actor context for visibility decisions (checks_view_all). */
interface ChecksActor {
  userID: string;
  role: string;
  permissions?: Record<string, boolean>;
}

// Only tables we explicitly want to allow as targets of cross-tenant
// assertions. Keeping this as an allow-list (not a string the caller
// passes through) means even if a future refactor mistakenly forwards
// user input as the table name, the helper rejects it.
const TENANT_OWNED_TABLES = new Set(['users', 'clients', 'cars', 'services', 'products']);

/**
 * Owner-configurable kanban board column (migration 091). `key` is the slug
 * stored in `checks.work_status`; the rest is presentation + behaviour. Purely a
 * board-tracking concept — orthogonal to payment / cash / stock / salary.
 */
export interface WorkBoardColumn {
  id: string;
  key: string;
  label: string;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  notifyClient: boolean;
}

/**
 * Legacy default board columns (migration 082 hard-coded these four). Seeded
 * per-tenant on first board/columns read so existing checks keep mapping:
 * accepted→«Приёмка», in_progress→«В работе», ready→«Готов» (fires «машина
 * готова»), delivered→«Выдан». Order here is the seeded sort_order (0..3).
 */
const DEFAULT_BOARD_COLUMNS: ReadonlyArray<{
  key: string;
  label: string;
  color: string;
  notifyClient: boolean;
}> = [
  { key: 'accepted', label: 'Приёмка', color: '#6366F1', notifyClient: false },
  { key: 'in_progress', label: 'В работе', color: '#F59E0B', notifyClient: false },
  { key: 'ready', label: 'Готов', color: '#22C55E', notifyClient: true },
  { key: 'delivered', label: 'Выдан', color: '#64748B', notifyClient: false },
];

/**
 * Derive a stable slug key from an owner-supplied column label. Lowercase ASCII
 * + digits, runs of anything else collapse to '-'. Russian (and any non-ASCII)
 * labels strip to empty — the caller then falls back to a random key. Capped so
 * the slug stays a sane length. Uniqueness within a tenant is enforced by the
 * caller (suffix on conflict against the UNIQUE (tenant_id, key) index).
 */
function slugifyColumnKey(label: unknown): string {
  return String(label ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Normalize an optional hex color; null when not a usable string. */
function normalizeColor(color: unknown): string | null {
  if (typeof color !== 'string') return null;
  const trimmed = color.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 32) : null;
}

/**
 * Opaque keyset cursor for the checks journal: base64url of `<date>|<id>`.
 * `date` is the row's ISO timestamp, `id` its UUID — together they form the
 * (date DESC, id DESC) keyset. Opaque on purpose so the FE just round-trips
 * `nextCursor` without parsing it.
 */
function encodeCheckCursor(date: unknown, id: unknown): string {
  const iso = date instanceof Date ? date.toISOString() : String(date);
  return Buffer.from(`${iso}|${String(id)}`, 'utf8').toString('base64url');
}

/**
 * Decode a keyset cursor. Returns null for a missing / empty / malformed
 * cursor (the caller then treats it as "first page" — newest rows). Never
 * throws on bad input.
 */
function parseCheckCursor(raw: unknown): { date: string; id: string } | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    if (sep <= 0) return null;
    const date = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!date || !id) return null;
    return { date, id };
  } catch {
    return null;
  }
}

@Injectable()
export class ChecksService {
  private readonly logger = new Logger('ChecksService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private warranty: WarrantyService,
    @Optional() private pushService?: PushService,
    // Reused for the «машина готова» auto-notification (fire-and-forget from
    // setWorkStatus). @Optional so a missing provider can never break check
    // writes; the module wires it in, so in practice it's always present.
    @Optional() private marketing?: MarketingService,
  ) {}

  /**
   * Throw NotFoundException unless `id` exists in `table` AND belongs to the
   * caller's `tenantID`. Used at the top of write operations to prevent a
   * privileged caller from referencing rows from a foreign tenant.
   *
   * `table` is checked against TENANT_OWNED_TABLES — never interpolate user
   * input here. The column is always `id` + `tenant_id` by convention.
   */
  private async assertOwnsByTenant(
    client: PoolClient,
    tenantID: string,
    table: string,
    id: string,
    label: string,
  ): Promise<void> {
    if (!TENANT_OWNED_TABLES.has(table)) {
      throw new InternalServerErrorException({ message: 'Internal assertion error' });
    }
    const { rows } = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [
      id,
      tenantID,
    ]);
    if (rows.length === 0) {
      throw new BadRequestException({ message: `${label} не найден` });
    }
  }

  private async assertManyOwnedByTenant(
    client: PoolClient,
    tenantID: string,
    table: string,
    ids: string[],
    label: string,
  ): Promise<void> {
    if (!TENANT_OWNED_TABLES.has(table)) {
      throw new InternalServerErrorException({ message: 'Internal assertion error' });
    }
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) return;
    const { rows } = await client.query(`SELECT id FROM ${table} WHERE id = ANY($1) AND tenant_id = $2`, [
      uniqueIds,
      tenantID,
    ]);
    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException({ message: `${label} не найден или принадлежит другому автосервису` });
    }
  }

  /**
   * Apply the side-effects of a deferred draft becoming a real (active) check,
   * INSIDE the caller's already-open transaction:
   *   1) decrement product stock for every product line of the check;
   *   2) spawn warranty_claims for any product/service line whose master
   *      record has warranty_days set — exactly the same way create() does.
   *
   * MUST only be invoked on a genuine is_deferred true→false transition (the
   * caller verifies the PRIOR is_deferred straight from the DB). Reading the
   * persisted lines from the DB — instead of trusting in-memory arrays — makes
   * this the single source of truth for both the line-rewriting close
   * (fullUpdate) and a bare isDeferred toggle.
   *
   * IDEMPOTENT against double-spend:
   *   - stock is only ever decremented here on the one transition, never on a
   *     normal active-check edit (caller gate);
   *   - warranty_claims are skipped entirely if this check already has ANY
   *     claim row, so a re-run can never duplicate guarantees.
   */
  private async applyDeferredActivation(
    client: PoolClient,
    tenantID: string,
    checkId: string,
    checkDate: string,
    clientId: string | null,
    carId: string | null,
  ): Promise<void> {
    // ── 1) Decrement stock from the persisted product lines ───────────────
    // Aggregate per product so a product appearing on several lines is
    // decremented once by the summed quantity. Stock is allowed to go NEGATIVE
    // («продажа в минус» — по требованию владельца): продать больше, чем есть на
    // складе, никогда не блокируется и не ошибается — записывается дефицит,
    // чтобы владелец видел, сколько «должны». Симметрично пути возврата/удаления
    // (stock + qty), поэтому отменённый оверселл восстанавливает сток ровно.
    // Tenant-scoped on both ends.
    const { rows: prodRows } = await client.query(
      `SELECT product_id, COALESCE(SUM(quantity), 0) AS qty
         FROM check_product_lines
        WHERE check_id = $1 AND product_id IS NOT NULL
        GROUP BY product_id`,
      [checkId],
    );
    for (const r of prodRows) {
      const qty = parseFloat(r.qty) || 0;
      if (qty <= 0) continue;
      await client.query(`UPDATE products SET stock = stock - $1 WHERE id = $2 AND tenant_id = $3`, [
        qty,
        r.product_id,
        tenantID,
      ]);
    }

    // ── 2) Create warranty_claims (idempotent) ────────────────────────────
    // Never duplicate: if this check already carries any warranty claim we
    // skip the whole step. A deferred draft skips warranty at create()-time,
    // so on the first activation there are none, and createFromCheckLines
    // runs exactly once across the lifetime of the check.
    const { rows: existingWarranty } = await client.query(
      `SELECT 1 FROM warranty_claims WHERE tenant_id = $1 AND check_id = $2 LIMIT 1`,
      [tenantID, checkId],
    );
    if (existingWarranty.length > 0) return;

    const warrantyLines: Array<{
      kind: 'product' | 'service';
      productId?: string | null;
      serviceId?: string | null;
      itemName?: string | null;
    }> = [];
    const { rows: svcLines } = await client.query(
      `SELECT service_id, name FROM check_service_lines WHERE check_id = $1 AND service_id IS NOT NULL`,
      [checkId],
    );
    for (const s of svcLines) {
      warrantyLines.push({ kind: 'service', serviceId: s.service_id, itemName: s.name });
    }
    const { rows: prodLinesForWarranty } = await client.query(
      `SELECT product_id, name FROM check_product_lines WHERE check_id = $1 AND product_id IS NOT NULL`,
      [checkId],
    );
    for (const p of prodLinesForWarranty) {
      warrantyLines.push({ kind: 'product', productId: p.product_id, itemName: p.name });
    }
    if (warrantyLines.length > 0) {
      await this.warranty.createFromCheckLines(client, tenantID, checkId, checkDate, clientId, carId, warrantyLines);
    }
  }

  private invalidateReports(tenantID: string) {
    invalidateReportsForTenant(tenantID);
  }

  /**
   * Fire-and-forget a SILENT data-only push so other open apps in the same
   * tenant know the cash position moved and refetch their money queries. The
   * actor is excluded (their own client already updated optimistically).
   *
   * Never awaited on the request path and never throws — push is an
   * accelerator, not the source of truth.
   */
  private emitCashChanged(tenantID: string, actorUserId: string | null) {
    if (!this.pushService) return;
    this.pushService.sendDataToTenant(tenantID, actorUserId, { type: 'cash-changed', tenantId: tenantID }).catch(() => {
      /* best-effort */
    });
  }

  private mapCheck(row: any) {
    return {
      id: row.id,
      number: row.number,
      date: row.date,
      masterId: row.master_id,
      clientId: row.client_id,
      carId: row.car_id,
      mileage: row.mileage,
      comment: row.comment,
      discount: parseFloat(row.discount) || 0,
      isDeferred: row.is_deferred,
      paymentMethod: row.payment_method,
      cashAmount: parseFloat(row.cash_amount) || 0,
      cardAmount: parseFloat(row.card_amount) || 0,
      serviceTotal: parseFloat(row.service_total) || 0,
      productTotal: parseFloat(row.product_total) || 0,
      totalRevenue: parseFloat(row.total_revenue) || 0,
      productCostTotal: parseFloat(row.product_cost_total) || 0,
      serviceSalaryTotal: parseFloat(row.service_salary_total) || 0,
      productSalaryTotal: parseFloat(row.product_salary_total) || 0,
      totalCost: parseFloat(row.total_cost) || 0,
      profit: parseFloat(row.profit) || 0,
      // Returns metadata: 040 added is_returned + returned_at + return_destination + return_scope.
      // FE renders a strikethrough / red badge on returned checks in the journal.
      isReturned: !!row.is_returned,
      returnedAt: row.returned_at ?? null,
      returnDestination: row.return_destination ?? null,
      returnScope: row.return_scope ?? null,
      // 082: kanban work-status (приёмка/в работе/готов/выдан). Purely a
      // tracking flag — orthogonal to payment/cash/stock. NULL on historical
      // rows (not tracked on the board). Additive; existing consumers ignore it.
      workStatus: row.work_status ?? null,
      createdAt: row.created_at,
    };
  }

  async getAll(tenantID: string, query: any, actor?: ChecksActor) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const offset = (page - 1) * limit;

    // OPTIONAL keyset pagination. Presence of the `cursor` query param (even
    // empty) switches to a (date DESC, id DESC) keyset instead of OFFSET —
    // O(log N) at any depth, backed by idx_checks_tenant_date_id. PURELY
    // ADDITIVE: with no `cursor` param the response and behaviour are
    // byte-for-byte the classic offset path. First keyset page: pass an empty
    // `?cursor=` to fetch the newest rows; then follow `nextCursor` (null =
    // end of feed). The keyset response keeps the same `{ data, total, page,
    // limit }` shape and just adds `nextCursor`, so offset clients are
    // unaffected.
    const keysetMode = query.cursor !== undefined;
    const cursor = keysetMode ? parseCheckCursor(query.cursor) : null;

    let where = 'ch.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    // ── checks_view_all ──────────────────────────────────────────────────
    // A master who does NOT hold `checks_view_all` may only see their own
    // checks. Owner-class roles (and a master who DOES hold the permission)
    // see every check in the tenant. This is layered ON TOP of the tenant
    // scope above — it never widens visibility, only narrows it, and it
    // doesn't touch tenant_id. Applied to `where` so it flows into both the
    // COUNT and the page query (offset and keyset alike).
    if (actor && actor.role === 'master' && !userHasPermission(actor, 'checks_view_all')) {
      where += ` AND ch.master_id = $${idx++}`;
      params.push(actor.userID);
    }

    if (query.masterId) {
      where += ` AND ch.master_id = $${idx++}`;
      params.push(query.masterId);
    }
    if (query.clientId) {
      where += ` AND ch.client_id = $${idx++}`;
      params.push(query.clientId);
    }
    if (query.carId) {
      where += ` AND ch.car_id = $${idx++}`;
      params.push(query.carId);
    }
    if (query.dateFrom) {
      where += ` AND ch.date >= $${idx++}`;
      params.push(query.dateFrom);
    }
    if (query.dateTo) {
      where += ` AND ch.date <= $${idx++}`;
      params.push(query.dateTo + 'T23:59:59Z');
    }
    if (query.retail === 'true') {
      where += ` AND ch.client_id IS NULL`;
    }
    // OPTIONAL deferred filter (additive): `?isDeferred=true` → only deferred
    // drafts, `?isDeferred=false` → only closed checks. Absent → no filter,
    // existing callers see byte-for-byte the same response.
    if (query.isDeferred === 'true' || query.isDeferred === true) {
      where += ` AND ch.is_deferred = true`;
    } else if (query.isDeferred === 'false' || query.isDeferred === false) {
      where += ` AND ch.is_deferred = false`;
    }
    if (query.search) {
      where += ` AND (cl.full_name ILIKE $${idx} OR cl.phone ILIKE $${idx} OR ca.plate_number ILIKE $${idx})`;
      params.push(`%${query.search}%`);
      idx++;
    }

    // The clients+cars LEFT JOINs only exist to satisfy the `search` filter
    // (cl.full_name / cl.phone / ca.plate_number). With no search term the
    // COUNT can run on `checks` alone — dropping two joins per page load on
    // the most-hit list endpoint. The response shape is unchanged.
    const countResult = query.search
      ? await this.pool.query(
          `SELECT COUNT(*) as total FROM checks ch
           LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = ch.tenant_id
           LEFT JOIN cars ca ON ca.id = ch.car_id AND ca.tenant_id = ch.tenant_id
           WHERE ${where}`,
          params,
        )
      : await this.pool.query(`SELECT COUNT(*) as total FROM checks ch WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    let rows: any[];
    if (keysetMode) {
      // Keyset: order by the (date DESC, id DESC) index so Postgres seeks
      // instead of sorting. A valid cursor adds the "older than" predicate;
      // an empty cursor (first page) just takes the newest rows.
      let keysetWhere = where;
      if (cursor) {
        keysetWhere += ` AND (ch.date, ch.id) < ($${idx}, $${idx + 1})`;
        params.push(cursor.date, cursor.id);
        idx += 2;
      }
      params.push(limit);
      const res = await this.pool.query(
        `SELECT ch.*,
                m.full_name as master_name, m.avatar as master_avatar,
                cl.full_name as client_name, cl.phone as client_phone,
                ca.plate_number, ca.make_model
         FROM checks ch
         LEFT JOIN users m ON m.id = ch.master_id AND m.tenant_id = ch.tenant_id
         LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = ch.tenant_id
         LEFT JOIN cars ca ON ca.id = ch.car_id AND ca.tenant_id = ch.tenant_id
         WHERE ${keysetWhere}
         ORDER BY ch.date DESC, ch.id DESC
         LIMIT $${idx}`,
        params,
      );
      rows = res.rows;
    } else {
      params.push(limit, offset);
      const res = await this.pool.query(
        `SELECT ch.*,
                m.full_name as master_name, m.avatar as master_avatar,
                cl.full_name as client_name, cl.phone as client_phone,
                ca.plate_number, ca.make_model
         FROM checks ch
         LEFT JOIN users m ON m.id = ch.master_id AND m.tenant_id = ch.tenant_id
         LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = ch.tenant_id
         LEFT JOIN cars ca ON ca.id = ch.car_id AND ca.tenant_id = ch.tenant_id
         WHERE ${where}
         ORDER BY ch.date DESC, ch.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params,
      );
      rows = res.rows;
    }

    const fields = parseFields(query.fields);
    const checks = rows.map((row) => {
      const ch = this.mapCheck(row);
      if (row.master_id) {
        (ch as any).master = { id: row.master_id, fullName: row.master_name, avatar: row.master_avatar };
      }
      if (row.client_id) {
        (ch as any).client = { id: row.client_id, fullName: row.client_name, phone: row.client_phone };
      }
      if (row.car_id) {
        (ch as any).car = { id: row.car_id, plateNumber: row.plate_number, makeModel: row.make_model };
      }
      // Slim payload: list view never carries inline service / product line
      // arrays — they belong to the detail endpoint. Caller can opt in to a
      // subset via ?fields=. Counts are intentionally not included; the FE
      // already has serviceTotal + productTotal in the row.
      return filterShape(ch as Record<string, unknown>, fields);
    });

    // Keyset mode: emit the cursor for the NEXT page (the last row's
    // date,id), or null when this page didn't fill `limit` (end of feed).
    // Computed from the raw rows so it's independent of any ?fields= filter.
    if (keysetMode) {
      const last = rows.length === limit ? rows[rows.length - 1] : undefined;
      const nextCursor = last ? encodeCheckCursor(last.date, last.id) : null;
      return { data: checks, total, page, limit, nextCursor };
    }

    return { data: checks, total, page, limit };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT ch.*,
              m.full_name as master_name, m.avatar as master_avatar,
              cl.full_name as client_name, cl.phone as client_phone,
              ca.plate_number, ca.make_model
       FROM checks ch
       LEFT JOIN users m ON m.id = ch.master_id AND m.tenant_id = ch.tenant_id
       LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = ch.tenant_id
       LEFT JOIN cars ca ON ca.id = ch.car_id AND ca.tenant_id = ch.tenant_id
       WHERE ch.id=$1 AND ch.tenant_id=$2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });

    const row = rows[0];
    const ch: any = this.mapCheck(row);
    if (row.master_id) ch.master = { id: row.master_id, fullName: row.master_name, avatar: row.master_avatar };
    if (row.client_id) ch.client = { id: row.client_id, fullName: row.client_name, phone: row.client_phone };
    if (row.car_id) ch.car = { id: row.car_id, plateNumber: row.plate_number, makeModel: row.make_model };

    // Load service lines (check_id already verified against tenant above)
    const { rows: svcRows } = await this.pool.query(
      `SELECT sl.*, u.full_name as master_name
       FROM check_service_lines sl
       JOIN checks c ON c.id = sl.check_id AND c.tenant_id = $2
       LEFT JOIN users u ON u.id = sl.master_id AND u.tenant_id = c.tenant_id
       WHERE sl.check_id=$1`,
      [id, tenantID],
    );
    ch.services = svcRows.map((s) => ({
      id: s.id,
      serviceId: s.service_id,
      masterId: s.master_id,
      master: s.master_id ? { id: s.master_id, fullName: s.master_name } : undefined,
      name: s.name,
      price: parseFloat(s.price) || 0,
      quantity: s.quantity,
      total: parseFloat(s.total) || 0,
    }));

    // Load product lines (tenant-scoped via JOIN)
    const { rows: prodRows } = await this.pool.query(
      `SELECT pl.* FROM check_product_lines pl
       JOIN checks c ON c.id = pl.check_id AND c.tenant_id = $2
       WHERE pl.check_id=$1`,
      [id, tenantID],
    );
    ch.products = prodRows.map((p) => ({
      id: p.id,
      productId: p.product_id,
      name: p.name,
      sellPrice: parseFloat(p.sell_price) || 0,
      costPrice: parseFloat(p.cost_price) || 0,
      quantity: parseFloat(p.quantity) || 0,
      totalSell: parseFloat(p.total_sell) || 0,
      totalCost: parseFloat(p.total_cost) || 0,
    }));

    // Warranty claims tied to this check (may be empty — only filled when
    // a product/service had warranty_days set at sale time).
    ch.warrantyClaims = await this.warranty.listForCheck(tenantID, id);

    return ch;
  }

  /**
   * Set the kanban work-status of a check (082 + 091). PURELY a tracking flag —
   * touches NOTHING financial: no revenue, payment, stock, salary, warranty or
   * return state is read or written here. Validates the value is the key of one
   * of the tenant's ACTIVE board columns (091, owner-configurable) and writes
   * the single `work_status` column, tenant-scoped.
   *
   * Returns the full updated check (same shape as getById) so the FE can update
   * its detail/board cache in place.
   */
  async setWorkStatus(id: string, tenantID: string, workStatus: unknown): Promise<any> {
    if (typeof workStatus !== 'string' || workStatus.length === 0) {
      throw new BadRequestException({ message: 'Не указан статус доски' });
    }
    // Validate against the tenant's ACTIVE board columns (091) instead of a
    // hard-coded enum. ensureBoardColumnsDefaults guarantees the legacy four
    // exist for tenants that never customised the board. The matched column also
    // carries notify_client, which now drives the «машина готова» hook below.
    await this.ensureBoardColumnsDefaults(tenantID);
    const { rows: colRows } = await this.pool.query(
      `SELECT key, notify_client FROM work_board_columns WHERE tenant_id=$1 AND is_active=true`,
      [tenantID],
    );
    const targetColumn = colRows.find((c) => c.key === workStatus);
    if (!targetColumn) {
      const valid = colRows.map((c) => c.key).join(', ');
      throw new BadRequestException({
        message: valid ? `Недопустимый статус. Ожидается одна из колонок: ${valid}` : 'Недопустимый статус доски',
      });
    }
    // Tenant-scoped single-column update. The `before` CTE captures the prior
    // work_status in the SAME statement so we can detect a *transition* INTO
    // 'ready' (and not re-fire when it was already 'ready'). RETURNING id also
    // confirms the row exists in this tenant; the full payload is re-read via
    // getById below.
    const { rows } = await this.pool.query(
      `WITH before AS (
         SELECT work_status FROM checks WHERE id=$2 AND tenant_id=$3
       )
       UPDATE checks SET work_status=$1
       FROM before
       WHERE checks.id=$2 AND checks.tenant_id=$3
       RETURNING checks.id AS id, before.work_status AS old_status`,
      [workStatus, id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
    const previousStatus: string | null = rows[0].old_status ?? null;

    // No report-cache invalidation / cash-changed push: the board flag does not
    // move money, so the financial caches stay valid.

    // «Машина готова» auto-notification — fire on the transition INTO any column
    // whose notify_client=true (skip if the check was already in that column).
    // The notify column is looked up by key from the tenant's board config
    // above (no longer the hard-coded 'ready'). FIRE-AND-FORGET: deliberately
    // NOT awaited and fully guarded, so it can never block, delay, or fail the
    // status change above. Nothing about the returned check is altered by it.
    if (targetColumn.notify_client === true && previousStatus !== workStatus) {
      this.fireCarReadyNotification(id, tenantID);
    }

    return this.getById(id, tenantID);
  }

  /**
   * Best-effort «машина готова» client message. Fire-and-forget: never awaited,
   * never throws into the caller — a messaging failure (no provider, no phone,
   * network error) is swallowed with a warn log. Tenant isolation and the
   * "has a client with a phone" check live in MarketingService.notifyCarReady.
   * Tokens are never logged (handled inside the adapters).
   */
  private fireCarReadyNotification(checkId: string, tenantID: string): void {
    if (!this.marketing) return;
    void this.marketing.notifyCarReady(tenantID, checkId).catch((err) => {
      this.logger.warn(`car-ready notify failed for check ${checkId}: ${err?.message ?? err}`);
    });
  }

  /**
   * Owner-configurable kanban board (082 + 091). Returns the tenant's ACTIVE
   * columns (ordered by sort_order) plus `groups`: a map keyed by column key →
   * that column's checks, newest-first, capped at `perColumn` (default 100) via
   * a window function so one busy column can't return an unbounded set. Checks
   * whose work_status points at a deleted / inactive / unknown column simply do
   * not appear (off the board). Historical checks with work_status = NULL are
   * also excluded. Tenant-scoped; respects the SAME checks_view_all rule as the
   * journal (a master without it sees only their own checks).
   *
   * Response shape (NEW in 091 — breaking vs the old fixed
   * {accepted,in_progress,ready,delivered} object):
   *
   *   { columns: WorkBoardColumn[], groups: Record<columnKey, Check[]> }
   *
   * Every active column key is present in `groups` (empty array when no checks),
   * so the FE can render the column even when it holds nothing.
   */
  async getBoard(
    tenantID: string,
    actor?: ChecksActor,
    perColumn = 100,
  ): Promise<{ columns: WorkBoardColumn[]; groups: Record<string, any[]> }> {
    await this.ensureBoardColumnsDefaults(tenantID);
    const { rows: colRows } = await this.pool.query(
      `SELECT * FROM work_board_columns
        WHERE tenant_id=$1 AND is_active=true
        ORDER BY sort_order ASC, created_at ASC`,
      [tenantID],
    );
    const columns = colRows.map((r) => this.mapBoardColumn(r));
    const activeKeys = columns.map((c) => c.key);

    // Pre-seed every active column so the FE always gets an entry (even empty).
    const groups: Record<string, any[]> = {};
    for (const key of activeKeys) groups[key] = [];

    // No active columns → nothing to group; return the (possibly empty) columns.
    if (activeKeys.length === 0) return { columns, groups };

    let where = 'ch.tenant_id = $1 AND ch.work_status = ANY($2)';
    const params: any[] = [tenantID, activeKeys];
    let idx = 3;

    // Same narrowing as getAll: a master without checks_view_all sees only their
    // own checks. Never widens visibility, never touches tenant scope.
    if (actor && actor.role === 'master' && !userHasPermission(actor, 'checks_view_all')) {
      where += ` AND ch.master_id = $${idx++}`;
      params.push(actor.userID);
    }

    params.push(perColumn);
    const { rows } = await this.pool.query(
      `SELECT * FROM (
         SELECT ch.*,
                m.full_name as master_name, m.avatar as master_avatar,
                cl.full_name as client_name, cl.phone as client_phone,
                ca.plate_number, ca.make_model,
                ROW_NUMBER() OVER (PARTITION BY ch.work_status ORDER BY ch.date DESC, ch.id DESC) AS rn
         FROM checks ch
         LEFT JOIN users m ON m.id = ch.master_id AND m.tenant_id = ch.tenant_id
         LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = ch.tenant_id
         LEFT JOIN cars ca ON ca.id = ch.car_id AND ca.tenant_id = ch.tenant_id
         WHERE ${where}
       ) sub
       WHERE sub.rn <= $${idx}
       ORDER BY sub.date DESC, sub.id DESC`,
      params,
    );

    for (const row of rows) {
      const ch: any = this.mapCheck(row);
      if (row.master_id) {
        ch.master = { id: row.master_id, fullName: row.master_name, avatar: row.master_avatar };
      }
      if (row.client_id) {
        ch.client = { id: row.client_id, fullName: row.client_name, phone: row.client_phone };
      }
      if (row.car_id) {
        ch.car = { id: row.car_id, plateNumber: row.plate_number, makeModel: row.make_model };
      }
      const key = ch.workStatus as string;
      if (key && groups[key]) groups[key].push(ch);
    }
    return { columns, groups };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Board columns (091) — owner-configurable kanban columns per tenant.
  //  Purely board-tracking; NOTHING here reads or writes money / stock /
  //  salary / warranty. `key` is the slug persisted in checks.work_status.
  // ──────────────────────────────────────────────────────────────────────

  private mapBoardColumn(row: any): WorkBoardColumn {
    return {
      id: row.id,
      key: row.key,
      label: row.label,
      color: row.color ?? null,
      sortOrder: typeof row.sort_order === 'number' ? row.sort_order : parseInt(row.sort_order, 10) || 0,
      isActive: !!row.is_active,
      notifyClient: !!row.notify_client,
    };
  }

  /**
   * Idempotently seed the 4 legacy board columns for a tenant that has none yet
   * (first board / columns read). Bulk INSERT … ON CONFLICT (tenant_id, key) DO
   * NOTHING — so a re-run, or a tenant that already added / renamed / removed
   * columns, is left completely untouched. Cheap single round-trip; safe to call
   * on every board read and on setWorkStatus.
   */
  private async ensureBoardColumnsDefaults(tenantID: string): Promise<void> {
    const keys = DEFAULT_BOARD_COLUMNS.map((c) => c.key);
    const labels = DEFAULT_BOARD_COLUMNS.map((c) => c.label);
    const colors = DEFAULT_BOARD_COLUMNS.map((c) => c.color);
    const sorts = DEFAULT_BOARD_COLUMNS.map((_, i) => i);
    const notify = DEFAULT_BOARD_COLUMNS.map((c) => c.notifyClient);
    await this.pool.query(
      `INSERT INTO work_board_columns (tenant_id, key, label, color, sort_order, notify_client)
       SELECT $1, d.k, d.l, d.c, d.s, d.n
         FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::boolean[]) AS d(k, l, c, s, n)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantID, keys, labels, colors, sorts, notify],
    );
  }

  /** All board columns for a tenant (active + inactive), ordered by sort_order. */
  async listBoardColumns(tenantID: string): Promise<WorkBoardColumn[]> {
    await this.ensureBoardColumnsDefaults(tenantID);
    const { rows } = await this.pool.query(
      `SELECT * FROM work_board_columns WHERE tenant_id=$1 ORDER BY sort_order ASC, created_at ASC`,
      [tenantID],
    );
    return rows.map((r) => this.mapBoardColumn(r));
  }

  /**
   * Create a board column. `key` is auto-derived (slug of label, or a random
   * `col-xxxxxxxx` when the label has no ASCII slug), made unique within the
   * tenant via suffix-on-conflict against the UNIQUE (tenant_id, key) index.
   * sort_order appends to the end. is_active defaults true.
   */
  async createBoardColumn(
    tenantID: string,
    body: { label?: unknown; color?: unknown; notifyClient?: unknown },
  ): Promise<WorkBoardColumn> {
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    if (!label) throw new BadRequestException({ message: 'Название колонки обязательно' });
    await this.ensureBoardColumnsDefaults(tenantID);

    const color = normalizeColor(body?.color) ?? '#64748B';
    const notifyClient = body?.notifyClient === true;
    const base = slugifyColumnKey(label) || `col-${randomUUID().slice(0, 8)}`;

    const insert = async (key: string, onConflict: boolean) => {
      const { rows } = await this.pool.query(
        `INSERT INTO work_board_columns (tenant_id, key, label, color, sort_order, is_active, notify_client)
         VALUES ($1, $2, $3, $4,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM work_board_columns WHERE tenant_id=$1),
                 true, $5)
         ${onConflict ? 'ON CONFLICT (tenant_id, key) DO NOTHING' : ''}
         RETURNING *`,
        [tenantID, key, label, color, notifyClient],
      );
      return rows[0];
    };

    // Try the bare slug, then slug-2, slug-3 … on key collision.
    for (let attempt = 0; attempt < 6; attempt++) {
      const key = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const row = await insert(key, true);
      if (row) return this.mapBoardColumn(row);
    }
    // Astronomically unlikely fallback: a guaranteed-unique random suffix.
    const row = await insert(`${base}-${randomUUID().slice(0, 8)}`, false);
    return this.mapBoardColumn(row);
  }

  /**
   * Edit / reorder a board column. `key` is intentionally immutable (it's the
   * slug persisted on checks — renaming it would orphan parked checks). label /
   * color / sortOrder / isActive / notifyClient are all optional partial edits.
   */
  async updateBoardColumn(
    tenantID: string,
    id: string,
    body: {
      label?: unknown;
      color?: unknown;
      sortOrder?: unknown;
      isActive?: unknown;
      notifyClient?: unknown;
    },
  ): Promise<WorkBoardColumn> {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (body?.label !== undefined) {
      const label = typeof body.label === 'string' ? body.label.trim() : '';
      if (!label) throw new BadRequestException({ message: 'Название колонки не может быть пустым' });
      sets.push(`label=$${idx++}`);
      vals.push(label);
    }
    if (body?.color !== undefined) {
      sets.push(`color=$${idx++}`);
      vals.push(normalizeColor(body.color));
    }
    if (body?.sortOrder !== undefined) {
      const n = Number(body.sortOrder);
      if (!Number.isFinite(n)) throw new BadRequestException({ message: 'Некорректный порядок колонки' });
      sets.push(`sort_order=$${idx++}`);
      vals.push(Math.trunc(n));
    }
    if (body?.isActive !== undefined) {
      sets.push(`is_active=$${idx++}`);
      vals.push(body.isActive === true);
    }
    if (body?.notifyClient !== undefined) {
      sets.push(`notify_client=$${idx++}`);
      vals.push(body.notifyClient === true);
    }

    if (sets.length === 0) {
      const { rows } = await this.pool.query(`SELECT * FROM work_board_columns WHERE id=$1 AND tenant_id=$2`, [
        id,
        tenantID,
      ]);
      if (rows.length === 0) throw new NotFoundException({ message: 'Колонка не найдена' });
      return this.mapBoardColumn(rows[0]);
    }

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE work_board_columns SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Колонка не найдена' });
    return this.mapBoardColumn(rows[0]);
  }

  /**
   * Delete a board column. Transactional & tenant-scoped: any checks parked in
   * the column have their work_status set to NULL (taken OFF the board) BEFORE
   * the column row is deleted, so no check is left pointing at a missing column.
   * Purely board state — no money / stock / salary touched.
   */
  async deleteBoardColumn(tenantID: string, id: string): Promise<{ success: true }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT key FROM work_board_columns WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
        [id, tenantID],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Колонка не найдена' });
      }
      const key: string = rows[0].key;
      // Take any checks in this column off the board (purely the tracking flag).
      await client.query(`UPDATE checks SET work_status=NULL WHERE tenant_id=$1 AND work_status=$2`, [tenantID, key]);
      await client.query(`DELETE FROM work_board_columns WHERE id=$1 AND tenant_id=$2`, [id, tenantID]);
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw err;
    } finally {
      client.release();
    }
    return { success: true };
  }

  async create(tenantID: string, userID: string, userRole: string, dto: any) {
    if (!dto.masterId) throw new BadRequestException({ message: 'Мастер обязателен' });

    const services = dto.services || [];
    const products = dto.products || [];

    if (!dto.isDeferred && services.length === 0 && products.length === 0) {
      throw new BadRequestException({ message: 'Добавьте хотя бы одну услугу или товар' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // ── Cross-tenant integrity guard ─────────────────────────────────
      // Every referenced ID (master, client, car, services, products) MUST
      // belong to the caller's tenant. Without this, a director from
      // tenant A who knows a UUID from tenant B could persist a check
      // with foreign references — the check would land in A's listing
      // (because we set tenant_id from JWT) but JOINs would surface B's
      // client name / car plate / product name to A's masters, and
      // mutate B's product stock via the post-insert UPDATE.
      await this.assertOwnsByTenant(client, tenantID, 'users', dto.masterId, 'Мастер');
      if (dto.clientId) {
        await this.assertOwnsByTenant(client, tenantID, 'clients', dto.clientId, 'Клиент');
      }
      if (dto.carId) {
        await this.assertOwnsByTenant(client, tenantID, 'cars', dto.carId, 'Машина');
      }
      const referencedServiceIds: string[] = services
        .map((s: any) => s.serviceId)
        .filter((x: string | undefined): x is string => !!x);
      if (referencedServiceIds.length > 0) {
        await this.assertManyOwnedByTenant(client, tenantID, 'services', referencedServiceIds, 'Услуга');
      }
      const referencedProductIds: string[] = products
        .map((p: any) => p.productId)
        .filter((x: string | undefined): x is string => !!x);
      if (referencedProductIds.length > 0) {
        await this.assertManyOwnedByTenant(client, tenantID, 'products', referencedProductIds, 'Товар');
      }
      // Per-line master overrides too — masters live in users with tenant_id
      const lineMasterIds: string[] = services
        .map((s: any) => s.masterId)
        .filter((x: string | undefined): x is string => !!x);
      if (lineMasterIds.length > 0) {
        await this.assertManyOwnedByTenant(client, tenantID, 'users', lineMasterIds, 'Мастер');
      }

      // Calculate service totals and salary
      let serviceTotal = 0;
      let serviceSalaryTotal = 0;

      // Collect unique master IDs for salary lookup
      const masterIds = new Set<string>();
      masterIds.add(dto.masterId);
      for (const svc of services) {
        if (svc.masterId) masterIds.add(svc.masterId);
      }

      // Fetch salary percentages
      const salaryMap: Record<string, number> = {};
      if (masterIds.size > 0) {
        const { rows: salaryRows } = await client.query(
          `SELECT id, COALESCE(salary_percent, 0) as salary_percent FROM users WHERE id = ANY($1) AND tenant_id = $2`,
          [Array.from(masterIds), tenantID],
        );
        for (const r of salaryRows) {
          salaryMap[r.id] = parseFloat(r.salary_percent) || 0;
        }
      }

      // Fetch service master_percent overrides
      const serviceIds = services.map((s: any) => s.serviceId).filter(Boolean);
      const serviceMasterPct: Record<string, number | null> = {};
      if (serviceIds.length > 0) {
        const { rows: srvRows } = await client.query(
          `SELECT id, master_percent FROM services WHERE id = ANY($1) AND tenant_id = $2`,
          [serviceIds, tenantID],
        );
        for (const r of srvRows) {
          serviceMasterPct[r.id] =
            r.master_percent !== null && r.master_percent !== undefined ? parseFloat(r.master_percent) : null;
        }
      }

      const serviceLines: any[] = [];
      for (const svc of services) {
        const total = (svc.price || 0) * (svc.quantity || 1);
        serviceTotal += total;
        const masterId = svc.masterId || dto.masterId;
        // Service-specific percent takes priority over master default
        const serviceOverride = svc.serviceId ? serviceMasterPct[svc.serviceId] : null;
        const salaryPct = serviceOverride !== null ? serviceOverride : salaryMap[masterId] || 0;
        serviceSalaryTotal += (total * salaryPct) / 100;
        serviceLines.push({ ...svc, total, masterId });
      }

      // Calculate product totals and product commission for master
      let productTotal = 0;
      let productCostTotal = 0;
      let productSalaryTotal = 0;
      const productLines: any[] = [];

      // Fetch master's product commission settings (tenant-scoped)
      const mainMasterId = dto.masterId;
      const { rows: masterProdRows } = await client.query(
        'SELECT COALESCE(product_salary_percent, 0) as product_salary_percent FROM users WHERE id = $1 AND tenant_id = $2',
        [mainMasterId, tenantID],
      );
      const globalProductPct = parseFloat(masterProdRows[0]?.product_salary_percent) || 0;

      // Fetch product-specific commissions for this master
      const productCommissionMap: Record<string, number> = {};
      if (products.length > 0) {
        const prodIds = products.map((p: Record<string, unknown>) => p.productId).filter(Boolean);
        if (prodIds.length > 0) {
          const { rows: pcRows } = await client.query(
            `SELECT product_id, percent FROM product_commissions WHERE user_id = $1 AND product_id = ANY($2) AND tenant_id = $3`,
            [mainMasterId, prodIds, tenantID],
          );
          for (const r of pcRows) {
            productCommissionMap[r.product_id] = parseFloat(r.percent) || 0;
          }
        }
      }

      for (const prod of products) {
        const totalSell = (prod.sellPrice || 0) * (prod.quantity || 1);
        const totalCost = (prod.costPrice || 0) * (prod.quantity || 1);
        const productProfit = totalSell - totalCost;
        productTotal += totalSell;
        productCostTotal += totalCost;

        // Product commission: specific per-product % takes priority, otherwise global %
        const pct = productCommissionMap[prod.productId] ?? globalProductPct;
        if (pct > 0 && productProfit > 0) {
          productSalaryTotal += (productProfit * pct) / 100;
        }

        productLines.push({ ...prod, totalSell, totalCost });
      }

      const discount = dto.discount || 0;
      const discountedProductTotal = productTotal - discount;
      const totalRevenue = serviceTotal + (discountedProductTotal > 0 ? discountedProductTotal : 0);
      const totalCost = productCostTotal + serviceSalaryTotal + productSalaryTotal;
      const profit = totalRevenue - totalCost;

      // Parse date
      let checkDate = dto.date || new Date().toISOString();

      // Masters can only create checks for today
      if (userRole === 'master' && dto.date) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const inputDate = new Date(dto.date);
        inputDate.setHours(0, 0, 0, 0);
        if (inputDate.getTime() !== today.getTime()) {
          checkDate = new Date().toISOString();
        }
      }

      const { rows: checkRows } = await client.query(
        `INSERT INTO checks (date, master_id, client_id, car_id, mileage, comment, discount,
         is_deferred, payment_method, cash_amount, card_amount,
         service_total, product_total, total_revenue, product_cost_total,
         service_salary_total, product_salary_total, total_cost, profit, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`,
        [
          checkDate,
          dto.masterId,
          dto.clientId || null,
          dto.carId || null,
          dto.mileage || null,
          dto.comment || null,
          discount,
          dto.isDeferred || false,
          dto.paymentMethod || 'cash',
          dto.cashAmount || 0,
          dto.cardAmount || 0,
          serviceTotal,
          productTotal,
          totalRevenue,
          productCostTotal,
          serviceSalaryTotal,
          productSalaryTotal,
          totalCost,
          profit,
          tenantID,
        ],
      );

      const checkId = checkRows[0].id;

      // Insert service lines
      for (const svc of serviceLines) {
        await client.query(
          `INSERT INTO check_service_lines (check_id, service_id, master_id, name, price, quantity, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            checkId,
            svc.serviceId || null,
            svc.masterId || null,
            svc.name,
            svc.price || 0,
            svc.quantity || 1,
            svc.total,
          ],
        );
      }

      // Insert product lines and update stock
      for (const prod of productLines) {
        await client.query(
          `INSERT INTO check_product_lines (check_id, product_id, name, sell_price, cost_price, quantity, total_sell, total_cost)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            checkId,
            prod.productId || null,
            prod.name,
            prod.sellPrice || 0,
            prod.costPrice || 0,
            prod.quantity || 1,
            prod.totalSell,
            prod.totalCost,
          ],
        );

        // Decrease product stock — сток уходит в МИНУС («продажа в минус», по
        // требованию владельца): оверселл записывает дефицит, а не блокирует
        // продажу. Симметрично восстановлению стока при возврате/удалении чека.
        if (prod.productId && !dto.isDeferred) {
          await client.query(`UPDATE products SET stock = stock - $1 WHERE id = $2 AND tenant_id = $3`, [
            prod.quantity || 1,
            prod.productId,
            tenantID,
          ]);
        }
      }

      // Spawn warranty_claims rows for any product/service in this check
      // whose master record has warranty_days set. Skip for deferred
      // (drafts) checks — warranty only starts when the work is actually
      // performed / sold.
      if (!dto.isDeferred) {
        const warrantyLines: Array<{
          kind: 'product' | 'service';
          productId?: string | null;
          serviceId?: string | null;
          itemName?: string | null;
        }> = [];
        for (const svc of serviceLines) {
          if (svc.serviceId) {
            warrantyLines.push({ kind: 'service', serviceId: svc.serviceId, itemName: svc.name });
          }
        }
        for (const prod of productLines) {
          if (prod.productId) {
            warrantyLines.push({ kind: 'product', productId: prod.productId, itemName: prod.name });
          }
        }
        if (warrantyLines.length > 0) {
          await this.warranty.createFromCheckLines(
            client,
            tenantID,
            checkId,
            checkDate,
            dto.clientId || null,
            dto.carId || null,
            warrantyLines,
          );
        }
      }

      await client.query('COMMIT');

      // A new sale changes revenue/profit/ranking — drop cached aggregates so
      // the dashboard reflects it immediately instead of up to 30s late.
      this.invalidateReports(tenantID);

      // Live cross-device sync: a real (non-draft) sale moves the cash
      // position — nudge every OTHER device in the tenant to refetch. Deferred
      // drafts don't touch cash, so skip them to avoid silent-push noise.
      if (!dto.isDeferred) {
        this.emitCashChanged(tenantID, userID);
      }

      const savedCheck = await this.getById(checkId, tenantID);

      // Push notification to master when assigned by someone else
      if (this.pushService && dto.masterId && dto.masterId !== userID) {
        const checkNumber = (savedCheck as any).number;
        this.pushService
          .sendToUserCategory(
            dto.masterId,
            'check_assigned',
            'Новый заказ-наряд',
            `Назначен заказ-наряд #${checkNumber}`,
          )
          .catch(() => {
            /* non-fatal */
          });
      }

      return savedCheck;
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      // Log the full reason server-side (pino + Sentry) for diagnosis; return a
      // generic message to the client so raw SQL/internals are never exposed.
      this.logger.error(`Check create error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  async update(id: string, tenantID: string, userRole: string, dto: any, actorUserId: string | null = null) {
    // If services or products are provided, do a full re-edit (only for deferred checks)
    if (dto.services !== undefined || dto.products !== undefined) {
      return this.fullUpdate(id, tenantID, userRole, dto, actorUserId);
    }

    // Closing a deferred draft WITHOUT re-sending lines (bare `isDeferred:false`
    // toggle) is also an activation — route it through the transactional
    // activator so stock + warranties are applied on the true→false transition.
    // Any other isDeferred value (or no flip at all) falls through to the plain
    // field-update below unchanged.
    if (dto.isDeferred === false) {
      return this.activateDeferred(id, tenantID, userRole, dto, actorUserId);
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.date !== undefined) {
      if (!['director', 'admin', 'superadmin'].includes(userRole)) {
        throw new ForbiddenException({ message: 'Нет прав на изменение даты' });
      }
      sets.push(`date=$${idx++}`);
      vals.push(dto.date);
    }
    if (dto.paymentMethod !== undefined) {
      sets.push(`payment_method=$${idx++}`);
      vals.push(dto.paymentMethod);
    }
    if (dto.isDeferred !== undefined) {
      sets.push(`is_deferred=$${idx++}`);
      vals.push(dto.isDeferred);
    }
    if (dto.comment !== undefined) {
      sets.push(`comment=$${idx++}`);
      vals.push(dto.comment);
    }
    if (dto.cashAmount !== undefined) {
      sets.push(`cash_amount=$${idx++}`);
      vals.push(dto.cashAmount);
    }
    if (dto.cardAmount !== undefined) {
      sets.push(`card_amount=$${idx++}`);
      vals.push(dto.cardAmount);
    }
    if (dto.paymentStatus !== undefined) {
      sets.push(`payment_status=$${idx++}`);
      vals.push(dto.paymentStatus);
    }

    if (sets.length === 0) return this.getById(id, tenantID);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE checks SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING id, number, total_revenue, payment_status`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });

    // Payment-method / amount / status edits can move the cash-position and
    // dashboard tiles — invalidate the tenant's report caches.
    this.invalidateReports(tenantID);

    // Live cross-device sync: this edit moved the cash position — nudge every
    // OTHER device in the tenant to refetch money queries (silent, data-only).
    this.emitCashChanged(tenantID, actorUserId);

    // Push directors/admins when check is marked paid
    if (this.pushService && dto.paymentStatus === 'paid') {
      const updatedRow = rows[0];
      const totalRevenue: number = parseFloat(updatedRow.total_revenue) || 0;
      const checkNumber: number = updatedRow.number;
      const formatted = new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        maximumFractionDigits: 0,
      }).format(totalRevenue);
      const { rows: managers } = await this.pool.query(
        `SELECT id FROM users WHERE tenant_id=$1 AND role IN ('director','admin')`,
        [tenantID],
      );
      for (const mgr of managers) {
        this.pushService
          .sendToUserCategory(mgr.id, 'check_closed', 'Чек закрыт', `Чек #${checkNumber} закрыт — ${formatted}`)
          .catch(() => {
            /* non-fatal */
          });
      }
    }

    return this.getById(id, tenantID);
  }

  /**
   * Close a deferred draft via a bare `isDeferred:false` toggle (no line
   * arrays). Flips the flag and applies the SAME activation side-effects as
   * fullUpdate — stock decrement + warranty creation — but only on a genuine
   * is_deferred true→false transition (authority = prior is_deferred read from
   * the DB inside the transaction).
   *
   * Idempotent / double-spend safe:
   *   - if the check is ALREADY active (no transition), this is a plain field
   *     update — no stock touched, no warranties created;
   *   - applyDeferredActivation itself skips warranties when any already exist.
   *
   * Permission: a master may close only THEIR OWN draft; director/admin/
   * superadmin may close any.
   */
  private async activateDeferred(id: string, tenantID: string, userRole: string, dto: any, actorUserId: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the row so two concurrent closes can't both observe
      // is_deferred=true and both decrement stock / create warranties.
      const { rows: checkRows } = await client.query('SELECT * FROM checks WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
        id,
        tenantID,
      ]);
      if (checkRows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Заказ-наряд не найден' });
      }

      // Authority for the transition is the prior persisted flag. The caller
      // only routes here when dto.isDeferred === false, so a currently-deferred
      // check means a genuine true→false activation; an already-active check is
      // a no-op re-save that must NOT re-apply effects.
      const isActivating = checkRows[0].is_deferred === true;

      // PERMISSION: master can close only their own draft.
      if (isActivating && userRole === 'master') {
        if (!actorUserId || String(checkRows[0].master_id) !== String(actorUserId)) {
          await client.query('ROLLBACK');
          throw new ForbiddenException({ message: 'Мастер может закрывать только свой отложенный заказ-наряд' });
        }
      }

      // Build the field update (the same fields the plain path supports for a
      // close), always including is_deferred=false.
      const sets: string[] = ['is_deferred=false'];
      const vals: any[] = [];
      let ui = 1;
      // ACCOUNTING: on a genuine draft→active transition the check's date must
      // move to the moment of activation (payment), so revenue / salary /
      // cash-flow reports and the warranty start all land on the activation day
      // — NOT the day the draft was created. created_at is left untouched (audit).
      // Strictly gated by `isActivating` (prior is_deferred under FOR UPDATE),
      // so a plain re-save of an already-active check never rewrites the date.
      // ONE timestamp, parameterised — reused for the warranty below so
      // checks.date and warranty.started_at are byte-identical (no now()-vs-JS skew).
      const activationDate = new Date().toISOString();
      if (isActivating) {
        sets.push(`date=$${ui++}`);
        vals.push(activationDate);
      }
      if (dto.paymentMethod !== undefined) {
        sets.push(`payment_method=$${ui++}`);
        vals.push(dto.paymentMethod);
      }
      if (dto.comment !== undefined) {
        sets.push(`comment=$${ui++}`);
        vals.push(dto.comment);
      }
      if (dto.cashAmount !== undefined) {
        sets.push(`cash_amount=$${ui++}`);
        vals.push(dto.cashAmount);
      }
      if (dto.cardAmount !== undefined) {
        sets.push(`card_amount=$${ui++}`);
        vals.push(dto.cardAmount);
      }
      if (dto.paymentStatus !== undefined) {
        sets.push(`payment_status=$${ui++}`);
        vals.push(dto.paymentStatus);
      }
      vals.push(id, tenantID);
      await client.query(`UPDATE checks SET ${sets.join(', ')} WHERE id=$${ui++} AND tenant_id=$${ui}`, vals);

      // Side-effects ONLY on the real transition.
      if (isActivating) {
        // checks.date was just set to `activationDate` above; the warranty starts
        // from the SAME timestamp (not the stale draft date).
        await this.applyDeferredActivation(
          client,
          tenantID,
          id,
          activationDate,
          checkRows[0].client_id ?? null,
          checkRows[0].car_id ?? null,
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back above */
      }
      throw err;
    } finally {
      client.release();
    }

    this.invalidateReports(tenantID);
    this.emitCashChanged(tenantID, actorUserId);
    return this.getById(id, tenantID);
  }

  private async fullUpdate(
    id: string,
    tenantID: string,
    userRole: string,
    dto: any,
    actorUserId: string | null = null,
  ) {
    // Verify check exists and is deferred
    const { rows: checkRows } = await this.pool.query('SELECT * FROM checks WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (checkRows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
    // Prior persisted state — the authority for the true→false transition.
    const wasDeferred: boolean = checkRows[0].is_deferred === true;
    if (!wasDeferred) {
      throw new ForbiddenException({ message: 'Редактирование доступно только для отложенных чеков' });
    }

    // A genuine activation = this draft is being closed (is_deferred true→false).
    // `dto.isDeferred` is OPTIONAL: only an explicit `false` flips the flag; if
    // the caller omits it the draft stays a draft and no effects fire.
    const isActivating = wasDeferred && dto.isDeferred === false;

    // PERMISSION: a master may only close (activate) THEIR OWN draft. Plain
    // re-edits of a still-deferred draft keep the existing rules; the extra
    // gate applies only to the close transition. Director/admin/superadmin may
    // close any draft. actorUserId is the JWT userID of the caller.
    if (isActivating && userRole === 'master') {
      if (!actorUserId || String(checkRows[0].master_id) !== String(actorUserId)) {
        throw new ForbiddenException({ message: 'Мастер может закрывать только свой отложенный заказ-наряд' });
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Re-read the prior is_deferred under a row lock so two concurrent closes
      // can't BOTH see is_deferred=true and both decrement stock. The locked
      // value is the authority for whether to fire activation effects below.
      const { rows: lockedRows } = await client.query(
        'SELECT is_deferred FROM checks WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [id, tenantID],
      );
      if (lockedRows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
      const lockedIsActivating = lockedRows[0].is_deferred === true && dto.isDeferred === false;

      const services = dto.services || [];
      const products = dto.products || [];

      // ── Cross-tenant integrity guard (same as create()) ───────────────
      // fullUpdate persists client-supplied master/client/car/service/product
      // IDs — without these checks a caller could attach foreign-tenant rows
      // and getById's JOINs would surface that tenant's data.
      if (dto.masterId) {
        await this.assertOwnsByTenant(client, tenantID, 'users', dto.masterId, 'Мастер');
      }
      if (dto.clientId) {
        await this.assertOwnsByTenant(client, tenantID, 'clients', dto.clientId, 'Клиент');
      }
      if (dto.carId) {
        await this.assertOwnsByTenant(client, tenantID, 'cars', dto.carId, 'Машина');
      }
      const referencedServiceIds: string[] = services
        .map((s: any) => s.serviceId)
        .filter((x: string | undefined): x is string => !!x);
      if (referencedServiceIds.length > 0) {
        await this.assertManyOwnedByTenant(client, tenantID, 'services', referencedServiceIds, 'Услуга');
      }
      const referencedProductIds: string[] = products
        .map((p: any) => p.productId)
        .filter((x: string | undefined): x is string => !!x);
      if (referencedProductIds.length > 0) {
        await this.assertManyOwnedByTenant(client, tenantID, 'products', referencedProductIds, 'Товар');
      }
      const lineMasterIds: string[] = services
        .map((s: any) => s.masterId)
        .filter((x: string | undefined): x is string => !!x);
      if (lineMasterIds.length > 0) {
        await this.assertManyOwnedByTenant(client, tenantID, 'users', lineMasterIds, 'Мастер');
      }

      // Calculate service totals and salary
      let serviceTotal = 0;
      let serviceSalaryTotal = 0;

      const masterIds = new Set<string>();
      if (dto.masterId) masterIds.add(dto.masterId);
      const existingMasterId = checkRows[0].master_id;
      if (existingMasterId) masterIds.add(existingMasterId);
      for (const svc of services) {
        if (svc.masterId) masterIds.add(svc.masterId);
      }

      const salaryMap: Record<string, number> = {};
      if (masterIds.size > 0) {
        const { rows: salaryRows } = await client.query(
          `SELECT id, COALESCE(salary_percent, 0) as salary_percent FROM users WHERE id = ANY($1) AND tenant_id = $2`,
          [Array.from(masterIds), tenantID],
        );
        for (const r of salaryRows) {
          salaryMap[r.id] = parseFloat(r.salary_percent) || 0;
        }
      }

      // Service-specific percent overrides
      const serviceIds = services.map((s: any) => s.serviceId).filter(Boolean);
      const serviceMasterPct: Record<string, number | null> = {};
      if (serviceIds.length > 0) {
        const { rows: srvRows } = await client.query(
          `SELECT id, master_percent FROM services WHERE id = ANY($1) AND tenant_id = $2`,
          [serviceIds, tenantID],
        );
        for (const r of srvRows) {
          serviceMasterPct[r.id] =
            r.master_percent !== null && r.master_percent !== undefined ? parseFloat(r.master_percent) : null;
        }
      }

      const serviceLines: any[] = [];
      const primaryMasterId = dto.masterId || existingMasterId;
      for (const svc of services) {
        const total = (svc.price || 0) * (svc.quantity || 1);
        serviceTotal += total;
        const masterId = svc.masterId || primaryMasterId;
        const serviceOverride = svc.serviceId ? serviceMasterPct[svc.serviceId] : null;
        const salaryPct = serviceOverride !== null ? serviceOverride : salaryMap[masterId] || 0;
        serviceSalaryTotal += (total * salaryPct) / 100;
        serviceLines.push({ ...svc, total, masterId });
      }

      // Calculate product totals and product commission
      let productTotal = 0;
      let productCostTotal = 0;
      let productSalaryTotal = 0;
      const productLines: any[] = [];

      // Fetch master's product commission settings (tenant-scoped)
      const { rows: masterProdRows } = await client.query(
        'SELECT COALESCE(product_salary_percent, 0) as product_salary_percent FROM users WHERE id = $1 AND tenant_id = $2',
        [primaryMasterId, tenantID],
      );
      const globalProductPct = parseFloat(masterProdRows[0]?.product_salary_percent) || 0;

      const productCommissionMap: Record<string, number> = {};
      if (products.length > 0) {
        const prodIds = products.map((p: Record<string, unknown>) => p.productId).filter(Boolean);
        if (prodIds.length > 0) {
          const { rows: pcRows } = await client.query(
            `SELECT product_id, percent FROM product_commissions WHERE user_id = $1 AND product_id = ANY($2) AND tenant_id = $3`,
            [primaryMasterId, prodIds, tenantID],
          );
          for (const r of pcRows) {
            productCommissionMap[r.product_id] = parseFloat(r.percent) || 0;
          }
        }
      }

      for (const prod of products) {
        const totalSell = (prod.sellPrice || 0) * (prod.quantity || 1);
        const totalCost = (prod.costPrice || 0) * (prod.quantity || 1);
        const productProfit = totalSell - totalCost;
        productTotal += totalSell;
        productCostTotal += totalCost;

        const pct = productCommissionMap[prod.productId] ?? globalProductPct;
        if (pct > 0 && productProfit > 0) {
          productSalaryTotal += (productProfit * pct) / 100;
        }

        productLines.push({ ...prod, totalSell, totalCost });
      }

      const discount = dto.discount ?? (parseFloat(checkRows[0].discount) || 0);
      const discountedProductTotal = productTotal - discount;
      const totalRevenue = serviceTotal + (discountedProductTotal > 0 ? discountedProductTotal : 0);
      const totalCost = productCostTotal + serviceSalaryTotal + productSalaryTotal;
      const profit = totalRevenue - totalCost;

      // Update check record
      const updateFields: string[] = [];
      const updateVals: any[] = [];
      let ui = 1;

      if (dto.masterId !== undefined) {
        updateFields.push(`master_id=$${ui++}`);
        updateVals.push(dto.masterId);
      }
      if (dto.clientId !== undefined) {
        updateFields.push(`client_id=$${ui++}`);
        updateVals.push(dto.clientId || null);
      }
      if (dto.carId !== undefined) {
        updateFields.push(`car_id=$${ui++}`);
        updateVals.push(dto.carId || null);
      }
      if (dto.mileage !== undefined) {
        updateFields.push(`mileage=$${ui++}`);
        updateVals.push(dto.mileage || null);
      }
      if (dto.comment !== undefined) {
        updateFields.push(`comment=$${ui++}`);
        updateVals.push(dto.comment || null);
      }
      if (dto.discount !== undefined) {
        updateFields.push(`discount=$${ui++}`);
        updateVals.push(dto.discount || 0);
      }
      if (dto.paymentMethod !== undefined) {
        updateFields.push(`payment_method=$${ui++}`);
        updateVals.push(dto.paymentMethod);
      }
      if (dto.cashAmount !== undefined) {
        updateFields.push(`cash_amount=$${ui++}`);
        updateVals.push(dto.cashAmount || 0);
      }
      if (dto.cardAmount !== undefined) {
        updateFields.push(`card_amount=$${ui++}`);
        updateVals.push(dto.cardAmount || 0);
      }
      if (dto.isDeferred !== undefined) {
        updateFields.push(`is_deferred=$${ui++}`);
        updateVals.push(dto.isDeferred);
      }

      // ACCOUNTING: on a genuine draft→active transition (is_deferred true→false,
      // authority = lockedIsActivating from the FOR UPDATE read) move the check's
      // date to the moment of activation (payment). That way revenue / salary /
      // cash-flow reports and the warranty start land on the activation day, not
      // the draft-creation day. created_at is left untouched (audit trail). A
      // plain re-edit of an already-active check (lockedIsActivating=false) never
      // rewrites the date; this is the only place fullUpdate touches `date`.
      // ONE timestamp, parameterised — reused for the warranty below so
      // checks.date and warranty.started_at are byte-identical (no now()-vs-JS
      // skew, which in fullUpdate would otherwise be 10-100ms+ apart across the
      // line DELETE/INSERTs between the UPDATE and the warranty call).
      const activationDate = new Date().toISOString();
      if (lockedIsActivating) {
        updateFields.push(`date=$${ui++}`);
        updateVals.push(activationDate);
      }

      // Always update calculated fields
      updateFields.push(`service_total=$${ui++}`);
      updateVals.push(serviceTotal);
      updateFields.push(`product_total=$${ui++}`);
      updateVals.push(productTotal);
      updateFields.push(`total_revenue=$${ui++}`);
      updateVals.push(totalRevenue);
      updateFields.push(`product_cost_total=$${ui++}`);
      updateVals.push(productCostTotal);
      updateFields.push(`service_salary_total=$${ui++}`);
      updateVals.push(serviceSalaryTotal);
      updateFields.push(`product_salary_total=$${ui++}`);
      updateVals.push(productSalaryTotal);
      updateFields.push(`total_cost=$${ui++}`);
      updateVals.push(totalCost);
      updateFields.push(`profit=$${ui++}`);
      updateVals.push(profit);

      updateVals.push(id, tenantID);
      await client.query(
        `UPDATE checks SET ${updateFields.join(', ')} WHERE id=$${ui++} AND tenant_id=$${ui}`,
        updateVals,
      );

      // Delete existing lines and re-insert
      await client.query('DELETE FROM check_service_lines WHERE check_id=$1', [id]);
      await client.query('DELETE FROM check_product_lines WHERE check_id=$1', [id]);

      for (const svc of serviceLines) {
        await client.query(
          `INSERT INTO check_service_lines (check_id, service_id, master_id, name, price, quantity, total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, svc.serviceId || null, svc.masterId || null, svc.name, svc.price || 0, svc.quantity || 1, svc.total],
        );
      }

      for (const prod of productLines) {
        await client.query(
          `INSERT INTO check_product_lines (check_id, product_id, name, sell_price, cost_price, quantity, total_sell, total_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            prod.productId || null,
            prod.name,
            prod.sellPrice || 0,
            prod.costPrice || 0,
            prod.quantity || 1,
            prod.totalSell,
            prod.totalCost,
          ],
        );
      }

      // ── Deferred → active side-effects ───────────────────────────────────
      // ONLY on the genuine true→false transition: now that the final lines are
      // persisted (deleted + re-inserted above), decrement stock and spawn
      // warranties exactly like create() does for a non-deferred sale. Runs in
      // THIS transaction so stock + warranties + the check commit atomically.
      // Idempotent: gated by the prior is_deferred from the DB, and warranties
      // are skipped if any already exist for this check (no double-spend, no
      // duplicate guarantees on a re-save).
      if (lockedIsActivating) {
        const effectiveClientId = dto.clientId !== undefined ? dto.clientId || null : (checkRows[0].client_id ?? null);
        const effectiveCarId = dto.carId !== undefined ? dto.carId || null : (checkRows[0].car_id ?? null);
        // checks.date was set to `activationDate` in the UPDATE above; the warranty
        // starts from that SAME timestamp (not the stale draft date).
        await this.applyDeferredActivation(client, tenantID, id, activationDate, effectiveClientId, effectiveCarId);
      }

      await client.query('COMMIT');
      this.invalidateReports(tenantID);
      // Re-editing a check's lines (and/or closing a deferred draft) moves the
      // cash position — nudge other devices to refetch (silent, data-only).
      this.emitCashChanged(tenantID, actorUserId);
      return this.getById(id, tenantID);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async remove(id: string, tenantID: string, userRole: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the check row for the lifetime of the delete so a concurrent
      // edit/return/delete can't race the stock restore below.
      const { rows } = await client.query(
        'SELECT is_deferred, is_returned FROM checks WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [id, tenantID],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
      if (userRole === 'master' && !rows[0].is_deferred) {
        throw new ForbiddenException({ message: 'Мастер не может удалить закрытый заказ-наряд' });
      }

      // Restore stock for a sale that ACTUALLY took stock and hasn't already
      // been reversed. A deferred draft never decremented stock; a returned
      // check already had its stock added back (warehouse return) or sent to
      // defect (defect return) — restoring again would double-count. So we
      // only add back when the check is a live, non-returned sale. The
      // `stock = stock + qty` is an atomic row update (no read-then-write
      // race). Deleting the check itself reverses its revenue (the row is
      // gone), so no financial unwind is needed here.
      if (!rows[0].is_deferred && !rows[0].is_returned) {
        const { rows: lines } = await client.query(
          'SELECT product_id, quantity FROM check_product_lines WHERE check_id=$1 AND product_id IS NOT NULL',
          [id],
        );
        for (const ln of lines) {
          const qty = parseFloat(ln.quantity) || 0;
          if (qty <= 0) continue;
          await client.query('UPDATE products SET stock = stock + $1 WHERE id=$2 AND tenant_id=$3', [
            qty,
            ln.product_id,
            tenantID,
          ]);
        }
      }

      await client.query('DELETE FROM checks WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    this.invalidateReports(tenantID);
    return { message: 'Удалено' };
  }

  async getDashboard(tenantID: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 1).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= $2 THEN total_revenue END), 0) as today_revenue,
         COALESCE(COUNT(CASE WHEN date >= $2 THEN 1 END), 0) as today_checks,
         COALESCE(SUM(CASE WHEN date >= $3 THEN total_revenue END), 0) as week_revenue,
         COALESCE(SUM(CASE WHEN date >= $4 THEN total_revenue END), 0) as month_revenue,
         COALESCE(SUM(CASE WHEN date >= $2 THEN profit END), 0) as today_profit,
         COALESCE(SUM(CASE WHEN date >= $4 THEN profit END), 0) as month_profit
       FROM checks
       WHERE tenant_id=$1 AND is_deferred=false`,
      [tenantID, todayStart, weekStart, monthStart],
    );

    const r = rows[0];
    return {
      todayRevenue: parseFloat(r.today_revenue) || 0,
      todayChecks: parseInt(r.today_checks) || 0,
      weekRevenue: parseFloat(r.week_revenue) || 0,
      monthRevenue: parseFloat(r.month_revenue) || 0,
      todayProfit: parseFloat(r.today_profit) || 0,
      monthProfit: parseFloat(r.month_profit) || 0,
    };
  }

  async getDashboardChart(tenantID: string, period: string, offset: number = 0) {
    // 30s cache, in-flight de-duplicated (see TtlCache.wrap). Invalidated on
    // any check create/update/delete via `reports:<tenant>` prefix purge, so a
    // sale shows up immediately rather than up to 30s late.
    return ttlCache.wrap(`reports:dashboard-chart:${tenantID}:${period}:${offset}`, 30_000, () =>
      this.computeDashboardChart(tenantID, period, offset),
    );
  }

  private async computeDashboardChart(tenantID: string, period: string, offset: number = 0) {
    let dateFrom: Date;
    let dateTo: Date;
    const now = new Date();

    switch (period) {
      case 'today': {
        const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        dateFrom = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        dateTo = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59);
        break;
      }
      case 'week': {
        const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
        const mondayOffset = 1 - dayOfWeek;
        const baseMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset + offset * 7);
        dateFrom = new Date(baseMonday.getFullYear(), baseMonday.getMonth(), baseMonday.getDate());
        dateTo = new Date(baseMonday.getFullYear(), baseMonday.getMonth(), baseMonday.getDate() + 6, 23, 59, 59);
        break;
      }
      case 'month': {
        const baseMonth = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        dateFrom = new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1);
        dateTo = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 0, 23, 59, 59);
        break;
      }
      case 'year': {
        const baseYear = now.getFullYear() + offset;
        dateFrom = new Date(baseYear, 0, 1);
        dateTo = new Date(baseYear, 11, 31, 23, 59, 59);
        break;
      }
      default: {
        const dow = now.getDay() === 0 ? 7 : now.getDay();
        const mo = 1 - dow;
        const bm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mo + offset * 7);
        dateFrom = new Date(bm.getFullYear(), bm.getMonth(), bm.getDate());
        dateTo = new Date(bm.getFullYear(), bm.getMonth(), bm.getDate() + 6, 23, 59, 59);
      }
    }

    const { rows } = await this.pool.query(
      `SELECT date::date as day,
              COALESCE(SUM(total_revenue), 0) as revenue,
              COALESCE(SUM(profit), 0) as profit,
              COUNT(*) as check_count
       FROM checks
       WHERE tenant_id=$1 AND date >= $2 AND date <= $3 AND is_deferred=false
       GROUP BY date::date
       ORDER BY day`,
      [tenantID, dateFrom.toISOString(), dateTo.toISOString()],
    );

    // Build lookup from query results
    const dataMap: Record<string, { revenue: number; profit: number; checkCount: number }> = {};
    let totalRevenue = 0,
      totalProfit = 0,
      totalChecks = 0;
    for (const r of rows) {
      const key = typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10);
      const revenue = parseFloat(r.revenue) || 0;
      const profit = parseFloat(r.profit) || 0;
      const checkCount = parseInt(r.check_count) || 0;
      dataMap[key] = { revenue, profit, checkCount };
      totalRevenue += revenue;
      totalProfit += profit;
      totalChecks += checkCount;
    }

    // Fill in all time slots so the chart always has a complete axis
    const points: Array<{ date: string; revenue: number; profit: number; checkCount: number }> = [];

    if (period === 'today') {
      for (let h = 0; h < 24; h++) {
        const d = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate(), h);
        const key = d.toISOString().slice(0, 10);
        // For hourly, we need to re-query per hour — instead, use the daily total spread across existing data
        points.push({ date: d.toISOString(), revenue: 0, profit: 0, checkCount: 0 });
      }
      // Overlay actual hourly data from a separate query
      const { rows: hourlyRows } = await this.pool.query(
        `SELECT EXTRACT(HOUR FROM date) as hour,
                COALESCE(SUM(total_revenue), 0) as revenue,
                COALESCE(SUM(profit), 0) as profit,
                COUNT(*) as check_count
         FROM checks
         WHERE tenant_id=$1 AND date >= $2 AND date <= $3 AND is_deferred=false
         GROUP BY EXTRACT(HOUR FROM date)
         ORDER BY hour`,
        [tenantID, dateFrom.toISOString(), dateTo.toISOString()],
      );
      for (const hr of hourlyRows) {
        const idx = parseInt(hr.hour);
        if (idx >= 0 && idx < 24) {
          points[idx].revenue = parseFloat(hr.revenue) || 0;
          points[idx].profit = parseFloat(hr.profit) || 0;
          points[idx].checkCount = parseInt(hr.check_count) || 0;
        }
      }
    } else if (period === 'year') {
      for (let m = 0; m < 12; m++) {
        const d = new Date(dateFrom.getFullYear(), m, 1);
        const key = d.toISOString().slice(0, 7); // yyyy-MM
        // Sum all matching days in this month
        let rev = 0,
          prof = 0,
          cc = 0;
        for (const [dk, dv] of Object.entries(dataMap)) {
          if (dk.startsWith(key)) {
            rev += dv.revenue;
            prof += dv.profit;
            cc += dv.checkCount;
          }
        }
        points.push({
          date: `${dateFrom.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`,
          revenue: rev,
          profit: prof,
          checkCount: cc,
        });
      }
    } else {
      // week / month — fill each day
      const cursor = new Date(dateFrom);
      while (cursor <= dateTo) {
        const key = cursor.toISOString().slice(0, 10);
        const d = dataMap[key] || { revenue: 0, profit: 0, checkCount: 0 };
        points.push({ date: key, ...d });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return { points, totalRevenue, totalProfit, totalChecks };
  }

  /**
   * Returns the most recent (non-deferred) check for the given client/car.
   * Either or both filters can be set; if both are passed, the check must
   * match both. Used by the cash screen to show "Последний визит".
   */
  async getLastVisit(
    tenantID: string,
    filters: { clientId?: string; carId?: string },
  ): Promise<{
    id: string;
    date: string;
    number: number;
    totalRevenue: number;
    masterName: string | null;
    carPlate: string | null;
    carMakeModel: string | null;
  } | null> {
    const conds: string[] = ['ch.tenant_id = $1'];
    const params: unknown[] = [tenantID];
    let idx = 2;
    if (filters.clientId) {
      conds.push(`ch.client_id = $${idx++}`);
      params.push(filters.clientId);
    }
    if (filters.carId) {
      conds.push(`ch.car_id = $${idx++}`);
      params.push(filters.carId);
    }
    if (!filters.clientId && !filters.carId) {
      return null;
    }

    const { rows } = await this.pool.query(
      `SELECT
         ch.id, ch.number, ch.date, ch.total_revenue,
         u.full_name AS master_name,
         ca.plate_number AS car_plate,
         ca.make_model AS car_make_model
       FROM checks ch
       LEFT JOIN users u ON u.id = ch.master_id
       LEFT JOIN cars ca ON ca.id = ch.car_id
       WHERE ${conds.join(' AND ')}
       ORDER BY ch.date DESC, ch.number DESC
       LIMIT 1`,
      params,
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id as string,
      date: r.date as string,
      number: r.number as number,
      totalRevenue: parseFloat(r.total_revenue) || 0,
      masterName: (r.master_name as string) || null,
      carPlate: (r.car_plate as string) || null,
      carMakeModel: (r.car_make_model as string) || null,
    };
  }

  async getRanking(tenantID: string) {
    // Same 30s cache + in-flight de-dup + write-side invalidation as the chart.
    return ttlCache.wrap(`reports:ranking:${tenantID}`, 30_000, () => this.computeRanking(tenantID));
  }

  private async computeRanking(tenantID: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { rows: todayRows } = await this.pool.query(
      `SELECT ch.master_id, u.full_name as master_name,
              COALESCE(SUM(ch.total_revenue), 0) as revenue,
              COUNT(*) as check_count
       FROM checks ch JOIN users u ON u.id = ch.master_id
       WHERE ch.tenant_id=$1 AND ch.date >= $2 AND ch.is_deferred=false
       GROUP BY ch.master_id, u.full_name
       ORDER BY revenue DESC`,
      [tenantID, todayStart],
    );

    const { rows: monthRows } = await this.pool.query(
      `SELECT ch.master_id, u.full_name as master_name,
              COALESCE(SUM(ch.total_revenue), 0) as revenue,
              COUNT(*) as check_count
       FROM checks ch JOIN users u ON u.id = ch.master_id
       WHERE ch.tenant_id=$1 AND ch.date >= $2 AND ch.is_deferred=false
       GROUP BY ch.master_id, u.full_name
       ORDER BY revenue DESC`,
      [tenantID, monthStart],
    );

    return {
      today: todayRows.map((r) => ({
        masterId: r.master_id,
        masterName: r.master_name,
        revenue: parseFloat(r.revenue) || 0,
        checkCount: parseInt(r.check_count) || 0,
      })),
      month: monthRows.map((r) => ({
        masterId: r.master_id,
        masterName: r.master_name,
        revenue: parseFloat(r.revenue) || 0,
        checkCount: parseInt(r.check_count) || 0,
      })),
    };
  }
}
