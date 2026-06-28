import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { PushService } from '../push/push.service';
import { AuditService, AuditActor } from '../tenants/audit.service';
import { CreateBroadcastDto, BroadcastSegmentDto, BroadcastSubscriptionStatus } from './dto/notifications.dto';

// Shape returned to clients — matches the shared `Broadcast` type
// (shared/types/index.ts). Exported so the controller's inferred return types
// can be named (TS4053).
export interface BroadcastButton {
  label: string;
  action: 'dismiss' | 'link';
  url?: string;
}

/**
 * Normalized recipient segment (096), persisted as the `segment` JSONB. Matches
 * the shared `BroadcastSegment` type. Absence (null) == broadcast to all.
 */
export interface BroadcastSegment {
  planIds?: string[];
  subscriptionStatuses?: BroadcastSubscriptionStatus[];
  activity?: 'active' | 'dormant';
  activityWindowDays?: number;
  includeInactive?: boolean;
}

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  buttons: BroadcastButton[];
  createdAt: string;
  // 096 — additive. `scheduledAt` is the delivery instant (≈ createdAt for an
  // immediate send). `sentAt` is when fan-out fired; null = still queued.
  scheduledAt?: string | null;
  sentAt?: string | null;
}

// History row for the superadmin broadcast cabinet (GET /admin/broadcasts).
// Matches the shared `BroadcastHistoryItem` type (shared/types/index.ts).
// `cancelledAt` is the revoke marker (null = live); `seenCount` is how many
// directors have acknowledged it. 096 adds schedule + segment columns.
export interface BroadcastHistoryItem {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  buttons: BroadcastButton[];
  createdAt: string;
  cancelledAt: string | null;
  seenCount: number;
  // 096
  scheduledAt: string | null;
  sentAt: string | null;
  segment: BroadcastSegment | null;
  targetAll: boolean;
  recipientCount: number;
}

/**
 * Notifications domain (066 + 067 + 078 + 096):
 *   * per-user mute preferences (opt-out model — a row == muted);
 *   * superadmin → director broadcasts, persisted so a missed push can be
 *     re-fetched on app open, with per-user "seen" tracking, cancel/revoke, and
 *     (096) optional targeting segments + scheduled (deferred) delivery.
 *
 * PushModule is @Global, so PushService is injectable here without an import.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private push: PushService,
    private audit: AuditService,
  ) {}

  // ─── Preferences ───────────────────────────────────────────────────────────

  /** The categories this user has MUTED (opt-out). Absence == subscribed. */
  async getPreferences(userId: string): Promise<{ muted: string[] }> {
    const { rows } = await this.pool.query(`SELECT category FROM notification_mutes WHERE user_id=$1`, [userId]);
    return { muted: rows.map((r: { category: string }) => r.category) };
  }

  /**
   * Replace the user's mute set wholesale: delete all existing rows, insert the
   * provided categories. Categories are validated against the canonical set in
   * the DTO (@IsIn), so by here `muted` is already safe. Runs in a transaction
   * so a partial write can't leave a torn preference state.
   */
  async updatePreferences(userId: string, muted: string[]): Promise<{ muted: string[] }> {
    const unique = Array.from(new Set(muted));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM notification_mutes WHERE user_id=$1`, [userId]);
      for (const category of unique) {
        await client.query(
          `INSERT INTO notification_mutes (user_id, category)
           VALUES ($1, $2)
           ON CONFLICT (user_id, category) DO NOTHING`,
          [userId, category],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { muted: unique };
  }

  // ─── Broadcasts (read side) ──────────────────────────────────────────────────

  /**
   * Broadcasts this user has NOT yet seen, newest first, capped at 5.
   *
   * Visibility is filtered at SOURCE:
   *   * `cancelled_at IS NULL` — a revoked broadcast vanishes for EVERY director.
   *   * `sent_at IS NOT NULL`  — a QUEUED scheduled broadcast (096) does not
   *                              surface until the scheduler fires it.
   *   * targeting (096)        — a segmented broadcast surfaces only to its
   *                              materialized recipient tenants; `target_all`
   *                              broadcasts skip the join and reach everyone.
   */
  async listUnseenBroadcasts(userId: string, tenantId?: string | null): Promise<Broadcast[]> {
    const { rows } = await this.pool.query(
      `SELECT b.id, b.title, b.body, b.image_url, b.buttons, b.created_at, b.scheduled_at, b.sent_at
         FROM notification_broadcasts b
        WHERE b.cancelled_at IS NULL
          AND b.sent_at IS NOT NULL
          AND (
            b.target_all = true
            OR EXISTS (
              SELECT 1 FROM notification_broadcast_recipients r
               WHERE r.broadcast_id = b.id AND r.tenant_id = $2
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM notification_broadcast_seen s
             WHERE s.broadcast_id = b.id AND s.user_id = $1
          )
        ORDER BY b.created_at DESC
        LIMIT 5`,
      [userId, tenantId ?? null],
    );
    return rows.map(mapBroadcast);
  }

  /** Mark a broadcast as seen by this user (idempotent upsert). */
  async markBroadcastSeen(userId: string, broadcastId: string): Promise<{ ok: true }> {
    await this.pool.query(
      `INSERT INTO notification_broadcast_seen (broadcast_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (broadcast_id, user_id) DO NOTHING`,
      [broadcastId, userId],
    );
    return { ok: true };
  }

  // ─── Broadcasts (admin history + revoke — superadmin) ────────────────────────

  /**
   * Full broadcast history for the superadmin cabinet, newest-first. Includes
   * QUEUED scheduled broadcasts (sent_at IS NULL) so the owner sees what's
   * pending. Counts use scalar subqueries (not LEFT JOIN + GROUP BY) so the
   * seen / recipient counts never multiply each other.
   */
  async listBroadcasts(): Promise<BroadcastHistoryItem[]> {
    const { rows } = await this.pool.query(
      `SELECT b.id, b.title, b.body, b.image_url, b.buttons, b.created_at, b.cancelled_at,
              b.scheduled_at, b.sent_at, b.segment, b.target_all,
              (SELECT COUNT(*) FROM notification_broadcast_seen s WHERE s.broadcast_id = b.id)::int AS seen_count,
              (SELECT COUNT(*) FROM notification_broadcast_recipients r WHERE r.broadcast_id = b.id)::int
                AS recipient_count
         FROM notification_broadcasts b
        ORDER BY b.created_at DESC
        LIMIT 100`,
    );
    return rows.map(mapBroadcastHistory);
  }

  /**
   * Revoke a broadcast: stamp `cancelled_at` so it stops surfacing to every
   * director at once (the unseen query filters `cancelled_at IS NULL`).
   *
   * For a QUEUED scheduled broadcast (096) this ALSO prevents send: the
   * scheduler's due scan filters `cancelled_at IS NULL`, and the atomic claim in
   * `releaseBroadcast` re-checks it, so cancel-before-send always wins.
   *
   * Idempotent — COALESCE preserves the original cancel instant on re-cancel.
   * Throws NotFound only when the id doesn't exist. Audit-logged as
   * `broadcast_cancel` (best-effort, mirrors the tenants audit pattern).
   */
  async cancelBroadcast(id: string, actor: AuditActor): Promise<{ ok: true }> {
    const { rows } = await this.pool.query(
      `UPDATE notification_broadcasts
          SET cancelled_at = COALESCE(cancelled_at, now())
        WHERE id = $1
        RETURNING id, title, cancelled_at`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Broadcast not found');
    }
    const row = rows[0] as { id: string; title: string; cancelled_at: Date | string };
    const cancelledAt = typeof row.cancelled_at === 'string' ? row.cancelled_at : row.cancelled_at.toISOString();
    await this.audit.log(actor, 'broadcast_cancel', {
      targetType: 'broadcast',
      targetId: row.id,
      targetName: row.title,
      detail: { cancelledAt },
    });
    return { ok: true };
  }

  // ─── Broadcasts (write side — superadmin) ────────────────────────────────────

  /**
   * Persist a broadcast. If `scheduledAt` (096) is in the FUTURE, the row is
   * QUEUED (sent_at stays NULL) and the scheduler releases it when due — nothing
   * is sent now. Otherwise it is released SYNCHRONOUSLY (scheduled_at = now()),
   * so delivery is instant; the scheduler is a safety net that would retry it.
   *
   * A body with neither `scheduledAt` nor `segment` reproduces the exact pre-096
   * behaviour: immediate fan-out to every active director.
   */
  async broadcast(createdBy: string, dto: CreateBroadcastDto): Promise<Broadcast> {
    const buttons = dto.buttons ?? [];
    const segment = normalizeSegment(dto.segment);
    const targetAll = segment === null;

    const nowMs = Date.now();
    const scheduledMs = dto.scheduledAt ? new Date(dto.scheduledAt).getTime() : NaN;
    // >1s in the future counts as deferred; anything else sends immediately.
    const isDeferred = Number.isFinite(scheduledMs) && scheduledMs > nowMs + 1000;
    const scheduledAtIso = new Date(isDeferred ? scheduledMs : nowMs).toISOString();

    const { rows } = await this.pool.query(
      `INSERT INTO notification_broadcasts
         (title, body, image_url, buttons, created_by, scheduled_at, segment, target_all)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8)
       RETURNING id`,
      [
        dto.title,
        dto.body,
        dto.imageUrl ?? null,
        JSON.stringify(buttons),
        createdBy,
        scheduledAtIso,
        segment ? JSON.stringify(segment) : null,
        targetAll,
      ],
    );
    const id = rows[0].id as string;

    if (!isDeferred) {
      // Release now for instant delivery. If this throws, the row is still
      // scheduled_at = now() & unsent, so the per-minute scheduler retries it.
      await this.releaseBroadcast(id);
    }

    const { rows: fresh } = await this.pool.query(
      `SELECT id, title, body, image_url, buttons, created_at, scheduled_at, sent_at
         FROM notification_broadcasts WHERE id = $1`,
      [id],
    );
    return mapBroadcast(fresh[0]);
  }

  /**
   * Release ONE broadcast: atomically claim it (flip sent_at NULL→now()),
   * materialize its recipient tenants if segmented, then fire push (best-effort).
   *
   * The claim (`WHERE sent_at IS NULL AND cancelled_at IS NULL`) is the
   * idempotency + anti-double-send guard: only the first caller (the request, or
   * a scheduler tick — never both) wins; a cancelled broadcast is never claimed.
   * The recipient materialization + claim share ONE transaction, so a failure
   * rolls BOTH back and the broadcast is retried unsent (never half-released).
   * Push is fired AFTER commit and is fire-and-forget — a missed push is
   * recoverable via listUnseenBroadcasts (the persisted row is the source truth).
   */
  async releaseBroadcast(id: string): Promise<void> {
    const client = await this.pool.connect();
    let claimed: {
      id: string;
      title: string;
      body: string;
      imageUrl?: string;
      buttons: BroadcastButton[];
      targetAll: boolean;
    } | null = null;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE notification_broadcasts
            SET sent_at = now()
          WHERE id = $1 AND sent_at IS NULL AND cancelled_at IS NULL
          RETURNING id, title, body, image_url, buttons, segment, target_all`,
        [id],
      );
      if (rows.length === 0) {
        // Already sent (idempotent re-entry) or cancelled before send — no-op.
        await client.query('COMMIT');
        return;
      }
      const row = rows[0];
      const isTargetAll = row.target_all === true;
      if (!isTargetAll) {
        const segment: BroadcastSegment = row.segment && typeof row.segment === 'object' ? row.segment : {};
        const params: unknown[] = [id];
        const where = buildSegmentWhere(segment, params);
        await client.query(
          `INSERT INTO notification_broadcast_recipients (broadcast_id, tenant_id)
           SELECT $1, t.id FROM tenants t WHERE ${where}
           ON CONFLICT DO NOTHING`,
          params,
        );
      }
      await client.query('COMMIT');
      claimed = {
        id: row.id,
        title: row.title,
        body: row.body,
        imageUrl: row.image_url ?? undefined,
        buttons: Array.isArray(row.buttons) ? (row.buttons as BroadcastButton[]) : [],
        targetAll: isTargetAll,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        /* connection already broken */
      });
      this.logger.warn(`broadcast release failed for ${id}: ${err}`);
      return;
    } finally {
      client.release();
    }
    void this.pushBroadcast(claimed);
  }

  /**
   * Scheduler entry (096): release every DUE broadcast — scheduled_at in the
   * past, not yet sent, not cancelled. Each release atomically re-claims, so this
   * is safe to call repeatedly / concurrently (a second tick simply no-ops on
   * already-claimed rows). Best-effort & fully guarded.
   */
  async releaseDueBroadcasts(): Promise<{ released: number }> {
    let ids: string[] = [];
    try {
      const { rows } = await this.pool.query(
        `SELECT id FROM notification_broadcasts
          WHERE scheduled_at IS NOT NULL
            AND scheduled_at <= now()
            AND sent_at IS NULL
            AND cancelled_at IS NULL
          ORDER BY scheduled_at ASC
          LIMIT 100`,
      );
      ids = rows.map((r: { id: string }) => r.id);
    } catch (err) {
      this.logger.error(`due-broadcast scan failed: ${err}`);
      return { released: 0 };
    }
    for (const id of ids) {
      await this.releaseBroadcast(id);
    }
    if (ids.length > 0) this.logger.log(`Released ${ids.length} due broadcast(s)`);
    return { released: ids.length };
  }

  /** Fan a released broadcast out to the directors of its audience (best-effort). */
  private async pushBroadcast(b: {
    id: string;
    title: string;
    body: string;
    imageUrl?: string;
    buttons: BroadcastButton[];
    targetAll: boolean;
  }): Promise<void> {
    try {
      const { rows } = b.targetAll
        ? await this.pool.query(`SELECT id FROM users WHERE role='director' AND is_active=true`)
        : await this.pool.query(
            `SELECT u.id
               FROM users u
               JOIN notification_broadcast_recipients r ON r.tenant_id = u.tenant_id
              WHERE r.broadcast_id = $1 AND u.role='director' AND u.is_active=true`,
            [b.id],
          );
      const data = {
        type: 'superadmin_broadcast' as const,
        broadcastId: b.id,
        title: b.title,
        body: b.body,
        imageUrl: b.imageUrl,
        buttons: b.buttons,
      };
      // sendBroadcastToUser already chunks the Expo send at 100 per device-set.
      await Promise.all(rows.map((r: { id: string }) => this.push.sendBroadcastToUser(r.id, b.title, b.body, data)));
    } catch (err) {
      this.logger.warn(`broadcast push fan-out failed for ${b.id}: ${err}`);
    }
  }
}

/**
 * Build the WHERE clause that resolves a segment to a set of `tenants t`. Pushes
 * bind params onto the shared `params` array (so $-placeholders stay correct
 * relative to any caller-prefix params). Criteria AND-combine; statuses inside
 * `subscriptionStatuses` OR-combine. Defaults to active tenants only unless
 * `includeInactive`. An empty segment yields `true` (all active tenants).
 */
function buildSegmentWhere(segment: BroadcastSegment, params: unknown[]): string {
  const conds: string[] = [];

  // A disabled tenant has no live cabinet to reach — exclude unless opted in.
  if (!segment.includeInactive) {
    conds.push('t.is_active = true');
  }

  if (segment.planIds && segment.planIds.length > 0) {
    params.push(segment.planIds);
    conds.push(`t.plan_id = ANY($${params.length}::uuid[])`);
  }

  if (segment.subscriptionStatuses && segment.subscriptionStatuses.length > 0) {
    const ors: string[] = [];
    for (const st of segment.subscriptionStatuses) {
      if (st === 'trial') {
        ors.push(
          `(t.is_active = true AND (t.subscription_end IS NULL OR t.subscription_end >= now()) AND COALESCE(t.monthly_price,0) = 0)`,
        );
      } else if (st === 'paid') {
        ors.push(
          `(t.is_active = true AND (t.subscription_end IS NULL OR t.subscription_end >= now()) AND COALESCE(t.monthly_price,0) > 0)`,
        );
      } else if (st === 'expired') {
        ors.push(`(t.subscription_end IS NOT NULL AND t.subscription_end < now())`);
      }
    }
    if (ors.length > 0) conds.push(`(${ors.join(' OR ')})`);
  }

  if (segment.activity) {
    const days =
      typeof segment.activityWindowDays === 'number' && segment.activityWindowDays > 0
        ? Math.trunc(segment.activityWindowDays)
        : 30;
    params.push(days);
    const recent = `EXISTS (SELECT 1 FROM checks c WHERE c.tenant_id = t.id AND c.created_at >= now() - ($${params.length}::int * interval '1 day'))`;
    conds.push(segment.activity === 'active' ? recent : `NOT ${recent}`);
  }

  return conds.length > 0 ? conds.join(' AND ') : 'true';
}

/**
 * Normalize a validated segment DTO into the persisted shape, dropping empty
 * fields. Returns null when nothing meaningful was provided — null == "all
 * tenants" (target_all), which preserves the pre-096 broadcast-to-everyone path.
 */
function normalizeSegment(dto?: BroadcastSegmentDto): BroadcastSegment | null {
  if (!dto) return null;
  const seg: BroadcastSegment = {};
  if (dto.planIds && dto.planIds.length > 0) seg.planIds = Array.from(new Set(dto.planIds));
  if (dto.subscriptionStatuses && dto.subscriptionStatuses.length > 0) {
    seg.subscriptionStatuses = Array.from(new Set(dto.subscriptionStatuses));
  }
  if (dto.activity) seg.activity = dto.activity;
  if (typeof dto.activityWindowDays === 'number') seg.activityWindowDays = dto.activityWindowDays;
  if (dto.includeInactive === true) seg.includeInactive = true;
  return Object.keys(seg).length > 0 ? seg : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function mapBroadcast(row: {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  buttons: unknown;
  created_at: Date | string;
  scheduled_at?: Date | string | null;
  sent_at?: Date | string | null;
}): Broadcast {
  const buttons = Array.isArray(row.buttons) ? (row.buttons as BroadcastButton[]) : [];
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url ?? undefined,
    buttons,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    scheduledAt: toIso(row.scheduled_at),
    sentAt: toIso(row.sent_at),
  };
}

function parseSegment(value: unknown): BroadcastSegment | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as BroadcastSegment) : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? (value as BroadcastSegment) : null;
}

function mapBroadcastHistory(row: {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  buttons: unknown;
  created_at: Date | string;
  cancelled_at: Date | string | null;
  seen_count: number;
  scheduled_at: Date | string | null;
  sent_at: Date | string | null;
  segment: unknown;
  target_all: boolean;
  recipient_count: number;
}): BroadcastHistoryItem {
  const buttons = Array.isArray(row.buttons) ? (row.buttons as BroadcastButton[]) : [];
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url ?? undefined,
    buttons,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    cancelledAt: toIso(row.cancelled_at),
    seenCount: typeof row.seen_count === 'number' ? row.seen_count : Number(row.seen_count ?? 0),
    scheduledAt: toIso(row.scheduled_at),
    sentAt: toIso(row.sent_at),
    segment: parseSegment(row.segment),
    targetAll: row.target_all === true,
    recipientCount: typeof row.recipient_count === 'number' ? row.recipient_count : Number(row.recipient_count ?? 0),
  };
}
