import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';
import { invalidateAuthUser } from '../common/auth-cache';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { PushService } from '../push/push.service';
import { TenantsService } from '../tenants/tenants.service';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { DeleteAccountDto } from './dto/delete-account.dto';

export type AccountDeletionStatus = 'account_deleted' | 'tenant_deletion_requested';

export interface DeleteAccountResult {
  status: AccountDeletionStatus;
  message: string;
  /** Set only for status === 'tenant_deletion_requested'. */
  deletionRequestedAt?: string;
  /** When the residual (financial) data is physically purged. ISO. */
  purgeScheduledAt?: string;
}

/**
 * Self-service account deletion (Apple 5.1.1(v) + Google Play data-deletion).
 *
 * Two branches keyed off the caller's role:
 *
 *  • DIRECTOR (the account holder) → TENANT account deletion. We mark the tenant
 *    `deletion_requested_at`, immediately revoke access for EVERY user in the
 *    tenant (is_active=false → login + JWT validation both reject at once), and
 *    schedule a physical hard-purge after a short grace window. During the grace
 *    the tenant is fully deactivated and unreachable, so no personal data is
 *    processed; at purge, the entire tenant (all PII + financial rows) is
 *    irreversibly deleted via the authoritative cascade (TenantsService).
 *    The grace exists so an accidental/coerced deletion can be reversed by the
 *    operator (superadmin) on the customer's request, and so financial records
 *    survive long enough for accounting — it is NOT a self-serve "undo".
 *
 *  • NON-DIRECTOR employee (master / admin) → delete only THEIR OWN user record.
 *    We ANONYMIZE the personal data immediately (name/phone/avatar/username
 *    scrubbed, password made unusable), set is_active=false + purged_at so they
 *    can never log in again, and stamp deleted_at. The row itself is kept so the
 *    historical checks/shifts/salary that FK-reference it still resolve a
 *    (now anonymized) name — referential integrity without retaining PII.
 *
 * The deterministic App-Review DEMO tenant is deletion-EXEMPT: the endpoint
 * returns success so a reviewer can walk the full in-app flow, but the demo data
 * is preserved so the credentials keep working for the next review.
 *
 * The platform owner (superadmin) cannot self-delete through this path — they are
 * the SaaS operator, not a tenant account, and are managed out-of-band.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger('AccountService');

  /** Hard-purge a deletion-requested tenant after this many days of grace. */
  private static readonly GRACE_DAYS = 30;

  /**
   * The seeded App Store / Google Play review tenant (migration 094). Deletion
   * is a no-op for this id so review credentials survive a reviewer testing the
   * delete flow.
   */
  private static readonly DEMO_TENANT_ID = 'de100000-0000-4000-a000-000000000002';

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private push: PushService,
    private tenants: TenantsService,
  ) {}

  async deleteAccount(user: JwtPayload, dto: DeleteAccountDto): Promise<DeleteAccountResult> {
    // Explicit re-confirmation flag from the destructive dialog.
    if (dto.confirm !== true) {
      throw new BadRequestException({ message: 'Удаление аккаунта требует подтверждения' });
    }

    // Load the caller's own row to re-verify the password (re-authentication).
    const { rows } = await this.pool.query(
      `SELECT id, password, role, COALESCE(tenant_id::text, '') AS tenant_id
         FROM users WHERE id = $1 LIMIT 1`,
      [user.userID],
    );
    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Пользователь не найден' });
    }
    const row = rows[0] as { id: string; password: string; role: string; tenant_id: string };

    // Re-authenticate with the current password. bcrypt.compare returns false
    // (never throws) for a wrong password or an unusable stored hash.
    const ok = await bcrypt.compare(dto.password, row.password || '');
    if (!ok) {
      throw new UnauthorizedException({ message: 'Неверный пароль' });
    }

    if (row.role === 'superadmin') {
      // Platform operator account — not a deletable tenant account.
      throw new ForbiddenException({
        message: 'Аккаунт владельца платформы нельзя удалить из приложения',
      });
    }

    const tenantId = row.tenant_id || '';

    if (row.role === 'director' && tenantId) {
      return this.requestTenantDeletion(user.userID, tenantId);
    }

    // master / admin (or a director without a tenant — defensive fallback).
    return this.deleteOwnUser(user.userID, tenantId);
  }

  // ── Director branch — close the whole tenant account ──────────────────────
  private async requestTenantDeletion(userId: string, tenantId: string): Promise<DeleteAccountResult> {
    if (tenantId === AccountService.DEMO_TENANT_ID) {
      // Demo account: report success, change nothing (see class doc).
      this.logger.log(`Account deletion requested on DEMO tenant by ${userId} — no-op (preserved for review)`);
      const now = new Date();
      return {
        status: 'tenant_deletion_requested',
        message: 'Запрос на удаление аккаунта принят',
        deletionRequestedAt: now.toISOString(),
        purgeScheduledAt: this.addDays(now, AccountService.GRACE_DAYS).toISOString(),
      };
    }

    // Capture the tenant name for the operator notification BEFORE we mutate it,
    // and the full set of user ids so we can drop their auth-cache + push tokens.
    const { rows: tRows } = await this.pool.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);
    const tenantName: string = tRows[0]?.name ?? 'Автосервис';

    const client = await this.pool.connect();
    let userIds: string[] = [];
    let deletionRequestedAt: string;
    try {
      await client.query('BEGIN');

      // Flag the tenant; COALESCE so a repeat request keeps the ORIGINAL instant
      // (the grace window is anchored to the FIRST request — idempotent).
      const { rows: flagged } = await client.query(
        `UPDATE tenants
            SET deletion_requested_at = COALESCE(deletion_requested_at, now()),
                deletion_requested_by = COALESCE(deletion_requested_by, $2),
                is_active = false,
                updated_at = now()
          WHERE id = $1
          RETURNING deletion_requested_at`,
        [tenantId, userId],
      );
      deletionRequestedAt =
        flagged[0]?.deletion_requested_at instanceof Date
          ? flagged[0].deletion_requested_at.toISOString()
          : String(flagged[0]?.deletion_requested_at ?? new Date().toISOString());

      // Immediate access revocation for EVERY account in the tenant. Legacy
      // clients on old builds see "Аккаунт деактивирован" on next call.
      const { rows: uRows } = await client.query(
        `UPDATE users SET is_active = false, updated_at = now()
          WHERE tenant_id = $1
          RETURNING id`,
        [tenantId],
      );
      userIds = uRows.map((r: { id: string }) => r.id);

      // Mark the requester specifically as a self-service deletion.
      await client.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [userId]);

      // Stop pushing to every device in the tenant.
      await client.query(`DELETE FROM push_tokens WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)`, [
        tenantId,
      ]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`requestTenantDeletion failed for tenant=${tenantId}: ${err}`);
      throw err;
    } finally {
      client.release();
    }

    // Drop cached JWT validations so the revocation is effective immediately,
    // not after the 30s auth-cache TTL.
    for (const id of userIds) invalidateAuthUser(id);

    // Notify the SaaS owner (superadmin) over the existing push transport —
    // fire-and-forget AFTER commit so push latency never blocks the response.
    void this.notifySuperadminOfTenantDeletion(tenantId, tenantName, userId);

    return {
      status: 'tenant_deletion_requested',
      message:
        'Аккаунт автосервиса деактивирован и будет полностью удалён. Чтобы отменить — обратитесь в поддержку в течение срока ожидания.',
      deletionRequestedAt,
      purgeScheduledAt: this.addDays(new Date(deletionRequestedAt), AccountService.GRACE_DAYS).toISOString(),
    };
  }

  // ── Employee branch — anonymize + retire the caller's own user row ─────────
  private async deleteOwnUser(userId: string, tenantId: string): Promise<DeleteAccountResult> {
    if (tenantId === AccountService.DEMO_TENANT_ID) {
      this.logger.log(`Self account deletion on DEMO tenant by ${userId} — no-op (preserved for review)`);
      return { status: 'account_deleted', message: 'Аккаунт удалён' };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Anonymize PII immediately. The row is KEPT (FKs in checks/shifts/salary
      // reference it) but no longer carries personal data:
      //   • full_name → neutral placeholder
      //   • phone     → unique non-PII sentinel ('deleted:<uuid>'); phone is
      //                 UNIQUE, so a per-row value avoids a collision on a second
      //                 self-deletion.
      //   • username / avatar → cleared
      //   • password  → unusable sentinel (never a valid bcrypt hash → no login)
      //   • is_active=false + purged_at → blocks login + JWT validation forever
      //   • deleted_at → audit marker for a self-service deletion
      await client.query(
        `UPDATE users
            SET full_name   = 'Удалённый пользователь',
                phone       = 'deleted:' || id::text,
                username    = NULL,
                avatar      = NULL,
                password    = '!account-deleted!',
                is_active   = false,
                dismissed_at = COALESCE(dismissed_at, now()),
                purged_at    = COALESCE(purged_at, now()),
                deleted_at   = now(),
                updated_at   = now()
          WHERE id = $1`,
        [userId],
      );

      await client.query(`DELETE FROM push_tokens WHERE user_id = $1`, [userId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`deleteOwnUser failed for user=${userId}: ${err}`);
      throw err;
    } finally {
      client.release();
    }

    invalidateAuthUser(userId);

    return { status: 'account_deleted', message: 'Аккаунт удалён' };
  }

  /**
   * Best-effort: tell every active superadmin that a tenant asked to close its
   * account, so the operator can follow up / cancel within the grace window.
   * Reuses the existing push path (sendToUser) — no new transport. Never throws.
   */
  private async notifySuperadminOfTenantDeletion(
    tenantId: string,
    tenantName: string,
    requestedBy: string,
  ): Promise<void> {
    try {
      const { rows } = await this.pool.query(`SELECT id FROM users WHERE role = 'superadmin' AND is_active = true`);
      const data = {
        type: 'tenant_deletion_requested' as const,
        tenantId,
        tenantName,
        requestedBy,
      };
      await Promise.all(
        rows.map((r: { id: string }) =>
          this.push.sendToUser(
            r.id,
            'Запрос на удаление аккаунта',
            `Автосервис «${tenantName}» запросил удаление аккаунта`,
            data,
          ),
        ),
      );
    } catch (err) {
      this.logger.warn(`notifySuperadminOfTenantDeletion failed for tenant=${tenantId}: ${err}`);
    }
  }

  /**
   * Daily grace-period purge: physically delete tenants whose deletion request
   * is older than GRACE_DAYS. Uses the SAME authoritative cascade as the
   * superadmin "delete tenant" action (TenantsService) — single source of truth,
   * no duplicated DELETE order. Gated by RUN_BACKGROUND_JOBS so only the leader
   * replica runs it. Best-effort per tenant: one failure never blocks the rest.
   */
  @Cron('41 4 * * *', { timeZone: 'Europe/Moscow' })
  async purgeExpiredDeletions(): Promise<void> {
    if (!RUN_BACKGROUND_JOBS) return;
    try {
      const { rows } = await this.pool.query(
        `SELECT id, name FROM tenants
          WHERE deletion_requested_at IS NOT NULL
            AND deletion_requested_at < now() - ($1 * interval '1 day')
            AND id <> $2`,
        [AccountService.GRACE_DAYS, AccountService.DEMO_TENANT_ID],
      );
      if (rows.length === 0) return;

      let purged = 0;
      for (const t of rows as { id: string; name: string }[]) {
        try {
          await this.tenants.purgeTenantData(t.id);
          purged++;
        } catch (err) {
          this.logger.error(`Grace-period purge failed for tenant=${t.id} (${t.name}): ${err}`);
        }
      }
      if (purged > 0) {
        this.logger.log(
          `Grace-period purge removed ${purged}/${rows.length} tenant(s) past the ${AccountService.GRACE_DAYS}-day window`,
        );
      }
    } catch (err) {
      this.logger.error(`purgeExpiredDeletions failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private addDays(from: Date, days: number): Date {
    return new Date(from.getTime() + days * 86_400_000);
  }
}
