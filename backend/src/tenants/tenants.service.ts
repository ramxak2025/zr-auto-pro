import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';
import { AuditService, AuditActor } from './audit.service';

/**
 * One month of the platform MRR trend (GET /admin/mrr-trends). Matches the
 * shared `MrrTrendPoint` type. Oldest month first.
 */
export interface MrrTrendPoint {
  month: string;
  mrr: number;
  activeTenants: number;
  newTenants: number;
}

/**
 * Tenant subscription state (mirrors the shared `SubscriptionStatus` union — keep
 * in sync). `suspended` = an operator explicitly suspended the tenant (102) OR a
 * legacy manual disable (is_active=false); `expired` = subscription_end lapsed;
 * `active` = everything else (a NULL subscription_end means "no expiry").
 */
export type SubscriptionStatus = 'active' | 'expired' | 'suspended';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger('TenantsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private jwtService: JwtService,
    private audit: AuditService,
  ) {}

  private mapTenant(row: any) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      phone: row.phone,
      address: row.address,
      email: row.email,
      description: row.description,
      logo: row.logo,
      isActive: row.is_active,
      maxUsers: row.max_users,
      planId: row.plan_id,
      monthlyPrice: parseFloat(row.monthly_price) || 0,
      subscriptionEnd: row.subscription_end,
      subscriptionNote: row.subscription_note,
      legalName: row.legal_name,
      inn: row.inn,
      kpp: row.kpp,
      ogrn: row.ogrn,
      receiptFooter: row.receipt_footer,
      shiftsEnabled: row.shifts_enabled === true,
      shiftModeEnabled: row.shift_mode_enabled === true,
      suspendedAt: row.suspended_at ?? null,
      suspendedReason: row.suspended_reason ?? null,
      userCount: row.user_count !== undefined ? parseInt(row.user_count) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Authoritative subscription status from a tenant row. `suspended` wins over
   * `expired` (an operator block is a harder stop than a lapsed window). A
   * legacy is_active=false reads as `suspended` so no data migration is needed.
   */
  private computeSubscriptionStatus(row: {
    is_active?: boolean | null;
    suspended_at?: Date | string | null;
    subscription_end?: Date | string | null;
  }): SubscriptionStatus {
    if (row.suspended_at != null || row.is_active === false) return 'suspended';
    if (row.subscription_end != null && new Date(row.subscription_end).getTime() < Date.now()) {
      return 'expired';
    }
    return 'active';
  }

  async getAll() {
    const { rows } = await this.pool.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM users WHERE tenant_id=t.id) as user_count,
              p.name as plan_name, p.monthly_price as plan_monthly_price, p.max_users as plan_max_users, p.description as plan_description
       FROM tenants t
       LEFT JOIN plans p ON p.id = t.plan_id
       ORDER BY t.created_at DESC`,
    );
    return rows.map((row) => {
      const tenant = this.mapTenant(row);
      if (row.plan_id && row.plan_name) {
        (tenant as any).plan = {
          id: row.plan_id,
          name: row.plan_name,
          monthlyPrice: parseFloat(row.plan_monthly_price) || 0,
          maxUsers: row.plan_max_users,
          description: row.plan_description,
        };
      }
      return tenant;
    });
  }

  async getStats() {
    // Single round-trip. `monthly_price` is denormalized on `tenants`, so MRR is
    // the sum over tenants that are BOTH active and not past their subscription
    // window (subscription_end NULL = "no expiry", treated as in-window). ARPU
    // divides that MRR over the active-tenant count, guarded by NULLIF so a zero
    // active count yields NULL → coalesced to 0 (never a divide-by-zero).
    const { rows } = await this.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM tenants) AS total_tenants,
         (SELECT COUNT(*) FROM tenants WHERE is_active = true) AS active_tenants,
         (SELECT COUNT(*) FROM users) AS total_users,
         (SELECT COUNT(*) FROM tenants
            WHERE subscription_end IS NOT NULL AND subscription_end < now()) AS expired_tenants,
         (SELECT COALESCE(SUM(monthly_price), 0) FROM tenants
            WHERE is_active = true
              AND (subscription_end IS NULL OR subscription_end >= now())) AS mrr,
         (SELECT COUNT(*) FROM tenants
            WHERE created_at >= date_trunc('month', now())) AS new_tenants_this_month`,
    );
    const r = rows[0];
    const activeTenants = parseInt(r.active_tenants, 10);
    const mrr = Math.round(parseFloat(r.mrr) || 0);
    return {
      totalTenants: parseInt(r.total_tenants, 10),
      activeTenants,
      totalUsers: parseInt(r.total_users, 10),
      expiredTenants: parseInt(r.expired_tenants, 10),
      mrr,
      arpu: activeTenants > 0 ? Math.round(mrr / activeTenants) : 0,
      newTenantsThisMonth: parseInt(r.new_tenants_this_month, 10),
    };
  }

  /**
   * Monthly MRR trend for the admin dashboard (096) — the last N months
   * (default 12, clamped 1..36), OLDEST month first.
   *
   * Autexa keeps NO historical subscription snapshots, so the series is
   * reconstructed from CURRENT tenant/plan state: a tenant contributes to a
   * month if it existed by that month's end and its subscription was still valid
   * then (subscription_end NULL or >= month-end). `is_active` is the current
   * value, used as the activity proxy — an honest approximation, not a ledger
   * replay. `mrr` sums the denormalized tenants.monthly_price of ACTIVE PAYING
   * (monthly_price > 0) tenants, the same source as getStats() so the dashboard
   * stays coherent.
   */
  async getMrrTrends(months?: number): Promise<MrrTrendPoint[]> {
    const n = Math.min(36, Math.max(1, Number.isFinite(months as number) ? Math.trunc(months as number) : 12));
    const { rows } = await this.pool.query(
      `WITH series AS (
         SELECT generate_series(
                  date_trunc('month', now()) - (($1::int - 1) * interval '1 month'),
                  date_trunc('month', now()),
                  interval '1 month'
                ) AS m_start
       )
       SELECT
         to_char(s.m_start, 'YYYY-MM') AS month,
         COALESCE(SUM(t.monthly_price) FILTER (
           WHERE t.is_active = true
             AND COALESCE(t.monthly_price, 0) > 0
             AND (t.subscription_end IS NULL OR t.subscription_end >= s.m_start + interval '1 month')
         ), 0) AS mrr,
         COUNT(t.id) FILTER (
           WHERE t.is_active = true
             AND (t.subscription_end IS NULL OR t.subscription_end >= s.m_start + interval '1 month')
         ) AS active_tenants,
         COUNT(t.id) FILTER (
           WHERE t.created_at >= s.m_start
             AND t.created_at < s.m_start + interval '1 month'
         ) AS new_tenants
       FROM series s
       LEFT JOIN tenants t ON t.created_at < s.m_start + interval '1 month'
       GROUP BY s.m_start
       ORDER BY s.m_start ASC`,
      [n],
    );
    return rows.map((r) => ({
      month: r.month,
      mrr: Math.round(parseFloat(r.mrr) || 0),
      activeTenants: parseInt(r.active_tenants, 10) || 0,
      newTenants: parseInt(r.new_tenants, 10) || 0,
    }));
  }

  /**
   * Per-tenant activity metrics for the owner's "показатели клиента" card.
   *
   * NOTE ON "usage": Autexa has NO per-feature usage tracking. These metrics are
   * ACTIVITY SIGNALS (checks volume, revenue, last-activity, user/product
   * counts) which are the meaningful proxy for how alive a tenant is. They are
   * derived from existing tables filtered by tenant_id; every aggregate is
   * COALESCE-guarded so a brand-new tenant returns zeros, never null.
   */
  async getMetrics(id: string) {
    const { rows: exists } = await this.pool.query(`SELECT created_at FROM tenants WHERE id = $1`, [id]);
    if (exists.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });
    const tenantCreatedAt: string = exists[0].created_at;

    const { rows } = await this.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE tenant_id = $1) AS users_count,
         (SELECT COUNT(*) FROM users
            WHERE tenant_id = $1 AND is_active = true AND dismissed_at IS NULL AND purged_at IS NULL)
            AS active_users_count,
         (SELECT COUNT(*) FROM checks WHERE tenant_id = $1) AS checks_total,
         (SELECT COUNT(*) FROM checks
            WHERE tenant_id = $1 AND created_at >= now() - interval '30 days') AS checks_last_30d,
         (SELECT COALESCE(SUM(total_revenue), 0) FROM checks WHERE tenant_id = $1) AS revenue_total,
         (SELECT COALESCE(SUM(total_revenue), 0) FROM checks
            WHERE tenant_id = $1 AND created_at >= now() - interval '30 days') AS revenue_last_30d,
         (SELECT MAX(created_at) FROM checks WHERE tenant_id = $1) AS last_activity_at,
         (SELECT COUNT(*) FROM products WHERE tenant_id = $1) AS products_count`,
      [id],
    );
    const r = rows[0];

    return {
      usersCount: parseInt(r.users_count, 10) || 0,
      activeUsersCount: parseInt(r.active_users_count, 10) || 0,
      checksTotal: parseInt(r.checks_total, 10) || 0,
      checksLast30d: parseInt(r.checks_last_30d, 10) || 0,
      revenueTotal: parseFloat(r.revenue_total) || 0,
      revenueLast30d: parseFloat(r.revenue_last_30d) || 0,
      // Fall back to the tenant's own creation time when it has zero checks so
      // the card always has a date to show.
      lastActivityAt: (r.last_activity_at ?? tenantCreatedAt) || null,
      productsCount: parseInt(r.products_count, 10) || 0,
    };
  }

  /**
   * Superadmin "drill into a tenant" cabinet (GET /tenants/:id/cabinet). One
   * composed payload: identity + subscription STATUS/plan/price + activity
   * metrics. Reuses getMetrics() for the activity aggregates (no duplicated SQL)
   * and computeSubscriptionStatus() for the status, so the cabinet view and the
   * tenant's own /subscription poll always agree.
   */
  async getCabinet(id: string) {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.name, t.is_active, t.suspended_at, t.suspended_reason,
              t.subscription_end, t.monthly_price, t.max_users, t.plan_id, t.created_at,
              (SELECT COUNT(*) FROM users WHERE tenant_id=t.id) AS current_users,
              p.name AS plan_name
         FROM tenants t
         LEFT JOIN plans p ON p.id = t.plan_id
        WHERE t.id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });
    const r = rows[0];

    // getMetrics re-checks existence (cheap) and returns the activity signals.
    const metrics = await this.getMetrics(id);

    return {
      id: r.id,
      name: r.name,
      isActive: r.is_active === true,
      createdAt: r.created_at,
      subscription: {
        status: this.computeSubscriptionStatus(r),
        planId: r.plan_id ?? null,
        planName: r.plan_name ?? null,
        planPrice: parseFloat(r.monthly_price) || 0,
        subscriptionEnd: r.subscription_end ?? null,
        suspendedAt: r.suspended_at ?? null,
        suspendedReason: r.suspended_reason ?? null,
        maxUsers: r.max_users,
        currentUsers: parseInt(r.current_users, 10) || 0,
      },
      metrics,
    };
  }

  async getById(id: string) {
    const { rows } = await this.pool.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM users WHERE tenant_id=t.id) as user_count
       FROM tenants t WHERE t.id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    const tenant = this.mapTenant(rows[0]);

    const { rows: userRows } = await this.pool.query(
      `SELECT id, phone, full_name, username, avatar, role,
              COALESCE(salary_percent,0) as salary_percent,
              COALESCE(permissions,'{}') as permissions,
              is_active, tenant_id, created_at
       FROM users WHERE tenant_id=$1 ORDER BY created_at`,
      [id],
    );
    (tenant as any).users = userRows.map((u) => ({
      id: u.id,
      phone: u.phone,
      fullName: u.full_name,
      username: u.username,
      avatar: u.avatar,
      role: u.role,
      salaryPercent: parseFloat(u.salary_percent) || 0,
      permissions: typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions,
      isActive: u.is_active,
      tenantId: u.tenant_id,
      createdAt: u.created_at,
    }));

    // Load plan
    if (rows[0].plan_id) {
      const { rows: planRows } = await this.pool.query('SELECT * FROM plans WHERE id=$1', [rows[0].plan_id]);
      if (planRows.length > 0) {
        const p = planRows[0];
        (tenant as any).plan = {
          id: p.id,
          name: p.name,
          monthlyPrice: parseFloat(p.monthly_price) || 0,
          description: p.description,
          features: p.features || [],
          maxUsers: p.max_users,
          isActive: p.is_active,
          sortOrder: p.sort_order,
          createdAt: p.created_at,
        };
      }
    }

    return tenant;
  }

  /**
   * Extend a tenant's subscription by `days`. Anchors on the LATER of the
   * current end and now() so extending an already-expired subscription starts
   * the new window from today (not retroactively from the lapsed date).
   */
  async extend(id: string, days: number, actor?: AuditActor) {
    if (!Number.isFinite(days) || days <= 0) {
      throw new BadRequestException({ message: 'Количество дней должно быть положительным' });
    }
    const { rows } = await this.pool.query(
      `UPDATE tenants
          SET subscription_end = GREATEST(COALESCE(subscription_end, now()), now()) + ($2 * interval '1 day'),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, days],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    if (actor) {
      await this.audit.log(actor, 'tenant_extend', {
        targetType: 'tenant',
        targetId: id,
        targetName: rows[0].name,
        detail: { days, subscriptionEnd: rows[0].subscription_end },
      });
    }

    return this.mapTenant(rows[0]);
  }

  /**
   * Assign a plan to a tenant and SYNC the denormalized monthly_price + max_users
   * from the chosen plan row (so the tenant card and MRR math stay coherent).
   */
  async assignPlan(id: string, planId: string, actor?: AuditActor) {
    const { rows: planRows } = await this.pool.query(
      `SELECT id, name, monthly_price, max_users FROM plans WHERE id = $1`,
      [planId],
    );
    if (planRows.length === 0) throw new NotFoundException({ message: 'Тариф не найден' });
    const plan = planRows[0];

    const { rows } = await this.pool.query(
      `UPDATE tenants
          SET plan_id = $2,
              monthly_price = $3,
              max_users = $4,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, plan.id, plan.monthly_price, plan.max_users],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    if (actor) {
      await this.audit.log(actor, 'tenant_change_plan', {
        targetType: 'tenant',
        targetId: id,
        targetName: rows[0].name,
        detail: { planId: plan.id, planName: plan.name },
      });
    }

    return this.mapTenant(rows[0]);
  }

  /**
   * Explicitly SUSPEND a tenant (superadmin). Stamps `suspended_at` + an optional
   * `suspended_reason` AND flips `is_active=false`, so every existing
   * is_active-based path (MRR exclusion, broadcast audience) stays coherent and
   * the tenant's /subscription status reads `suspended`. Idempotent: re-suspending
   * refreshes the reason but COALESCEs the original suspension instant.
   */
  async suspend(id: string, reason: string | undefined, actor?: AuditActor) {
    const { rows } = await this.pool.query(
      `UPDATE tenants
          SET suspended_at = COALESCE(suspended_at, now()),
              suspended_reason = $2,
              is_active = false,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, reason ?? null],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    if (actor) {
      await this.audit.log(actor, 'tenant_suspend', {
        targetType: 'tenant',
        targetId: id,
        targetName: rows[0].name,
        detail: { reason: reason ?? null },
      });
    }
    return this.mapTenant(rows[0]);
  }

  /**
   * Lift a suspension (superadmin): clear `suspended_at` + `suspended_reason` and
   * re-activate the tenant. The subscription window itself is untouched — if it
   * had already lapsed, the tenant returns to `expired` (not `active`).
   * Idempotent for an already-active tenant.
   */
  async unsuspend(id: string, actor?: AuditActor) {
    const { rows } = await this.pool.query(
      `UPDATE tenants
          SET suspended_at = NULL,
              suspended_reason = NULL,
              is_active = true,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    if (actor) {
      await this.audit.log(actor, 'tenant_unsuspend', {
        targetType: 'tenant',
        targetId: id,
        targetName: rows[0].name,
        detail: {},
      });
    }
    return this.mapTenant(rows[0]);
  }

  /**
   * Impersonation ("войти как владелец"). Mints a SHORT-LIVED (30 min) JWT for
   * the tenant's owner-director so a superadmin can enter their cabinet.
   *
   * The token payload EXACTLY matches what AuthService.generateToken produces
   * ({ sub, tenantId, jti }) so JwtStrategy.validate accepts it as a normal
   * director token — plus an extra `impersonatedBy` claim that the strategy
   * ignores. Signed with the SAME injected JwtService / JWT_SECRET as auth; the
   * 30m expiry is an explicit per-sign override of the module's 7d default.
   */
  async impersonate(id: string, actor?: AuditActor) {
    // Tenant must exist (and be findable) — surfaces a clean 404.
    const { rows: tenantRows } = await this.pool.query(`SELECT id FROM tenants WHERE id = $1`, [id]);
    if (tenantRows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    // Owner = active, non-dismissed, non-purged director; oldest wins if several.
    const { rows } = await this.pool.query(
      `SELECT id, phone, full_name, username, avatar, role,
              COALESCE(salary_percent, 0) AS salary_percent,
              COALESCE(permissions, '{}') AS permissions,
              is_active, tenant_id, created_at
         FROM users
        WHERE tenant_id = $1
          AND role = 'director'
          AND is_active = true
          AND dismissed_at IS NULL
          AND purged_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException({ message: 'У тенанта нет активного владельца' });
    }
    const u = rows[0];

    const jti = randomUUID();
    const token = this.jwtService.sign(
      { sub: u.id, tenantId: u.tenant_id, jti, impersonatedBy: actor?.userId },
      { expiresIn: '30m' },
    );

    if (actor) {
      await this.audit.log(actor, 'impersonate', {
        targetType: 'user',
        targetId: u.id,
        targetName: u.full_name,
        detail: { tenantId: id, impersonatedUserId: u.id },
      });
    }

    const user = {
      id: u.id,
      phone: u.phone,
      fullName: u.full_name,
      username: u.username,
      avatar: u.avatar,
      role: u.role,
      salaryPercent: parseFloat(u.salary_percent) || 0,
      permissions: typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions,
      isActive: u.is_active,
      tenantId: u.tenant_id,
      createdAt: u.created_at,
    };

    return { token, user, expiresIn: 1800 };
  }

  async create(dto: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (name, phone, address, email, description, is_active, max_users, plan_id, monthly_price, subscription_end, subscription_note)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,true),$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          dto.name,
          dto.phone,
          dto.address,
          dto.email,
          dto.description,
          dto.isActive,
          dto.maxUsers || 10,
          dto.planId,
          dto.monthlyPrice || 0,
          dto.subscriptionEnd,
          dto.subscriptionNote,
        ],
      );

      const tenant = this.mapTenant(tenantRows[0]);

      // Seed the three default warehouses for this tenant. Idempotent via
      // ON CONFLICT on the (tenant_id, kind) unique constraint, so retrying
      // tenant creation after a transient failure never duplicates.
      await client.query(
        `INSERT INTO warehouses (tenant_id, name, kind, sort_order) VALUES
           ($1, 'Основной склад', 'main',   0),
           ($1, 'Склад брака',    'defect', 1),
           ($1, 'Склад Б/У',      'used',   2)
         ON CONFLICT (tenant_id, kind) DO NOTHING`,
        [tenant.id],
      );

      // Seed the pinned "Покупка б/у товара" system supplier. Same
      // idempotency story: the partial unique index on (tenant_id, kind)
      // catches a duplicate insert if 033 ran during creation. The
      // WHERE NOT EXISTS is belt + suspenders for the unlikely race.
      await client.query(
        `INSERT INTO suppliers (tenant_id, name, is_system, kind)
           SELECT $1, 'Покупка б/у товара', true, 'used_purchase'
            WHERE NOT EXISTS (
                SELECT 1 FROM suppliers
                 WHERE tenant_id = $1 AND kind = 'used_purchase'
            )`,
        [tenant.id],
      );

      // Create director user if provided
      if (dto.directorPhone && dto.directorPassword && dto.directorName) {
        const directorPhone = normalizePhone(dto.directorPhone);
        const hash = await bcrypt.hash(dto.directorPassword, 10);
        const allPerms =
          '{"checks_view":true,"checks_create":true,"checks_edit":true,"checks_delete":true,"checks_change_datetime":true,"profit_view":true,"clients_view":true,"clients_edit":true,"warehouse_access":true,"suppliers_access":true,"financial_reports":true,"export_data":true,"user_management":true,"schedule_view":true,"salary_view":true,"marketing_access":true}';
        await client.query(
          `INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions)
           VALUES ($1, $2, $3, 'director', true, $4, $5)`,
          [directorPhone, hash, dto.directorName, tenant.id, allPerms],
        );
      }

      await client.query('COMMIT');
      return tenant;
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Tenant create error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  async update(id: string, dto: any, actor?: AuditActor) {
    // Snapshot the BEFORE state of the fields we audit so we only log on an
    // actual change (PATCH is partial — an unchanged field must not emit noise).
    let before: { is_active: boolean; plan_id: string | null; name: string } | null = null;
    if (actor && (dto.isActive !== undefined || dto.planId !== undefined)) {
      const { rows } = await this.pool.query(`SELECT is_active, plan_id, name FROM tenants WHERE id = $1`, [id]);
      before = rows[0] ?? null;
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.phone !== undefined) {
      sets.push(`phone=$${idx++}`);
      vals.push(dto.phone);
    }
    if (dto.address !== undefined) {
      sets.push(`address=$${idx++}`);
      vals.push(dto.address);
    }
    if (dto.email !== undefined) {
      sets.push(`email=$${idx++}`);
      vals.push(dto.email);
    }
    if (dto.description !== undefined) {
      sets.push(`description=$${idx++}`);
      vals.push(dto.description);
    }
    if (dto.isActive !== undefined) {
      sets.push(`is_active=$${idx++}`);
      vals.push(dto.isActive);
    }
    if (dto.maxUsers !== undefined) {
      sets.push(`max_users=$${idx++}`);
      vals.push(dto.maxUsers);
    }
    if (dto.planId !== undefined) {
      sets.push(`plan_id=$${idx++}`);
      vals.push(dto.planId);
    }
    if (dto.monthlyPrice !== undefined) {
      sets.push(`monthly_price=$${idx++}`);
      vals.push(dto.monthlyPrice);
    }
    if (dto.subscriptionEnd !== undefined) {
      sets.push(`subscription_end=$${idx++}`);
      vals.push(dto.subscriptionEnd);
    }
    if (dto.subscriptionNote !== undefined) {
      sets.push(`subscription_note=$${idx++}`);
      vals.push(dto.subscriptionNote);
    }
    if (dto.legalName !== undefined) {
      sets.push(`legal_name=$${idx++}`);
      vals.push(dto.legalName);
    }
    if (dto.inn !== undefined) {
      sets.push(`inn=$${idx++}`);
      vals.push(dto.inn);
    }
    if (dto.kpp !== undefined) {
      sets.push(`kpp=$${idx++}`);
      vals.push(dto.kpp);
    }
    if (dto.ogrn !== undefined) {
      sets.push(`ogrn=$${idx++}`);
      vals.push(dto.ogrn);
    }
    if (dto.receiptFooter !== undefined) {
      sets.push(`receipt_footer=$${idx++}`);
      vals.push(dto.receiptFooter);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push(`updated_at=now()`);
    vals.push(id);

    const { rows } = await this.pool.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id=$${idx++} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });
    const updated = this.mapTenant(rows[0]);

    // Best-effort audit: only on a real change of a tracked field.
    if (actor && before) {
      if (dto.isActive !== undefined && dto.isActive !== before.is_active) {
        await this.audit.log(actor, 'tenant_toggle_active', {
          targetType: 'tenant',
          targetId: id,
          targetName: before.name,
          detail: { from: before.is_active, to: dto.isActive },
        });
      }
      if (dto.planId !== undefined && dto.planId !== before.plan_id) {
        await this.audit.log(actor, 'tenant_change_plan', {
          targetType: 'tenant',
          targetId: id,
          targetName: before.name,
          detail: { from: before.plan_id, to: dto.planId },
        });
      }
    }

    return updated;
  }

  async remove(id: string, actor?: AuditActor) {
    // Capture the tenant name for the audit row BEFORE the cascade wipes it.
    if (actor) {
      const { rows } = await this.pool.query(`SELECT name FROM tenants WHERE id = $1`, [id]);
      if (rows.length > 0) {
        await this.audit.log(actor, 'tenant_delete', {
          targetType: 'tenant',
          targetId: id,
          targetName: rows[0].name,
          detail: {},
        });
      }
    }
    return this.removeInternal(id);
  }

  /**
   * Public, audit-less entry to the authoritative tenant teardown cascade.
   * Used by the self-service account-deletion grace-period purge (AccountService)
   * so the physical delete is performed by the SAME ordered cascade as the
   * superadmin `remove()` action — no duplicated DELETE logic that could drift
   * from the schema. The deletion was already audited at REQUEST time, so this
   * batch path intentionally does not re-audit.
   */
  async purgeTenantData(id: string) {
    return this.removeInternal(id);
  }

  private async removeInternal(id: string) {
    // Full cascade delete — manually remove child records in correct order
    // to avoid FK constraint violations (some FKs lack ON DELETE CASCADE)
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Remove check line items (reference services/products/users without CASCADE)
      await client.query(
        `DELETE FROM check_service_lines WHERE check_id IN (SELECT id FROM checks WHERE tenant_id=$1)`,
        [id],
      );
      await client.query(
        `DELETE FROM check_product_lines WHERE check_id IN (SELECT id FROM checks WHERE tenant_id=$1)`,
        [id],
      );

      // 2. Remove delivery items (reference products without CASCADE)
      await client.query(
        `DELETE FROM delivery_items WHERE delivery_id IN (SELECT id FROM deliveries WHERE tenant_id=$1)`,
        [id],
      );

      // 3. Remove checks (reference users/clients/cars without CASCADE)
      await client.query('DELETE FROM checks WHERE tenant_id=$1', [id]);

      // 4. Remove remaining tenant-owned data (all have ON DELETE CASCADE from tenant,
      //    but explicit delete ensures correct order)
      await client.query('DELETE FROM expenses WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM expense_categories WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM stock_movements WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM supplier_payments WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM deliveries WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM suppliers WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM schedule_entries WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM work_modes WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM shifts WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM cars WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM clients WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM services WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM products WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM warehouse_categories WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM warranty_claims WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM warehouses WHERE tenant_id=$1', [id]);
      await client.query('DELETE FROM users WHERE tenant_id=$1', [id]);

      // 5. Finally delete the tenant itself
      const { rowCount } = await client.query('DELETE FROM tenants WHERE id=$1', [id]);
      if (rowCount === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Тенант не найден' });
      }

      await client.query('COMMIT');
      return { message: 'Удалено' };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`Tenant delete error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка при удалении автосервиса' });
    } finally {
      client.release();
    }
  }

  async getMyCompany(tenantId: string) {
    const { rows } = await this.pool.query('SELECT * FROM tenants WHERE id=$1', [tenantId]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Компания не найдена' });
    return this.mapTenant(rows[0]);
  }

  async updateMyCompany(tenantId: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    // Only allow company-info fields (not admin fields like isActive, maxUsers)
    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.phone !== undefined) {
      sets.push(`phone=$${idx++}`);
      vals.push(dto.phone);
    }
    if (dto.address !== undefined) {
      sets.push(`address=$${idx++}`);
      vals.push(dto.address);
    }
    if (dto.email !== undefined) {
      sets.push(`email=$${idx++}`);
      vals.push(dto.email);
    }
    if (dto.description !== undefined) {
      sets.push(`description=$${idx++}`);
      vals.push(dto.description);
    }
    if (dto.legalName !== undefined) {
      sets.push(`legal_name=$${idx++}`);
      vals.push(dto.legalName);
    }
    if (dto.inn !== undefined) {
      sets.push(`inn=$${idx++}`);
      vals.push(dto.inn);
    }
    if (dto.kpp !== undefined) {
      sets.push(`kpp=$${idx++}`);
      vals.push(dto.kpp);
    }
    if (dto.ogrn !== undefined) {
      sets.push(`ogrn=$${idx++}`);
      vals.push(dto.ogrn);
    }
    if (dto.receiptFooter !== undefined) {
      sets.push(`receipt_footer=$${idx++}`);
      vals.push(dto.receiptFooter);
    }
    if (dto.shiftsEnabled !== undefined) {
      sets.push(`shifts_enabled=$${idx++}`);
      vals.push(dto.shiftsEnabled === true);
    }
    if (dto.shiftModeEnabled !== undefined) {
      sets.push(`shift_mode_enabled=$${idx++}`);
      vals.push(dto.shiftModeEnabled === true);
    }

    if (sets.length === 0) return this.getMyCompany(tenantId);

    sets.push(`updated_at=now()`);
    vals.push(tenantId);

    const { rows } = await this.pool.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id=$${idx++} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Компания не найдена' });
    return this.mapTenant(rows[0]);
  }

  async getSubscription(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT t.name, t.monthly_price, t.subscription_end, t.subscription_note,
              t.max_users, t.plan_id, t.is_active, t.suspended_at,
              (SELECT COUNT(*) FROM users WHERE tenant_id=t.id) as current_users
       FROM tenants t WHERE t.id=$1`,
      [tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

    const r = rows[0];
    const status = this.computeSubscriptionStatus(r);
    const planPrice = parseFloat(r.monthly_price) || 0;

    // Resolve the CURRENT plan by the tenant's plan_id (the authoritative link),
    // not by name. Expose its feature keys directly as `features` so clients
    // gate on `sub.features.includes(key)` instead of the fragile name match.
    // `planName` stays for backward-compat with shipped clients.
    let planName: string | null = null;
    let features: string[] = [];
    if (r.plan_id) {
      const { rows: planRows } = await this.pool.query('SELECT name, features FROM plans WHERE id=$1', [r.plan_id]);
      if (planRows.length > 0) {
        planName = planRows[0].name;
        features = Array.isArray(planRows[0].features) ? planRows[0].features : [];
      }
    }

    const { rows: plans } = await this.pool.query(
      'SELECT * FROM plans WHERE is_active=true ORDER BY sort_order, monthly_price',
    );

    return {
      tenantName: r.name,
      planId: r.plan_id ?? null,
      planName,
      features,
      // `status` (102) lets every client render a professional block message +
      // hard gate. `planPrice` is an explicit alias of the effective price for
      // the same block screens; `monthlyPrice` is kept for shipped clients.
      status,
      planPrice,
      monthlyPrice: planPrice,
      subscriptionEnd: r.subscription_end,
      subscriptionNote: r.subscription_note,
      maxUsers: r.max_users,
      currentUsers: parseInt(r.current_users),
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        monthlyPrice: parseFloat(p.monthly_price) || 0,
        description: p.description,
        features: p.features || [],
        maxUsers: p.max_users,
        isActive: p.is_active,
        sortOrder: p.sort_order,
        createdAt: p.created_at,
      })),
    };
  }
}
