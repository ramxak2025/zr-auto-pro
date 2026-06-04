import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { PushService } from '../push/push.service';
import { CreateBroadcastDto } from './dto/notifications.dto';

// Shape returned to clients — matches the shared `Broadcast` type
// (shared/types/index.ts). Exported so the controller's inferred return types
// can be named (TS4053).
export interface BroadcastButton {
  label: string;
  action: 'dismiss' | 'link';
  url?: string;
}
export interface Broadcast {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  buttons: BroadcastButton[];
  createdAt: string;
}

/**
 * Notifications domain (066 + 067):
 *   * per-user mute preferences (opt-out model — a row == muted);
 *   * superadmin → director broadcasts, persisted so a missed push can be
 *     re-fetched on app open, with per-user "seen" tracking.
 *
 * PushModule is @Global, so PushService is injectable here without an import.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private push: PushService,
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

  /** Broadcasts this user has NOT yet seen, newest first, capped at 5. */
  async listUnseenBroadcasts(userId: string): Promise<Broadcast[]> {
    const { rows } = await this.pool.query(
      `SELECT b.id, b.title, b.body, b.image_url, b.buttons, b.created_at
         FROM notification_broadcasts b
        WHERE NOT EXISTS (
          SELECT 1 FROM notification_broadcast_seen s
           WHERE s.broadcast_id = b.id AND s.user_id = $1
        )
        ORDER BY b.created_at DESC
        LIMIT 5`,
      [userId],
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

  // ─── Broadcasts (write side — superadmin) ────────────────────────────────────

  /**
   * Persist a broadcast, then fan it out cross-tenant to every ACTIVE director
   * (the автосервис «владелец»; superadmin is the platform operator). Push is
   * fire-and-forget AFTER the row is committed, so push latency never blocks the
   * API response, and a missed push is recoverable via listUnseenBroadcasts.
   *
   * Delivery uses the ALWAYS-DELIVER path (sendBroadcastToUser) — broadcasts are
   * deliberately NOT category-gated, so they reach every owner regardless of
   * their «Уведомления» toggles.
   */
  async broadcast(createdBy: string, dto: CreateBroadcastDto): Promise<Broadcast> {
    const buttons = dto.buttons ?? [];
    const { rows } = await this.pool.query(
      `INSERT INTO notification_broadcasts (title, body, image_url, buttons, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, title, body, image_url, buttons, created_at`,
      [dto.title, dto.body, dto.imageUrl ?? null, JSON.stringify(buttons), createdBy],
    );
    const broadcast = mapBroadcast(rows[0]);

    // Fan out — best-effort, non-blocking.
    void this.fanOut(broadcast);

    return broadcast;
  }

  private async fanOut(broadcast: Broadcast): Promise<void> {
    try {
      const { rows } = await this.pool.query(`SELECT id FROM users WHERE role='director' AND is_active=true`);
      const data = {
        type: 'superadmin_broadcast' as const,
        broadcastId: broadcast.id,
        title: broadcast.title,
        body: broadcast.body,
        imageUrl: broadcast.imageUrl,
        buttons: broadcast.buttons,
      };
      // sendBroadcastToUser already chunks the Expo send at 100 per device-set;
      // recipients are looped here (mirrors knowledge.service notify loop, but
      // with a role filter and NO tenant scope — platform-wide power).
      await Promise.all(
        rows.map((r: { id: string }) => this.push.sendBroadcastToUser(r.id, broadcast.title, broadcast.body, data)),
      );
    } catch (err) {
      this.logger.warn(`broadcast fan-out failed for ${broadcast.id}: ${err}`);
    }
  }
}

function mapBroadcast(row: {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  buttons: unknown;
  created_at: Date | string;
}): Broadcast {
  const buttons = Array.isArray(row.buttons) ? (row.buttons as BroadcastButton[]) : [];
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url ?? undefined,
    buttons,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
  };
}
