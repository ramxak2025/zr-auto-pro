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
