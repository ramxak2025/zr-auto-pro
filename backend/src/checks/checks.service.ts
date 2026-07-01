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
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { WarrantyService } from '../warranty/warranty.service';
import { PushService } from '../push/push.service';
import { MarketingService } from '../marketing/marketing.service';
import { InstallmentsService } from '../installments/installments.service';
import { AuditService } from '../tenants/audit.service';
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
 * Round a money value to 2 decimals (half-away-from-zero, guarded against binary
 * float artefacts). Used so each baked per-line service salary is a real 2-decimal
 * amount whose sum equals the check's stored service_salary_total exactly (#56).
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
    // Рассрочка: when a check is sold with paymentMethod 'installment', the plan
    // is created INSIDE the create() transaction via createPlanForCheckTx — so
    // the sale and the debt obligation are atomic. @Optional mirrors the other
    // injected services; ChecksModule wires it in, so it's present in practice.
    @Optional() private installments?: InstallmentsService,
    // Audit trail for the CLOSED-check money edit (#61). @Optional mirrors the
    // other cross-module injections; ChecksModule imports TenantsModule so it is
    // present in practice. editClosedCheck writes its audit row transactionally
    // (AuditService.logTx) — and, if this were ever absent, falls back to an
    // inline transactional INSERT so a committed money edit is NEVER un-audited.
    @Optional() private audit?: AuditService,
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

    // ── 1b) «Мотивация»: accrue promo-product bonuses (095) ────────────────
    // A deferred draft becoming active IS the payment moment — accrue here so
    // BOTH close paths (activateDeferred + fullUpdate, the only callers of this
    // method, each gated on a genuine true→false transition) credit the master
    // exactly once. Placed before the warranty early-return below so it always
    // runs on activation. No-op for a tenant with no active promos.
    await this.accrueMotivationPromos(client, tenantID, checkId);

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

  /**
   * «Мотивация сотрудников» (095) — accrue promo-product bonuses for a check at
   * the moment it becomes PAID. Runs INSIDE the caller's (row-locked or
   * freshly-inserted) transaction so the bonus and the sale commit together — or
   * both roll back. ADDITIVE: a tenant with no active promos produces zero rows
   * and zero behaviour change, so the salary output stays byte-identical.
   *
   * For every product line whose product is an ACTIVE promo (within its optional
   * window) the bonus = percent × MARGIN, where MARGIN = Σ(total_sell − total_cost)
   * over that product's lines on the check — i.e. (sell − cost) × qty, the SAME
   * per-line margin the existing product commission uses. Lines are aggregated per
   * product (one accrual per product), and only POSITIVE-margin promos are written,
   * so an unknown/zero cost or a loss never yields a negative bonus.
   *
   * ATTRIBUTION: employee_id = checks.master_id — mirrors EXACTLY how payroll
   * attributes product revenue (SalaryService sums checks.product_salary_total by
   * checks.master_id; the create-time product commission is likewise keyed on the
   * check's master). master_id is read transactionally from the check row, so a
   * master reassigned during a fullUpdate close is honoured.
   *
   * IDEMPOTENT: clears this check's accruals first, then re-derives — so a re-pay /
   * re-close can never double-credit. The DELETE+INSERT is atomic within the
   * caller's transaction; the unique index (095) is the DB-level backstop.
   */
  private async accrueMotivationPromos(client: PoolClient, tenantID: string, checkId: string): Promise<void> {
    await client.query('DELETE FROM motivation_accruals WHERE tenant_id = $1 AND check_id = $2', [tenantID, checkId]);
    await client.query(
      `INSERT INTO motivation_accruals
         (tenant_id, employee_id, check_id, product_id, qty, margin_base, percent, amount, accrued_at)
       SELECT c.tenant_id, c.master_id, c.id, agg.product_id, agg.qty,
              agg.margin_base, agg.percent,
              ROUND(agg.margin_base * agg.percent / 100.0, 2), now()
         FROM checks c
         JOIN (
           SELECT pl.product_id,
                  SUM(pl.quantity)                        AS qty,
                  SUM(pl.total_sell) - SUM(pl.total_cost) AS margin_base,
                  MAX(mp.percent)                         AS percent
             FROM check_product_lines pl
             JOIN motivation_promo_products mp
               ON mp.tenant_id  = $1
              AND mp.product_id = pl.product_id
              AND mp.active     = true
              AND (mp.starts_at IS NULL OR mp.starts_at <= now())
              AND (mp.ends_at   IS NULL OR mp.ends_at   >= now())
            WHERE pl.check_id = $2 AND pl.product_id IS NOT NULL
            GROUP BY pl.product_id
         ) agg ON true
        WHERE c.id = $2 AND c.tenant_id = $1 AND c.master_id IS NOT NULL
          AND agg.margin_base > 0 AND agg.percent > 0`,
      [tenantID, checkId],
    );
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

  // ── POS «Кассовая смена + роли» (092) ─────────────────────────────────────
  // Strictly additive + mode-gated. Every enforcement below is a no-op when the
  // tenant's shift_mode_enabled is false (the default), so the OFF path is
  // byte-for-byte the current check/payment flow.

  /**
   * Is the tenant's POS shift-mode ON? Single PK lookup. FAIL-OPEN to `false`
   * (current behaviour) on any error — the shift-mode gate must never be the
   * reason a check write fails when the column/row can't be read.
   */
  private async isShiftModeEnabled(tenantID: string): Promise<boolean> {
    try {
      const { rows } = await this.pool.query(`SELECT shift_mode_enabled FROM tenants WHERE id = $1`, [tenantID]);
      return rows[0]?.shift_mode_enabled === true;
    } catch (err) {
      this.logger.error(`isShiftModeEnabled read failed for tenant=${tenantID}: ${err}`);
      return false;
    }
  }

  /**
   * Is the actor a cashier (may accept payment / close a check)? Owner-class
   * roles (director/admin/superadmin) are implicit cashiers; a master is a
   * cashier only with the explicit `accept_payment` permission. Reuses the same
   * pure resolver the PermissionsGuard uses, so the rule is identical everywhere.
   */
  private isCashier(actor?: { role?: string; permissions?: Record<string, boolean> }): boolean {
    return userHasPermission(actor, 'accept_payment');
  }

  /**
   * Guard the "take payment" actions (close a draft / record cash/card / mark
   * paid). No-op when shift-mode is OFF. When ON, only a cashier may proceed.
   */
  private async assertCashierForPayment(
    tenantID: string,
    actor?: { role?: string; permissions?: Record<string, boolean> },
  ): Promise<void> {
    if (!(await this.isShiftModeEnabled(tenantID))) return;
    if (this.isCashier(actor)) return;
    throw new ForbiddenException({ message: 'Принять оплату и закрыть заказ-наряд может только кассир смены' });
  }

  /**
   * GET /checks/pos-settings — mode flag + the caller's resolved cashier
   * capability (so a client can pick the master order-create flow / tab bar
   * without re-deriving the rule).
   */
  async getPosSettings(
    tenantID: string,
    actor?: { role?: string; permissions?: Record<string, boolean> },
  ): Promise<{ shiftModeEnabled: boolean; isCashier: boolean }> {
    const shiftModeEnabled = await this.isShiftModeEnabled(tenantID);
    return { shiftModeEnabled, isCashier: this.isCashier(actor) };
  }

  /** PATCH /checks/pos-settings — owner-gated flip of the per-tenant flag. */
  async updatePosSettings(
    tenantID: string,
    dto: { shiftModeEnabled?: boolean },
  ): Promise<{ shiftModeEnabled: boolean }> {
    if (dto?.shiftModeEnabled !== undefined) {
      await this.pool.query(`UPDATE tenants SET shift_mode_enabled = $1, updated_at = now() WHERE id = $2`, [
        dto.shiftModeEnabled === true,
        tenantID,
      ]);
    }
    return { shiftModeEnabled: await this.isShiftModeEnabled(tenantID) };
  }

  /**
   * PRODUCT PRICE LOCK (092 — correctness rule, applies in EVERY mode, both
   * shift-mode ON and OFF). Load the CURRENT warehouse `sell_price` for the
   * referenced products so a check's product-line price is authoritative from
   * the warehouse and never trusted from the client («цена товара = склад,
   * менять нельзя — только скидка»). Services keep their master-set prices; the
   * `discount` field stays the only lever that reduces the product total.
   *
   * Returns a map productId → sell_price ONLY for products with a POSITIVE
   * warehouse price. A product with no / zero warehouse price is OMITTED so the
   * caller falls back to the client-sent price — a legitimate sale is never
   * silently zeroed out. In the normal flow the cash screen already picks the
   * product at its warehouse price, so the override is a pure no-op; only a
   * stale / manipulated client price is corrected.
   */
  private async loadWarehouseSellPrices(
    client: PoolClient,
    tenantID: string,
    productIds: string[],
  ): Promise<Record<string, number>> {
    const map: Record<string, number> = {};
    if (productIds.length === 0) return map;
    const { rows } = await client.query(`SELECT id, sell_price FROM products WHERE id = ANY($1) AND tenant_id = $2`, [
      productIds,
      tenantID,
    ]);
    for (const r of rows) {
      const price = parseFloat(r.sell_price);
      if (Number.isFinite(price) && price > 0) map[r.id] = price;
    }
    return map;
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
      // Корзина (106): NULL on every live check. A trashed check never reaches
      // the normal list/detail responses (they filter deleted_at IS NULL), so
      // these are effectively always null there — carried through for the trash
      // list + any future detail view. Additive; existing consumers ignore them.
      deletedAt: row.deleted_at ?? null,
      deletedBy: row.deleted_by ?? null,
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

    // #59: journal executor marker. The requesting user's id — used to flag
    // per-check whether they are an EXECUTOR (a service line's master) on the
    // check but NOT its creator. null when no actor (the flag then resolves to
    // false for every row via the NULL-safe comparison below).
    const meId = actor?.userID ?? null;

    // Корзина (106): a soft-deleted check is out of the journal entirely — this
    // filter flows into BOTH the COUNT and the page query (offset + keyset).
    let where = 'ch.tenant_id = $1 AND ch.deleted_at IS NULL';
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
      const meIdx = idx;
      params.push(meId);
      idx++;
      params.push(limit);
      const res = await this.pool.query(
        `SELECT ch.*,
                m.full_name as master_name, m.avatar as master_avatar,
                cl.full_name as client_name, cl.phone as client_phone,
                ca.plate_number, ca.make_model,
                (ch.master_id IS DISTINCT FROM $${meIdx} AND EXISTS (
                   SELECT 1 FROM check_service_lines sl
                    WHERE sl.check_id = ch.id AND sl.master_id = $${meIdx}
                )) AS is_executor_for_me
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
      const meIdx = idx;
      params.push(meId);
      idx++;
      params.push(limit, offset);
      const res = await this.pool.query(
        `SELECT ch.*,
                m.full_name as master_name, m.avatar as master_avatar,
                cl.full_name as client_name, cl.phone as client_phone,
                ca.plate_number, ca.make_model,
                (ch.master_id IS DISTINCT FROM $${meIdx} AND EXISTS (
                   SELECT 1 FROM check_service_lines sl
                    WHERE sl.check_id = ch.id AND sl.master_id = $${meIdx}
                )) AS is_executor_for_me
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
      // #59: true when the requesting user is a service-line executor on this
      // check but is NOT its creator (added as executor by someone else). Drives
      // a per-check tint in the journal (mobile). Additive — false otherwise.
      (ch as any).isExecutor = row.is_executor_for_me === true;
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
       WHERE ch.id=$1 AND ch.tenant_id=$2 AND ch.deleted_at IS NULL`,
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
         SELECT work_status FROM checks WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL
       )
       UPDATE checks SET work_status=$1
       FROM before
       WHERE checks.id=$2 AND checks.tenant_id=$3 AND checks.deleted_at IS NULL
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
  ): Promise<{
    columns: WorkBoardColumn[];
    groups: Record<string, any[]>;
    accepted: any[];
    in_progress: any[];
    ready: any[];
    delivered: any[];
  }> {
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
    if (activeKeys.length === 0) return { columns, groups, accepted: [], in_progress: [], ready: [], delivered: [] };

    // Корзина (106): a trashed check is off the board too (its work_status is
    // irrelevant once deleted).
    let where = 'ch.tenant_id = $1 AND ch.work_status = ANY($2) AND ch.deleted_at IS NULL';
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
    // Backward-compat: pre-OTA clients read the fixed 4 keys (accepted/in_progress/
    // ready/delivered) directly off the board response. Always include them (empty
    // if that column was renamed/removed) so an OLD JS bundle can't crash on
    // board.<key>.length after the shape change to {columns, groups}.
    return {
      columns,
      groups,
      accepted: groups['accepted'] ?? [],
      in_progress: groups['in_progress'] ?? [],
      ready: groups['ready'] ?? [],
      delivered: groups['delivered'] ?? [],
    };
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

  async create(tenantID: string, userID: string, userRole: string, dto: any, actor?: ChecksActor) {
    if (!dto.masterId) throw new BadRequestException({ message: 'Мастер обязателен' });

    const services = dto.services || [];
    const products = dto.products || [];

    // ── POS shift-mode role-gate (092) ───────────────────────────────────
    // When the tenant's shift-mode is ON, a NON-cashier actor (a master without
    // `accept_payment`) cannot record payment: their check is forced to a
    // DEFERRED work-order (no cash/card, no stock decrement, no warranty start)
    // for a cashier to close later. When mode is OFF, or the actor is a cashier
    // (owner-class / accept_payment), `forceDeferred` is false and EVERYTHING
    // below is byte-for-byte the current flow.
    const forceDeferred = (await this.isShiftModeEnabled(tenantID)) && !this.isCashier(actor);
    const effectiveIsDeferred: boolean = forceDeferred ? true : dto.isDeferred || false;
    const effectiveCashAmount: number = forceDeferred ? 0 : dto.cashAmount || 0;
    const effectiveCardAmount: number = forceDeferred ? 0 : dto.cardAmount || 0;

    if (!effectiveIsDeferred && services.length === 0 && products.length === 0) {
      throw new BadRequestException({ message: 'Добавьте хотя бы одну услугу или товар' });
    }

    // ── Рассрочка: продажа в рассрочку (installment) ──────────────────────
    // Gate: только пользователь с правом `sell_installment` (owner-class —
    // implicit) может оформить чек в рассрочку, иначе — отказ. Плану нужен
    // клиент (кого «должать») и РЕАЛЬНЫЙ (не отложенный) чек: остаток — это долг
    // по уже совершённой продаже. Сам план создаётся ниже, внутри транзакции.
    const isInstallment = dto.paymentMethod === 'installment';
    if (isInstallment) {
      if (!userHasPermission(actor, 'sell_installment')) {
        throw new ForbiddenException({ message: 'Нет права продавать в рассрочку' });
      }
      if (!dto.clientId) {
        throw new BadRequestException({ message: 'Для рассрочки выберите клиента' });
      }
      if (effectiveIsDeferred) {
        throw new BadRequestException({ message: 'Рассрочку нельзя оформить на отложенный заказ-наряд' });
      }
      // Loud failure instead of a silently-untracked debt if DI ever misfires.
      if (!this.installments) {
        throw new InternalServerErrorException({ message: 'Сервис рассрочки недоступен' });
      }
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
        // #56: bake the per-line salary and attribute it to THIS line's executor
        // (masterId). Rounded to money precision so the persisted per-line amounts
        // sum EXACTLY to service_salary_total (which we keep as Σ of the rounded
        // lines) — the salary reads now attribute service earnings per line.
        const lineSalary = round2((total * salaryPct) / 100);
        serviceSalaryTotal += lineSalary;
        serviceLines.push({ ...svc, total, masterId, salaryAmount: lineSalary });
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

      // Product price lock: warehouse sell_price is authoritative (see helper).
      const warehouseSellMap = await this.loadWarehouseSellPrices(client, tenantID, referencedProductIds);

      for (const prod of products) {
        // Lock the SELL price to the current warehouse value when the product is
        // a warehouse item with a positive price; otherwise keep the client price
        // (ad-hoc line / product with no warehouse price). The cost price is left
        // exactly as today — only the sell price is locked.
        const lockedSell = prod.productId ? warehouseSellMap[prod.productId] : undefined;
        const effectiveSellPrice = lockedSell !== undefined ? lockedSell : prod.sellPrice || 0;
        const totalSell = effectiveSellPrice * (prod.quantity || 1);
        const totalCost = (prod.costPrice || 0) * (prod.quantity || 1);
        const productProfit = totalSell - totalCost;
        productTotal += totalSell;
        productCostTotal += totalCost;

        // Product commission: specific per-product % takes priority, otherwise global %
        const pct = productCommissionMap[prod.productId] ?? globalProductPct;
        if (pct > 0 && productProfit > 0) {
          productSalaryTotal += (productProfit * pct) / 100;
        }

        productLines.push({ ...prod, sellPrice: effectiveSellPrice, totalSell, totalCost });
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
          effectiveIsDeferred,
          dto.paymentMethod || 'cash',
          effectiveCashAmount,
          effectiveCardAmount,
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
          `INSERT INTO check_service_lines (check_id, service_id, master_id, name, price, quantity, total, salary_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            checkId,
            svc.serviceId || null,
            svc.masterId || null,
            svc.name,
            svc.price || 0,
            svc.quantity || 1,
            svc.total,
            svc.salaryAmount ?? 0,
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
        if (prod.productId && !effectiveIsDeferred) {
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
      if (!effectiveIsDeferred) {
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

      // ── «Мотивация»: accrue promo-product bonuses (095) ───────────────────
      // A check created already-paid (not deferred) is the payment moment —
      // accrue the акционные-товары bonus to the credited master here, in this
      // transaction. A deferred draft accrues later, on close, via
      // applyDeferredActivation. No-op when the tenant has no active promos.
      if (!effectiveIsDeferred) {
        await this.accrueMotivationPromos(client, tenantID, checkId);
      }

      // ── Рассрочка: create the installment plan inside this transaction ────
      // The check is a REAL sale — revenue already counted above. down_payment =
      // всё внесённое сейчас (наличные + карта); remaining = total − down_payment
      // is what the client owes. Atomic with the check: if the plan insert fails
      // the whole sale rolls back, never leaving an installment check without its
      // debt record. Gating (permission / client / not-deferred / service
      // presence) was enforced before the transaction opened.
      if (isInstallment && this.installments) {
        await this.installments.createPlanForCheckTx(client, tenantID, userID, {
          checkId,
          clientId: dto.clientId,
          total: totalRevenue,
          downPayment: (effectiveCashAmount || 0) + (effectiveCardAmount || 0),
          nextPaymentDate: dto.installment?.nextPaymentDate ?? dto.installmentNextPaymentDate,
          comment: dto.installment?.comment ?? dto.installmentComment,
        });
      }

      await client.query('COMMIT');

      // A new sale changes revenue/profit/ranking — drop cached aggregates so
      // the dashboard reflects it immediately instead of up to 30s late.
      this.invalidateReports(tenantID);

      // Live cross-device sync: a real (non-draft) sale moves the cash
      // position — nudge every OTHER device in the tenant to refetch. Deferred
      // drafts don't touch cash, so skip them to avoid silent-push noise.
      if (!effectiveIsDeferred) {
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

  async update(
    id: string,
    tenantID: string,
    userRole: string,
    dto: any,
    actorUserId: string | null = null,
    actor?: ChecksActor,
  ) {
    // If services or products are provided, do a full re-edit (only for deferred checks)
    if (dto.services !== undefined || dto.products !== undefined) {
      return this.fullUpdate(id, tenantID, userRole, dto, actorUserId, actor);
    }

    // Closing a deferred draft WITHOUT re-sending lines (bare `isDeferred:false`
    // toggle) is also an activation — route it through the transactional
    // activator so stock + warranties are applied on the true→false transition.
    // Any other isDeferred value (or no flip at all) falls through to the plain
    // field-update below unchanged.
    if (dto.isDeferred === false) {
      return this.activateDeferred(id, tenantID, userRole, dto, actorUserId, actor);
    }

    // POS shift-mode (092): a NON-cashier may not record payment on the plain
    // path either. No-op when shift-mode is OFF (current behaviour). Only fires
    // when this edit actually touches a money field (cash/card/paymentStatus).
    const touchesPayment =
      dto.cashAmount !== undefined || dto.cardAmount !== undefined || dto.paymentStatus !== undefined;
    if (touchesPayment) {
      await this.assertCashierForPayment(tenantID, actor);
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
      `UPDATE checks SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} AND deleted_at IS NULL RETURNING id, number, total_revenue, payment_status`,
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
  private async activateDeferred(
    id: string,
    tenantID: string,
    userRole: string,
    dto: any,
    actorUserId: string | null,
    actor?: ChecksActor,
  ) {
    // POS shift-mode (092): read once BEFORE the transaction so the cashier gate
    // below adds no extra connection while a client is held. OFF → false → gate
    // is a no-op and this close behaves exactly as today.
    const shiftMode = await this.isShiftModeEnabled(tenantID);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the row so two concurrent closes can't both observe
      // is_deferred=true and both decrement stock / create warranties. A trashed
      // draft (Корзина, 106) is excluded — it can't be closed until restored.
      const { rows: checkRows } = await client.query(
        'SELECT * FROM checks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE',
        [id, tenantID],
      );
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

      // POS shift-mode CASHIER gate (092): closing a draft IS taking payment.
      // When shift-mode is ON, only a cashier (owner-class / accept_payment) may
      // close. No-op when OFF — `shiftMode` is false and this branch is skipped.
      if (isActivating && shiftMode && !this.isCashier(actor)) {
        await client.query('ROLLBACK');
        throw new ForbiddenException({ message: 'Принять оплату и закрыть заказ-наряд может только кассир смены' });
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
    actor?: ChecksActor,
  ) {
    // POS shift-mode (092): read once up front so the cashier close-gate below
    // adds no nested connection. OFF → false → the gate is a no-op.
    const shiftMode = await this.isShiftModeEnabled(tenantID);
    // Verify check exists and is deferred. A trashed check (Корзина, 106) is
    // treated as gone — you can't edit / close one; restore it first.
    const { rows: checkRows } = await this.pool.query(
      'SELECT * FROM checks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
      [id, tenantID],
    );
    if (checkRows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
    // Prior persisted state — the authority for the true→false transition.
    const wasDeferred: boolean = checkRows[0].is_deferred === true;
    if (!wasDeferred) {
      // CLOSED (проведённый) check line-edit (#61). Historically forbidden; now
      // allowed for a holder of the grantable `edit_closed_check` permission
      // (owner-class bypasses). It routes to a DEDICATED cascade-recompute path
      // that reverses the OLD side-effects and applies the NEW ones in ONE
      // transaction — this fullUpdate body (below) stays exclusively the deferred
      // draft→close path, byte-for-byte unchanged. A non-holder still gets the
      // original refusal.
      if (!userHasPermission(actor, 'edit_closed_check')) {
        throw new ForbiddenException({ message: 'Редактирование доступно только для отложенных чеков' });
      }
      return this.editClosedCheck(id, tenantID, dto, actorUserId, actor);
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

    // ── Round 7 safety net: editing must NEVER steal the check onto the editor ──
    // When an owner/admin/director edits another master's draft, some clients
    // default `masterId` (and per-line executors) to the CURRENT user. If the
    // incoming master equals the actor but the check currently belongs to a
    // DIFFERENT master, treat it as that accidental default and KEEP the original
    // master, so salary keeps following the real executor. A genuine reassignment
    // to a third person (masterId != actor) still applies. Normalising the DTO
    // once here keeps every downstream read consistent (master_id write, salary
    // attribution, per-line executors) with no other change to the math below.
    {
      const currentMasterId: string | null = checkRows[0].master_id ? String(checkRows[0].master_id) : null;
      if (
        actorUserId &&
        dto.masterId !== undefined &&
        dto.masterId !== null &&
        String(dto.masterId) === String(actorUserId) &&
        currentMasterId !== null &&
        currentMasterId !== String(actorUserId)
      ) {
        dto.masterId = currentMasterId;
        if (Array.isArray(dto.services)) {
          for (const svc of dto.services) {
            if (
              svc &&
              svc.masterId !== undefined &&
              svc.masterId !== null &&
              String(svc.masterId) === String(actorUserId)
            ) {
              svc.masterId = currentMasterId;
            }
          }
        }
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Re-read the prior is_deferred under a row lock so two concurrent closes
      // can't BOTH see is_deferred=true and both decrement stock. The locked
      // value is the authority for whether to fire activation effects below.
      const { rows: lockedRows } = await client.query(
        'SELECT is_deferred FROM checks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE',
        [id, tenantID],
      );
      if (lockedRows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
      const lockedIsActivating = lockedRows[0].is_deferred === true && dto.isDeferred === false;

      // POS shift-mode CASHIER gate (092): closing this draft IS taking payment;
      // only a cashier may. No-op when OFF. A throw here rolls back via the catch.
      // A non-closing re-edit of a still-deferred draft (lockedIsActivating=false)
      // is unaffected — masters keep building their order.
      if (lockedIsActivating && shiftMode && !this.isCashier(actor)) {
        throw new ForbiddenException({ message: 'Принять оплату и закрыть заказ-наряд может только кассир смены' });
      }

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
        // #56: bake the per-line salary for THIS line's executor (see create()).
        const lineSalary = round2((total * salaryPct) / 100);
        serviceSalaryTotal += lineSalary;
        serviceLines.push({ ...svc, total, masterId, salaryAmount: lineSalary });
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

      // Product price lock (same rule as create): warehouse sell_price wins.
      const warehouseSellMap = await this.loadWarehouseSellPrices(client, tenantID, referencedProductIds);

      for (const prod of products) {
        const lockedSell = prod.productId ? warehouseSellMap[prod.productId] : undefined;
        const effectiveSellPrice = lockedSell !== undefined ? lockedSell : prod.sellPrice || 0;
        const totalSell = effectiveSellPrice * (prod.quantity || 1);
        const totalCost = (prod.costPrice || 0) * (prod.quantity || 1);
        const productProfit = totalSell - totalCost;
        productTotal += totalSell;
        productCostTotal += totalCost;

        const pct = productCommissionMap[prod.productId] ?? globalProductPct;
        if (pct > 0 && productProfit > 0) {
          productSalaryTotal += (productProfit * pct) / 100;
        }

        productLines.push({ ...prod, sellPrice: effectiveSellPrice, totalSell, totalCost });
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
          `INSERT INTO check_service_lines (check_id, service_id, master_id, name, price, quantity, total, salary_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            svc.serviceId || null,
            svc.masterId || null,
            svc.name,
            svc.price || 0,
            svc.quantity || 1,
            svc.total,
            svc.salaryAmount ?? 0,
          ],
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

      // ASSIGNMENT NOTIFY (092): an admin REASSIGNING a (deferred) order to a
      // different master — mirror of the create() push that already fires when an
      // order is first assigned to someone other than its creator. Fire-and-forget,
      // best-effort, opt-out via the 'check_assigned' notification category. Only
      // when the master actually changed AND the new master isn't the actor.
      const prevMasterId = checkRows[0].master_id;
      const newMasterId = dto.masterId;
      if (
        this.pushService &&
        newMasterId &&
        String(newMasterId) !== String(prevMasterId ?? '') &&
        String(newMasterId) !== String(actorUserId ?? '')
      ) {
        const checkNumber = checkRows[0].number;
        this.pushService
          .sendToUserCategory(
            newMasterId,
            'check_assigned',
            'Новый заказ-наряд',
            `Назначен заказ-наряд #${checkNumber}`,
          )
          .catch(() => {
            /* non-fatal */
          });
      }

      return this.getById(id, tenantID);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Re-derive a check's service/product lines + all money fields from an edit
   * DTO, using EXACTLY the same math create()/fullUpdate() bake at close (so an
   * edit produces byte-identical numbers to a fresh sale of the same content):
   *   • service line total = price×qty; per-line salary baked to the line's
   *     executor with the service-override-else-user percent (#56), rounded so
   *     Σ per-line == service_salary_total;
   *   • product sell price locked to the warehouse value (092); product cost as
   *     sent; product commission = specific-else-global %, only on positive
   *     margin; product_salary_total attributed to the check master;
   *   • totals: revenue = serviceTotal + max(0, productTotal − discount);
   *     totalCost = productCost + serviceSalary + productSalary; profit = rev −
   *     cost.
   * `prior` is the locked check row (source of the unchanged master/discount
   * fallbacks). Pure computation — reads reference tables (users/services/
   * products) but writes NOTHING; the caller persists the result.
   */
  private async recomputeClosedCheckLines(client: PoolClient, tenantID: string, dto: any, prior: any) {
    const services = dto.services || [];
    const products = dto.products || [];
    const primaryMasterId: string = dto.masterId || prior.master_id;

    // Service salary percents (per-executor default + per-service override).
    const masterIds = new Set<string>();
    if (dto.masterId) masterIds.add(dto.masterId);
    if (prior.master_id) masterIds.add(prior.master_id);
    for (const svc of services) if (svc.masterId) masterIds.add(svc.masterId);

    const salaryMap: Record<string, number> = {};
    if (masterIds.size > 0) {
      const { rows: salaryRows } = await client.query(
        `SELECT id, COALESCE(salary_percent, 0) as salary_percent FROM users WHERE id = ANY($1) AND tenant_id = $2`,
        [Array.from(masterIds), tenantID],
      );
      for (const r of salaryRows) salaryMap[r.id] = parseFloat(r.salary_percent) || 0;
    }

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

    let serviceTotal = 0;
    let serviceSalaryTotal = 0;
    const serviceLines: any[] = [];
    for (const svc of services) {
      const total = (svc.price || 0) * (svc.quantity || 1);
      serviceTotal += total;
      const masterId = svc.masterId || primaryMasterId;
      const serviceOverride = svc.serviceId ? serviceMasterPct[svc.serviceId] : null;
      const salaryPct = serviceOverride !== null ? serviceOverride : salaryMap[masterId] || 0;
      const lineSalary = round2((total * salaryPct) / 100);
      serviceSalaryTotal += lineSalary;
      serviceLines.push({ ...svc, total, masterId, salaryAmount: lineSalary });
    }

    // Product totals + commission (attributed to the check master, like create).
    let productTotal = 0;
    let productCostTotal = 0;
    let productSalaryTotal = 0;
    const productLines: any[] = [];

    const { rows: masterProdRows } = await client.query(
      'SELECT COALESCE(product_salary_percent, 0) as product_salary_percent FROM users WHERE id = $1 AND tenant_id = $2',
      [primaryMasterId, tenantID],
    );
    const globalProductPct = parseFloat(masterProdRows[0]?.product_salary_percent) || 0;

    const referencedProductIds: string[] = products
      .map((p: any) => p.productId)
      .filter((x: string | undefined): x is string => !!x);
    const productCommissionMap: Record<string, number> = {};
    if (referencedProductIds.length > 0) {
      const { rows: pcRows } = await client.query(
        `SELECT product_id, percent FROM product_commissions WHERE user_id = $1 AND product_id = ANY($2) AND tenant_id = $3`,
        [primaryMasterId, referencedProductIds, tenantID],
      );
      for (const r of pcRows) productCommissionMap[r.product_id] = parseFloat(r.percent) || 0;
    }

    const warehouseSellMap = await this.loadWarehouseSellPrices(client, tenantID, referencedProductIds);

    for (const prod of products) {
      const lockedSell = prod.productId ? warehouseSellMap[prod.productId] : undefined;
      const effectiveSellPrice = lockedSell !== undefined ? lockedSell : prod.sellPrice || 0;
      const totalSell = effectiveSellPrice * (prod.quantity || 1);
      const totalCost = (prod.costPrice || 0) * (prod.quantity || 1);
      const productProfit = totalSell - totalCost;
      productTotal += totalSell;
      productCostTotal += totalCost;
      const pct = productCommissionMap[prod.productId] ?? globalProductPct;
      if (pct > 0 && productProfit > 0) productSalaryTotal += (productProfit * pct) / 100;
      productLines.push({ ...prod, sellPrice: effectiveSellPrice, totalSell, totalCost });
    }

    const discount = dto.discount ?? (parseFloat(prior.discount) || 0);
    const discountedProductTotal = productTotal - discount;
    const totalRevenue = serviceTotal + (discountedProductTotal > 0 ? discountedProductTotal : 0);
    const totalCost = productCostTotal + serviceSalaryTotal + productSalaryTotal;
    const profit = totalRevenue - totalCost;

    return {
      serviceLines,
      productLines,
      referencedProductIds,
      primaryMasterId,
      serviceTotal,
      productTotal,
      productCostTotal,
      serviceSalaryTotal,
      productSalaryTotal,
      discount,
      totalRevenue,
      totalCost,
      profit,
    };
  }

  /**
   * Warranty recompute for a CLOSED-check edit (#61). Warranty claims are a
   * materialised side-effect of close (createFromCheckLines). On edit we must
   * re-derive them from the NEW lines — but a claim that has been REDEEMED
   * (used_at IS NOT NULL) is honoured history and MUST survive:
   *   1. delete only this check's UNUSED claims;
   *   2. recreate from the new lines, EXCLUDING any (kind, item-id) that still
   *      has a USED claim on this check — so a warranty already consumed by a
   *      later check is never silently re-granted.
   * started_at stays the ORIGINAL sale date (`checkDate` = the check's unchanged
   * date), so an unchanged item's window is identical before/after — the whole
   * step is content-idempotent. Runs in the caller's transaction.
   */
  private async recomputeWarrantyForClosedEdit(
    client: PoolClient,
    tenantID: string,
    checkId: string,
    checkDate: string,
    clientId: string | null,
    carId: string | null,
    serviceLines: any[],
    productLines: any[],
  ): Promise<void> {
    const { rows: usedRows } = await client.query(
      `SELECT kind, product_id, service_id FROM warranty_claims
        WHERE tenant_id = $1 AND check_id = $2 AND used_at IS NOT NULL`,
      [tenantID, checkId],
    );
    const usedKeys = new Set<string>();
    for (const r of usedRows) {
      usedKeys.add(r.kind === 'product' ? `p:${r.product_id}` : `s:${r.service_id}`);
    }

    // Drop the reversible (unused) claims; used ones are preserved as history.
    await client.query(`DELETE FROM warranty_claims WHERE tenant_id = $1 AND check_id = $2 AND used_at IS NULL`, [
      tenantID,
      checkId,
    ]);

    const warrantyLines: Array<{
      kind: 'product' | 'service';
      productId?: string | null;
      serviceId?: string | null;
      itemName?: string | null;
    }> = [];
    for (const svc of serviceLines) {
      if (svc.serviceId && !usedKeys.has(`s:${svc.serviceId}`)) {
        warrantyLines.push({ kind: 'service', serviceId: svc.serviceId, itemName: svc.name });
      }
    }
    for (const prod of productLines) {
      if (prod.productId && !usedKeys.has(`p:${prod.productId}`)) {
        warrantyLines.push({ kind: 'product', productId: prod.productId, itemName: prod.name });
      }
    }
    if (warrantyLines.length > 0) {
      await this.warranty.createFromCheckLines(client, tenantID, checkId, checkDate, clientId, carId, warrantyLines);
    }
  }

  /**
   * Edit a CLOSED (проведённый) check (#61) — the cascade-recompute path. Gated
   * upstream by the `edit_closed_check` permission (owner-class bypasses). The
   * check STAYS closed (is_deferred is never flipped, date/number/created_at are
   * never rewritten); only its content + money are re-derived.
   *
   * EVERY materialised side-effect of the original close is reversed + reapplied
   * in ONE transaction (single BEGIN/COMMIT, check row locked FOR UPDATE):
   *   • STOCK      — add back the OLD product-line quantities, deduct the NEW
   *                  ones (atomic per-product; net = the delta, oversell allowed
   *                  exactly like a sale). Editing twice with the same content is
   *                  a no-op on stock (old == new cancels).
   *   • SALARY     — service_salary_total + per-line salary_amount (baked to the
   *                  line executor) + product_salary_total are recomputed and
   *                  rewritten; the salary reports read these directly (derived),
   *                  so they re-attribute automatically.
   *   • CASH/COST/ — cash_amount/card_amount + product_cost_total/total_cost/
   *     PROFIT       profit/total_revenue rewritten on the row; every report is
   *                  derived from these, so cash-flow/dashboard follow.
   *   • MOTIVATION — accrueMotivationPromos re-runs (idempotent DELETE-then-INSERT
   *                  per check), re-crediting the CURRENT master from the NEW
   *                  product lines.
   *   • WARRANTY   — unused claims re-derived from the new lines; redeemed claims
   *                  preserved (see recomputeWarrantyForClosedEdit).
   *   • REPORTS    — tenant report caches invalidated after commit.
   *
   * REFUSED (can't be cleanly reversed → STOP, no corruption):
   *   • a RETURNED check (money already reversed by the returns flow);
   *   • a check sold in РАССРОЧКУ (installment debt ledger + payments).
   * LEFT UNTOUCHED BY DESIGN:
   *   • LOYALTY (client_bonuses) — a decoupled, immutable single-sided ledger
   *     with a hard no-negative-balance rule; auto-clawback of already-spent
   *     cashback could drive a client negative. The revenue before→after is
   *     captured in the audit row so the owner can adjust bonuses manually.
   *
   * A failure anywhere rolls the WHOLE thing back — no half-applied money/stock.
   * The edit is AUDITED transactionally (admin_audit_log) — money data.
   */
  private async editClosedCheck(
    id: string,
    tenantID: string,
    dto: any,
    actorUserId: string | null,
    actor?: ChecksActor,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the check row for the whole edit so a concurrent edit/return/delete
      // can't race the reverse+reapply. This locked row is the authority for the
      // prior state (stock reversal basis, money before-image, guards). A trashed
      // check (Корзина, 106) is excluded — restore it before editing.
      const { rows: lockRows } = await client.query(
        'SELECT * FROM checks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE',
        [id, tenantID],
      );
      if (lockRows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
      const prior = lockRows[0];

      // ── Round 7 safety net (see fullUpdate) ─────────────────────────────────
      // Editing a closed check must never silently reassign it onto the editor.
      // If `masterId` defaults to the actor but the check currently belongs to a
      // DIFFERENT master, keep the original master (salary/attribution follow the
      // real executor); a genuine reassignment to a third person still applies.
      // Per-line executors defaulted to the editor get the same treatment.
      // Normalised once so the master_id write, recompute and audit stay aligned.
      {
        const currentMasterId: string | null = prior.master_id ? String(prior.master_id) : null;
        if (
          actorUserId &&
          dto.masterId !== undefined &&
          dto.masterId !== null &&
          String(dto.masterId) === String(actorUserId) &&
          currentMasterId !== null &&
          currentMasterId !== String(actorUserId)
        ) {
          dto.masterId = currentMasterId;
          if (Array.isArray(dto.services)) {
            for (const svc of dto.services) {
              if (
                svc &&
                svc.masterId !== undefined &&
                svc.masterId !== null &&
                String(svc.masterId) === String(actorUserId)
              ) {
                svc.masterId = currentMasterId;
              }
            }
          }
        }
      }

      // Re-assert closed under the lock (routing guaranteed it, but a concurrent
      // writer could have changed it). A deferred draft belongs to fullUpdate.
      if (prior.is_deferred === true) {
        throw new BadRequestException({ message: 'Отложенный заказ-наряд редактируется обычным способом' });
      }
      // A RETURNED check already had its money reversed + stock restored by the
      // returns flow — re-deriving totals here would double-count. STOP.
      if (prior.is_returned === true) {
        throw new BadRequestException({ message: 'Возвращённый заказ-наряд редактировать нельзя' });
      }
      // A check sold in installment carries a debt ledger (installment_plans +
      // payments) that can't be cleanly re-derived from new totals. STOP — the
      // owner edits the рассрочка separately. Prefer the owning service; fall
      // back to a direct existence check so the guard is never silently skipped.
      const hasInstallment = this.installments
        ? await this.installments.hasPlanForCheckTx(client, tenantID, id)
        : (
            await client.query(`SELECT 1 FROM installment_plans WHERE tenant_id=$1 AND check_id=$2 LIMIT 1`, [
              tenantID,
              id,
            ])
          ).rows.length > 0;
      if (hasInstallment) {
        throw new BadRequestException({
          message: 'Заказ-наряд продан в рассрочку — измените рассрочку отдельно, затем заказ-наряд',
        });
      }

      // Cross-tenant integrity guards (same as create()/fullUpdate): every
      // client-supplied reference must belong to this tenant.
      const services = dto.services || [];
      const products = dto.products || [];
      if (dto.masterId) await this.assertOwnsByTenant(client, tenantID, 'users', dto.masterId, 'Мастер');
      if (dto.clientId) await this.assertOwnsByTenant(client, tenantID, 'clients', dto.clientId, 'Клиент');
      if (dto.carId) await this.assertOwnsByTenant(client, tenantID, 'cars', dto.carId, 'Машина');
      const svcIds: string[] = services
        .map((s: any) => s.serviceId)
        .filter((x: string | undefined): x is string => !!x);
      if (svcIds.length > 0) await this.assertManyOwnedByTenant(client, tenantID, 'services', svcIds, 'Услуга');
      const prodIds: string[] = products
        .map((p: any) => p.productId)
        .filter((x: string | undefined): x is string => !!x);
      if (prodIds.length > 0) await this.assertManyOwnedByTenant(client, tenantID, 'products', prodIds, 'Товар');
      const lineMasterIds: string[] = services
        .map((s: any) => s.masterId)
        .filter((x: string | undefined): x is string => !!x);
      if (lineMasterIds.length > 0)
        await this.assertManyOwnedByTenant(client, tenantID, 'users', lineMasterIds, 'Мастер');

      // OLD product quantities (the amount originally deducted from stock),
      // aggregated per product BEFORE the lines are rewritten.
      const { rows: oldProdRows } = await client.query(
        `SELECT product_id, COALESCE(SUM(quantity), 0) AS qty
           FROM check_product_lines
          WHERE check_id = $1 AND product_id IS NOT NULL
          GROUP BY product_id`,
        [id],
      );

      // Recompute lines + money from the edit DTO (same math as close).
      const c = await this.recomputeClosedCheckLines(client, tenantID, dto, prior);

      // ── 1) Reverse OLD stock: add back exactly what the sale deducted ──────
      for (const r of oldProdRows) {
        const qty = parseFloat(r.qty) || 0;
        if (qty <= 0) continue;
        await client.query(`UPDATE products SET stock = stock + $1 WHERE id = $2 AND tenant_id = $3`, [
          qty,
          r.product_id,
          tenantID,
        ]);
      }

      // ── 2) Rewrite the check row — is_deferred/date/number/created_at stay ──
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
      // Always rewrite the derived money fields.
      updateFields.push(`service_total=$${ui++}`);
      updateVals.push(c.serviceTotal);
      updateFields.push(`product_total=$${ui++}`);
      updateVals.push(c.productTotal);
      updateFields.push(`total_revenue=$${ui++}`);
      updateVals.push(c.totalRevenue);
      updateFields.push(`product_cost_total=$${ui++}`);
      updateVals.push(c.productCostTotal);
      updateFields.push(`service_salary_total=$${ui++}`);
      updateVals.push(c.serviceSalaryTotal);
      updateFields.push(`product_salary_total=$${ui++}`);
      updateVals.push(c.productSalaryTotal);
      updateFields.push(`total_cost=$${ui++}`);
      updateVals.push(c.totalCost);
      updateFields.push(`profit=$${ui++}`);
      updateVals.push(c.profit);
      updateVals.push(id, tenantID);
      await client.query(
        `UPDATE checks SET ${updateFields.join(', ')} WHERE id=$${ui++} AND tenant_id=$${ui}`,
        updateVals,
      );

      // ── 3) Replace the lines ──────────────────────────────────────────────
      await client.query('DELETE FROM check_service_lines WHERE check_id=$1', [id]);
      await client.query('DELETE FROM check_product_lines WHERE check_id=$1', [id]);
      for (const svc of c.serviceLines) {
        await client.query(
          `INSERT INTO check_service_lines (check_id, service_id, master_id, name, price, quantity, total, salary_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            svc.serviceId || null,
            svc.masterId || null,
            svc.name,
            svc.price || 0,
            svc.quantity || 1,
            svc.total,
            svc.salaryAmount ?? 0,
          ],
        );
      }
      for (const prod of c.productLines) {
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

      // ── 4) Apply NEW stock: deduct the new quantities (aggregated per product) ─
      const newAgg: Record<string, number> = {};
      for (const prod of c.productLines) {
        if (!prod.productId) continue;
        newAgg[prod.productId] = (newAgg[prod.productId] || 0) + (parseFloat(prod.quantity) || 0);
      }
      for (const [productId, qty] of Object.entries(newAgg)) {
        if (qty <= 0) continue;
        await client.query(`UPDATE products SET stock = stock - $1 WHERE id = $2 AND tenant_id = $3`, [
          qty,
          productId,
          tenantID,
        ]);
      }

      // ── 5) Motivation — idempotent re-accrual from the new lines + master ───
      await this.accrueMotivationPromos(client, tenantID, id);

      // ── 6) Warranty — re-derive unused claims, preserve redeemed history ────
      const effectiveClientId = dto.clientId !== undefined ? dto.clientId || null : (prior.client_id ?? null);
      const effectiveCarId = dto.carId !== undefined ? dto.carId || null : (prior.car_id ?? null);
      await this.recomputeWarrantyForClosedEdit(
        client,
        tenantID,
        id,
        prior.date instanceof Date ? prior.date.toISOString() : String(prior.date),
        effectiveClientId,
        effectiveCarId,
        c.serviceLines,
        c.productLines,
      );

      // ── 7) Audit (transactional — money data) ───────────────────────────────
      const before = {
        totalRevenue: parseFloat(prior.total_revenue) || 0,
        cashAmount: parseFloat(prior.cash_amount) || 0,
        cardAmount: parseFloat(prior.card_amount) || 0,
        serviceTotal: parseFloat(prior.service_total) || 0,
        productTotal: parseFloat(prior.product_total) || 0,
        productCostTotal: parseFloat(prior.product_cost_total) || 0,
        serviceSalaryTotal: parseFloat(prior.service_salary_total) || 0,
        productSalaryTotal: parseFloat(prior.product_salary_total) || 0,
        totalCost: parseFloat(prior.total_cost) || 0,
        profit: parseFloat(prior.profit) || 0,
        discount: parseFloat(prior.discount) || 0,
        masterId: prior.master_id ?? null,
        clientId: prior.client_id ?? null,
        carId: prior.car_id ?? null,
      };
      const after = {
        totalRevenue: c.totalRevenue,
        cashAmount: dto.cashAmount !== undefined ? dto.cashAmount || 0 : before.cashAmount,
        cardAmount: dto.cardAmount !== undefined ? dto.cardAmount || 0 : before.cardAmount,
        serviceTotal: c.serviceTotal,
        productTotal: c.productTotal,
        productCostTotal: c.productCostTotal,
        serviceSalaryTotal: c.serviceSalaryTotal,
        productSalaryTotal: c.productSalaryTotal,
        totalCost: c.totalCost,
        profit: c.profit,
        discount: c.discount,
        masterId: dto.masterId !== undefined ? dto.masterId : before.masterId,
        clientId: effectiveClientId,
        carId: effectiveCarId,
      };
      const actorName = await this.resolveActorNameTx(client, tenantID, actorUserId);
      await this.writeClosedEditAudit(client, actorUserId, actorName, id, prior.number, {
        tenantId: tenantID,
        checkNumber: prior.number,
        before,
        after,
      });

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

    // A closed-check edit moves revenue/profit/cash/salary — drop cached
    // aggregates and nudge other devices to refetch (mirrors create/fullUpdate).
    this.invalidateReports(tenantID);
    this.emitCashChanged(tenantID, actorUserId);
    return this.getById(id, tenantID);
  }

  /**
   * Best-effort display-name resolve for the audit row, on the caller's
   * transaction connection + tenant-scoped. Never throws (a name lookup must not
   * abort the money edit) — returns null on any miss/error.
   */
  private async resolveActorNameTx(
    client: PoolClient,
    tenantID: string,
    userId: string | null,
  ): Promise<string | null> {
    if (!userId) return null;
    try {
      const { rows } = await client.query(`SELECT full_name FROM users WHERE id=$1 AND tenant_id=$2 LIMIT 1`, [
        userId,
        tenantID,
      ]);
      return rows[0]?.full_name ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Append the closed-check-edit audit row IN the caller's transaction (atomic
   * with the money change). Prefers the shared AuditService writer; falls back
   * to an inline INSERT so a committed edit is NEVER left un-audited even if the
   * optional service is absent. Same 068 admin_audit_log table + column set.
   */
  private async writeClosedEditAudit(
    client: PoolClient,
    actorUserId: string | null,
    actorName: string | null,
    checkId: string,
    checkNumber: unknown,
    detail: Record<string, unknown>,
  ): Promise<void> {
    const target = {
      targetType: 'check',
      targetId: checkId,
      targetName: checkNumber !== null && checkNumber !== undefined ? `#${checkNumber}` : null,
      detail,
    };
    // logTx's AuditActor.userId is a non-null string; only take that path with a
    // real actor id. A (theoretical) null actor uses the inline INSERT, which
    // writes actor_user_id = NULL cleanly (an empty string would break the UUID).
    if (this.audit && actorUserId) {
      await this.audit.logTx(client, { userId: actorUserId, name: actorName }, 'check_closed_edit', target);
      return;
    }
    await client.query(
      `INSERT INTO admin_audit_log
         (actor_user_id, actor_name, action, target_type, target_id, target_name, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [actorUserId, actorName, 'check_closed_edit', 'check', checkId, target.targetName, JSON.stringify(detail)],
    );
  }

  /**
   * SOFT-DELETE a check → move it to the Корзина (106). Reversible for 30 days.
   *
   * Historically this HARD-deleted the row (stock added back, `DELETE FROM
   * checks`, FK CASCADE cleaned up the rest). Now, in ONE transaction:
   *   (a) FULLY REVERSE the materialised footprint — return product stock, drop
   *       this check's motivation accruals, remove its unused warranty claims
   *       (reverseCheckFootprintTx); the DERIVED money (revenue / salary /
   *       cash-flow / dashboard / ratings) disappears automatically because every
   *       accounting query now filters `deleted_at IS NULL`. The baked money
   *       columns (service_salary_total / product_salary_total / per-line
   *       salary_amount / total_revenue / cash_amount / …) are deliberately LEFT
   *       INTACT so a later restore is bit-identical — even if a rate changed.
   *   (b) stamp `deleted_at = now()`, `deleted_by = <actor>`.
   *
   * REFUSED (their reverse is ambiguous — mirror editClosedCheck): a RETURNED
   * check (money already reversed by the returns flow) and a check sold in
   * РАССРОЧКУ (installment ledger). The caller (controller) gates the role to
   * owner-class exactly as the old delete did.
   */
  async remove(id: string, tenantID: string, userRole: string, actorUserId: string | null = null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the LIVE check row for the lifetime of the delete so a concurrent
      // edit/return/restore can't race the footprint reverse below. A row that is
      // already in the trash is excluded → a double-delete is a clean 404 no-op.
      const { rows } = await client.query(
        'SELECT * FROM checks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE',
        [id, tenantID],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
      const prior = rows[0];
      if (userRole === 'master' && !prior.is_deferred) {
        throw new ForbiddenException({ message: 'Мастер не может удалить закрытый заказ-наряд' });
      }
      // A RETURNED check already had its money reversed + stock restored by the
      // returns flow — reversing again here would double-count. STOP.
      if (prior.is_returned === true) {
        throw new BadRequestException({
          message: 'Возвращённый заказ-наряд нельзя удалить — сначала отмените возврат',
        });
      }
      // A check sold in installment carries a debt ledger that can't be cleanly
      // unwound by a soft-delete. STOP — mirror editClosedCheck's refusal.
      const hasInstallment = this.installments
        ? await this.installments.hasPlanForCheckTx(client, tenantID, id)
        : (
            await client.query(`SELECT 1 FROM installment_plans WHERE tenant_id=$1 AND check_id=$2 LIMIT 1`, [
              tenantID,
              id,
            ])
          ).rows.length > 0;
      if (hasInstallment) {
        throw new BadRequestException({
          message: 'Заказ-наряд продан в рассрочку — удалить нельзя, сначала измените рассрочку',
        });
      }

      // (a) reverse the materialised footprint (stock / motivation / warranty).
      await this.reverseCheckFootprintTx(client, tenantID, id, prior);

      // (b) stamp the trash mark. The row stays; the deleted_at IS NULL filters
      // on every accounting read hide its derived money instantly.
      await client.query('UPDATE checks SET deleted_at = now(), deleted_by = $3 WHERE id=$1 AND tenant_id=$2', [
        id,
        tenantID,
        actorUserId,
      ]);

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
    this.invalidateReports(tenantID);
    this.emitCashChanged(tenantID, actorUserId);
    return { message: 'Перемещено в корзину' };
  }

  /**
   * Reverse the MATERIALISED (non-derived) footprint of a check, INSIDE the
   * caller's transaction. Used by soft-delete (remove). Derived money is NOT
   * touched here — it vanishes from reports via the `deleted_at IS NULL` filters.
   *   • STOCK — add back exactly what a live, non-returned SALE deducted. A
   *             deferred draft never took stock; a returned check was already
   *             restored by the returns flow — both skip (gated on the flags).
   *   • MOTIVATION — drop this check's promo accruals. SalaryService reads
   *             motivation_accruals STANDALONE (no checks join), so a filter
   *             wouldn't hide them — they must physically go (mirrors
   *             accrueMotivationPromos' own DELETE half).
   *   • WARRANTY — remove the reversible (unused) claims so they leave the
   *             warranty lists/alerts; a REDEEMED claim is honoured history and
   *             is preserved (same rule as recomputeWarrantyForClosedEdit).
   */
  private async reverseCheckFootprintTx(client: PoolClient, tenantID: string, id: string, prior: any): Promise<void> {
    if (!prior.is_deferred && !prior.is_returned) {
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
    await client.query('DELETE FROM motivation_accruals WHERE tenant_id=$1 AND check_id=$2', [tenantID, id]);
    await client.query('DELETE FROM warranty_claims WHERE tenant_id=$1 AND check_id=$2 AND used_at IS NULL', [
      tenantID,
      id,
    ]);
  }

  /**
   * RE-APPLY the materialised footprint of a check being restored, INSIDE the
   * caller's transaction — the exact inverse of reverseCheckFootprintTx:
   *   • STOCK — RE-DEDUCT the (preserved) product-line quantities. Unlike a fresh
   *             sale (which allows overselling), a RESTORE REFUSES when current
   *             stock is insufficient — better to block than silently drive stock
   *             negative for a check someone re-sold in the meantime.
   *   • MOTIVATION — re-accrue via accrueMotivationPromos (idempotent DELETE+
   *             INSERT), re-crediting the same master from the same lines.
   *   • WARRANTY — re-derive the unused claims from the preserved lines with the
   *             ORIGINAL sale date (recomputeWarrantyForClosedEdit), preserving
   *             any redeemed claim — identical windows to before the delete.
   * Salary / revenue / cash-flow need NO action: their columns were never touched
   * by the delete, so they reappear identical the moment deleted_at clears.
   */
  private async reapplyCheckFootprintTx(client: PoolClient, tenantID: string, id: string, prior: any): Promise<void> {
    if (prior.is_deferred || prior.is_returned) return; // a draft / returned check took no footprint

    // Aggregate the NEW deduction per product from the preserved lines.
    const { rows: agg } = await client.query(
      `SELECT product_id, COALESCE(SUM(quantity), 0) AS qty
         FROM check_product_lines
        WHERE check_id=$1 AND product_id IS NOT NULL
        GROUP BY product_id`,
      [id],
    );
    const toDeduct = agg
      .map((r) => ({ productId: r.product_id as string, qty: parseFloat(r.qty) || 0 }))
      .filter((x) => x.qty > 0);

    if (toDeduct.length > 0) {
      // Sufficiency check FIRST — refuse the whole restore if any product can't
      // cover its re-deduction (restore-specific: never go negative).
      const productIds = toDeduct.map((x) => x.productId);
      const { rows: stockRows } = await client.query(
        'SELECT id, name, stock FROM products WHERE id = ANY($1) AND tenant_id=$2',
        [productIds, tenantID],
      );
      const stockMap: Record<string, number> = {};
      const nameMap: Record<string, string> = {};
      for (const s of stockRows) {
        stockMap[s.id] = parseFloat(s.stock) || 0;
        nameMap[s.id] = s.name;
      }
      const insufficient = toDeduct.filter((x) => (stockMap[x.productId] ?? 0) < x.qty);
      if (insufficient.length > 0) {
        const detail = insufficient
          .map((x) => `${nameMap[x.productId] ?? x.productId} (нужно ${x.qty}, есть ${stockMap[x.productId] ?? 0})`)
          .join(', ');
        throw new BadRequestException({
          message: `Недостаточно товара на складе для восстановления: ${detail}`,
        });
      }
      for (const x of toDeduct) {
        await client.query('UPDATE products SET stock = stock - $1 WHERE id=$2 AND tenant_id=$3', [
          x.qty,
          x.productId,
          tenantID,
        ]);
      }
    }

    // Motivation — idempotent re-accrual from the preserved lines + master.
    await this.accrueMotivationPromos(client, tenantID, id);

    // Warranty — re-derive unused claims from the preserved lines, keyed on the
    // ORIGINAL sale date so windows match exactly; redeemed claims are preserved.
    const { rows: svcRows } = await client.query('SELECT service_id, name FROM check_service_lines WHERE check_id=$1', [
      id,
    ]);
    const { rows: prodRows } = await client.query(
      'SELECT product_id, name FROM check_product_lines WHERE check_id=$1',
      [id],
    );
    const serviceLines = svcRows.map((r) => ({ serviceId: r.service_id, name: r.name }));
    const productLines = prodRows.map((r) => ({ productId: r.product_id, name: r.name }));
    await this.recomputeWarrantyForClosedEdit(
      client,
      tenantID,
      id,
      prior.date instanceof Date ? prior.date.toISOString() : String(prior.date),
      prior.client_id ?? null,
      prior.car_id ?? null,
      serviceLines,
      productLines,
    );
  }

  /**
   * RESTORE a trashed check (106) — owner-only (gated in the controller). In ONE
   * transaction: re-apply the full footprint (reapplyCheckFootprintTx) and clear
   * `deleted_at`/`deleted_by`. After this the check is effect-identical to before
   * the delete: same id / created_at / date / number, same per-line salary
   * attribution, same stock deltas. Refuses (400) if stock is now insufficient to
   * re-deduct. Idempotent: a check that is NOT in the trash is a clean 404 no-op.
   */
  async restore(id: string, tenantID: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the TRASHED row (deleted_at IS NOT NULL). A live check → 404 no-op,
      // so a double-restore can never re-apply the footprint twice.
      const { rows } = await client.query(
        'SELECT * FROM checks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NOT NULL FOR UPDATE',
        [id, tenantID],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден в корзине' });
      const prior = rows[0];

      // Re-apply first (may throw on insufficient stock → whole restore rolls back
      // and the check stays safely in the trash).
      await this.reapplyCheckFootprintTx(client, tenantID, id, prior);

      // Clear the trash mark — the derived money reappears identical at once.
      await client.query('UPDATE checks SET deleted_at = NULL, deleted_by = NULL WHERE id=$1 AND tenant_id=$2', [
        id,
        tenantID,
      ]);

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
    this.invalidateReports(tenantID);
    this.emitCashChanged(tenantID, null);
    return this.getById(id, tenantID);
  }

  /**
   * The Корзина list (106) — owner-only (gated in the controller). Every check
   * trashed within the last 30 days, tenant-scoped, newest-deleted-first. Older
   * trashed checks are hidden here (they are purged by purgeExpiredTrash). Slim
   * summary: number / date / client name / total / deleted_at / deleted_by(name).
   */
  async listTrash(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT ch.id, ch.number, ch.date, ch.total_revenue, ch.is_deferred,
              ch.deleted_at, ch.deleted_by,
              cl.full_name AS client_name,
              du.full_name AS deleted_by_name
         FROM checks ch
         LEFT JOIN clients cl ON cl.id = ch.client_id AND cl.tenant_id = ch.tenant_id
         LEFT JOIN users du ON du.id = ch.deleted_by AND du.tenant_id = ch.tenant_id
        WHERE ch.tenant_id = $1
          AND ch.deleted_at IS NOT NULL
          AND ch.deleted_at > now() - interval '30 days'
        ORDER BY ch.deleted_at DESC`,
      [tenantID],
    );
    return rows.map((r) => ({
      id: r.id as string,
      number: r.number as number,
      date: r.date as string,
      clientName: (r.client_name as string) ?? null,
      totalRevenue: parseFloat(r.total_revenue) || 0,
      isDeferred: !!r.is_deferred,
      deletedAt: r.deleted_at as string,
      deletedBy: (r.deleted_by as string) ?? null,
      deletedByName: (r.deleted_by_name as string) ?? null,
    }));
  }

  /**
   * 30-day purge (106). A check trashed more than 30 days ago is permanently
   * removed with a plain hard DELETE — identical to the pre-Корзина delete: its
   * footprint was already reversed at trash time, and FK CASCADE / SET NULL clean
   * up lines / warranty / motivation / returns / photos exactly as before. Gated
   * on RUN_BACKGROUND_JOBS so it fires on exactly one replica (mirrors
   * AuthService.cleanExpiredTokens). Never throws into the scheduler.
   */
  @Cron('23 3 * * *', { timeZone: 'Europe/Moscow' })
  async purgeExpiredTrash(): Promise<void> {
    if (!RUN_BACKGROUND_JOBS) return;
    try {
      const { rowCount } = await this.pool.query(
        `DELETE FROM checks WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'`,
      );
      if (rowCount && rowCount > 0) {
        this.logger.log(`Purged ${rowCount} expired trashed checks (>30d in Корзина)`);
      }
    } catch (err) {
      this.logger.error(`purgeExpiredTrash failed: ${err instanceof Error ? err.message : err}`);
    }
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
       WHERE tenant_id=$1 AND is_deferred=false AND deleted_at IS NULL`,
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
       WHERE tenant_id=$1 AND date >= $2 AND date <= $3 AND is_deferred=false AND deleted_at IS NULL
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
         WHERE tenant_id=$1 AND date >= $2 AND date <= $3 AND is_deferred=false AND deleted_at IS NULL
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
    const conds: string[] = ['ch.tenant_id = $1', 'ch.deleted_at IS NULL'];
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
       WHERE ch.tenant_id=$1 AND ch.date >= $2 AND ch.is_deferred=false AND ch.deleted_at IS NULL
       GROUP BY ch.master_id, u.full_name
       ORDER BY revenue DESC`,
      [tenantID, todayStart],
    );

    const { rows: monthRows } = await this.pool.query(
      `SELECT ch.master_id, u.full_name as master_name,
              COALESCE(SUM(ch.total_revenue), 0) as revenue,
              COUNT(*) as check_count
       FROM checks ch JOIN users u ON u.id = ch.master_id
       WHERE ch.tenant_id=$1 AND ch.date >= $2 AND ch.is_deferred=false AND ch.deleted_at IS NULL
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
