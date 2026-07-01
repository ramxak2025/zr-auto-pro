import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';

/**
 * Identity of the operator performing a privileged action. `userId` comes from
 * the JWT (`JwtPayload.userID`); `name` is resolved best-effort so the audit
 * row stays human-readable even after the actor's user row is gone.
 */
export interface AuditActor {
  userId: string;
  name?: string | null;
}

export interface AuditTarget {
  targetType?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  detail?: Record<string, unknown>;
}

/** One row of admin_audit_log, mapped to the shared AuditLogEntry shape. */
export interface AuditLogEntryRow {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/**
 * Append-only audit trail for SUPERADMIN PLATFORM actions (068_admin_audit_log).
 *
 * `log()` is BEST-EFFORT: it never throws. A failure to write the audit row
 * must not fail the underlying privileged action (toggle/extend/assign/delete/
 * impersonate). Errors are logged and swallowed.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('AuditService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Resolve an actor's display name from the users table. Best-effort —
   * returns null if the lookup fails or the user is gone. Callers can pass the
   * resolved name into `log()` so the denormalized `actor_name` is populated.
   */
  async resolveActorName(userId: string): Promise<string | null> {
    try {
      const { rows } = await this.pool.query<{ full_name: string | null }>(
        `SELECT full_name FROM users WHERE id = $1 LIMIT 1`,
        [userId],
      );
      return rows[0]?.full_name ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Write one audit entry. Never throws — a logging failure is swallowed so the
   * caller's primary action still succeeds.
   */
  async log(actor: AuditActor, action: string, target: AuditTarget = {}): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO admin_audit_log
           (actor_user_id, actor_name, action, target_type, target_id, target_name, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          actor.userId,
          actor.name ?? null,
          action,
          target.targetType ?? null,
          target.targetId ?? null,
          target.targetName ?? null,
          JSON.stringify(target.detail ?? {}),
        ],
      );
    } catch (err) {
      this.logger.error(`audit log failed (action=${action}): ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * TRANSACTIONAL audit write — runs the SAME INSERT as {@link log} but on a
   * caller-supplied transaction connection so the audit row commits ATOMICALLY
   * with the caller's change. Unlike `log()` this does NOT swallow errors: the
   * caller has deliberately chosen atomicity (used by ChecksService for the
   * closed-check money edit #61 — "it's money data", so a committed edit is
   * GUARANTEED to carry its audit row, and an audit failure rolls the edit back
   * rather than leaving an un-audited money change). Once a statement errors
   * inside a transaction Postgres aborts it anyway, so swallowing here would be
   * a lie; propagating lets the caller's BEGIN/ROLLBACK do the right thing.
   */
  async logTx(client: PoolClient, actor: AuditActor, action: string, target: AuditTarget = {}): Promise<void> {
    await client.query(
      `INSERT INTO admin_audit_log
         (actor_user_id, actor_name, action, target_type, target_id, target_name, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        actor.userId,
        actor.name ?? null,
        action,
        target.targetType ?? null,
        target.targetId ?? null,
        target.targetName ?? null,
        JSON.stringify(target.detail ?? {}),
      ],
    );
  }

  /** Recent audit entries for the SUPERADMIN PLATFORM cabinet. */
  async list(limit = 50): Promise<AuditLogEntryRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, actor_name, action, target_type, target_id, target_name, detail, created_at
         FROM admin_audit_log
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      actorName: r.actor_name ?? null,
      action: r.action,
      targetType: r.target_type ?? null,
      targetId: r.target_id ?? null,
      targetName: r.target_name ?? null,
      detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : (r.detail ?? {}),
      createdAt: r.created_at,
    }));
  }
}
