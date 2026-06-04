import { Injectable, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import * as https from 'https';

@Injectable()
export class PushService {
  private readonly logger = new Logger('PushService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async upsertToken(userId: string, token: string, platform: 'ios' | 'android') {
    await this.pool.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id=$1, platform=$3`,
      [userId, token, platform],
    );
    return { token, platform };
  }

  async deleteToken(userId: string, token: string) {
    await this.pool.query(`DELETE FROM push_tokens WHERE token=$1 AND user_id=$2`, [token, userId]);
    return { message: 'Токен удалён' };
  }

  async sendToUser(userId: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
    try {
      const { rows } = await this.pool.query(`SELECT token FROM push_tokens WHERE user_id=$1`, [userId]);
      if (rows.length === 0) return;

      const messages = rows.map((r: { token: string }) => ({
        to: r.token,
        sound: 'default',
        title,
        body,
        data: data || {},
      }));

      await this.postToExpo(messages);
    } catch (err) {
      this.logger.error(`sendToUser failed for userId=${userId}: ${err}`);
    }
  }

  /**
   * Category-gated variant of {@link sendToUser}. Identical delivery, but a
   * device only receives the push when the user has NOT muted `category`
   * (notification_mutes, migration 066 — opt-out model: absence of a row ==
   * subscribed). Use this for every USER-FACING alert tied to a toggle in
   * «Уведомления»: salary / penalty / check_assigned / check_closed / knowledge.
   *
   * NOT for silent cache-invalidation pushes (those stay on sendDataToTenant)
   * and NOT for superadmin broadcasts (those must always deliver — see
   * sendBroadcastToUser).
   *
   * Best-effort: any failure is swallowed (push is never the source of truth).
   */
  async sendToUserCategory(
    userId: string,
    category: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const { rows } = await this.pool.query(
        `SELECT pt.token
           FROM push_tokens pt
          WHERE pt.user_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM notification_mutes m
               WHERE m.user_id = $1 AND m.category = $2
            )`,
        [userId, category],
      );
      if (rows.length === 0) return;

      const messages = rows.map((r: { token: string }) => ({
        to: r.token,
        sound: 'default',
        title,
        body,
        data: { ...(data || {}), category },
      }));

      await this.postToExpo(messages);
    } catch (err) {
      this.logger.error(`sendToUserCategory failed for userId=${userId} category=${category}: ${err}`);
    }
  }

  /**
   * Deliver a single visible push to ONE user, ALWAYS (never category-gated).
   * Used for superadmin → director broadcasts, which must reach every owner
   * regardless of their «Уведомления» toggles. Callers fan this out across the
   * recipient list (see NotificationsService.broadcast), chunking the Expo send
   * at 100 messages per request — same chunk loop as sendDataToTenant.
   *
   * Best-effort: failure is swallowed and logged.
   */
  async sendBroadcastToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const { rows } = await this.pool.query(`SELECT token FROM push_tokens WHERE user_id=$1`, [userId]);
      if (rows.length === 0) return;

      const messages = rows.map((r: { token: string }) => ({
        to: r.token,
        sound: 'default',
        title,
        body,
        data: data || {},
      }));

      for (let i = 0; i < messages.length; i += 100) {
        await this.postToExpo(messages.slice(i, i + 100));
      }
    } catch (err) {
      this.logger.error(`sendBroadcastToUser failed for userId=${userId}: ${err}`);
    }
  }

  /**
   * Fan out a SILENT, DATA-ONLY push to every device of every OTHER user in a
   * tenant (the actor is excluded). Used for live cross-device cache
   * invalidation — e.g. `{ type: 'cash-changed', tenantId }` so other open
   * apps refetch money queries the moment a sale/expense lands.
   *
   * Data-only contract: NO title / body / sound, plus `_contentAvailable:true`
   * so iOS delivers it as a background content-available push (no banner) and
   * Android treats it as a data message. This MUST NOT show a visible
   * notification — it's an accelerator, not an alert.
   *
   * Best-effort: any failure is swallowed (push is never the source of truth).
   * Callers should fire-and-forget AFTER their DB commit so push latency never
   * blocks the API response.
   */
  async sendDataToTenant(tenantID: string, excludeUserId: string | null, data: Record<string, unknown>): Promise<void> {
    try {
      const { rows } = await this.pool.query(
        `SELECT pt.token
           FROM push_tokens pt
           JOIN users u ON u.id = pt.user_id
          WHERE u.tenant_id = $1
            AND ($2::uuid IS NULL OR pt.user_id <> $2)`,
        [tenantID, excludeUserId],
      );
      if (rows.length === 0) return;

      // Expo accepts up to 100 messages per request — chunk to stay safe even
      // for large tenants.
      const messages = rows.map((r: { token: string }) => ({
        to: r.token,
        // Silent: no title/body/sound, content-available so it doesn't banner.
        _contentAvailable: true,
        priority: 'high',
        data,
      }));

      for (let i = 0; i < messages.length; i += 100) {
        await this.postToExpo(messages.slice(i, i + 100));
      }
    } catch (err) {
      this.logger.error(`sendDataToTenant failed for tenant=${tenantID}: ${err}`);
    }
  }

  private postToExpo(messages: unknown[]): Promise<void> {
    return new Promise((resolve) => {
      const payload = JSON.stringify(messages);
      const options: https.RequestOptions = {
        hostname: 'exp.host',
        path: '/--/api/v2/push/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
      };

      const req = https.request(options, (res) => {
        res.on('data', () => {
          /* consume */
        });
        res.on('end', () => {
          this.logger.log(`Expo push response status: ${res.statusCode}`);
          resolve();
        });
      });

      req.on('error', (err) => {
        this.logger.error(`Expo push request error: ${err.message}`);
        resolve(); // don't throw — push failure is non-fatal
      });

      req.write(payload);
      req.end();
    });
  }
}
