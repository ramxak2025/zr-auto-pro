import { Injectable, Inject, BadRequestException, NotFoundException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import * as crypto from 'crypto';
import { PG_POOL } from '../database.module';

// ─── Messaging Provider Strategy Pattern ─────────────────────────────
interface MessagingProviderAdapter {
  sendMessage(phone: string, message: string): Promise<{ success: boolean; error?: string }>;
}

class WhatsAppAdapter implements MessagingProviderAdapter {
  constructor(private apiKey: string, private senderPhone: string) {}
  async sendMessage(phone: string, message: string) {
    // Real implementation would call WhatsApp Business API here
    Logger.log(`[WhatsApp → ${phone}] ${message.substring(0, 60)}...`, 'WhatsAppAdapter');
    return { success: true };
  }
}

class SmsAdapter implements MessagingProviderAdapter {
  constructor(private apiKey: string, private senderName: string) {}
  async sendMessage(phone: string, message: string) {
    Logger.log(`[SMS → ${phone}] ${message.substring(0, 60)}...`, 'SmsAdapter');
    return { success: true };
  }
}

class EmailAdapter implements MessagingProviderAdapter {
  constructor(private apiKey: string, private senderName: string) {}
  async sendMessage(phone: string, message: string) {
    Logger.log(`[Email → ${phone}] ${message.substring(0, 60)}...`, 'EmailAdapter');
    return { success: true };
  }
}

// ─── Service ─────────────────────────────────────────────────────────
@Injectable()
export class MarketingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MarketingService');
  private jobInterval: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  onModuleInit() {
    // Process review jobs every 60 seconds
    this.jobInterval = setInterval(() => this.processReviewJobs(), 60_000);
    // Also scan for new completed checks every 5 minutes
    const scanInterval = setInterval(() => this.scanCompletedChecks(), 300_000);
    // Store scan interval for cleanup — assign to a class property if needed
    (this as any)._scanInterval = scanInterval;
    this.logger.log('Review job processor started');
  }

  onModuleDestroy() {
    if (this.jobInterval) clearInterval(this.jobInterval);
    if ((this as any)._scanInterval) clearInterval((this as any)._scanInterval);
  }

  // ─── Messaging Provider Factory ──────────────────────────────────
  private createAdapter(row: any): MessagingProviderAdapter {
    switch (row.provider_type) {
      case 'whatsapp': return new WhatsAppAdapter(row.api_key, row.sender_phone || '');
      case 'sms':      return new SmsAdapter(row.api_key, row.sender_name || '');
      case 'email':    return new EmailAdapter(row.api_key, row.sender_name || '');
      default:         return new SmsAdapter(row.api_key, row.sender_name || '');
    }
  }

  private async getAdapter(tenantId: string): Promise<MessagingProviderAdapter | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM messaging_integrations WHERE tenant_id=$1 AND is_active=true ORDER BY created_at LIMIT 1`,
      [tenantId],
    );
    return rows.length > 0 ? this.createAdapter(rows[0]) : null;
  }

  // ─── Token Generation ────────────────────────────────────────────
  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // ─── Integrations CRUD ───────────────────────────────────────────
  async getIntegrations(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, provider_type, sender_name, sender_phone, webhook_url, is_active, created_at
       FROM messaging_integrations WHERE tenant_id=$1 ORDER BY created_at`,
      [tenantId],
    );
    return rows.map(r => ({
      id: r.id, providerType: r.provider_type, senderName: r.sender_name,
      senderPhone: r.sender_phone, webhookUrl: r.webhook_url,
      isActive: r.is_active, createdAt: r.created_at,
    }));
  }

  async upsertIntegration(tenantId: string, dto: any) {
    if (!dto.providerType || !dto.apiKey) {
      throw new BadRequestException({ message: 'Тип провайдера и API ключ обязательны' });
    }
    if (dto.id) {
      await this.pool.query(
        `UPDATE messaging_integrations SET provider_type=$1, api_key=$2, sender_name=$3,
         sender_phone=$4, webhook_url=$5, is_active=$6, updated_at=now()
         WHERE id=$7 AND tenant_id=$8`,
        [dto.providerType, dto.apiKey, dto.senderName || null, dto.senderPhone || null,
         dto.webhookUrl || null, dto.isActive !== false, dto.id, tenantId],
      );
    } else {
      await this.pool.query(
        `INSERT INTO messaging_integrations (tenant_id, provider_type, api_key, sender_name, sender_phone, webhook_url)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, dto.providerType, dto.apiKey, dto.senderName || null,
         dto.senderPhone || null, dto.webhookUrl || null],
      );
    }
    return this.getIntegrations(tenantId);
  }

  async removeIntegration(id: string, tenantId: string) {
    await this.pool.query(`DELETE FROM messaging_integrations WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return { message: 'Удалено' };
  }

  // ─── Platform Links CRUD ─────────────────────────────────────────
  async getPlatformLinks(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, platform, url, is_active FROM review_platform_links WHERE tenant_id=$1 ORDER BY platform`,
      [tenantId],
    );
    return rows.map(r => ({ id: r.id, platform: r.platform, url: r.url, isActive: r.is_active }));
  }

  async upsertPlatformLink(tenantId: string, dto: any) {
    if (!dto.platform || !dto.url) {
      throw new BadRequestException({ message: 'Платформа и ссылка обязательны' });
    }
    await this.pool.query(
      `INSERT INTO review_platform_links (tenant_id, platform, url, is_active)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, platform) DO UPDATE SET url=$3, is_active=$4`,
      [tenantId, dto.platform, dto.url, dto.isActive !== false],
    );
    return this.getPlatformLinks(tenantId);
  }

  async removePlatformLink(id: string, tenantId: string) {
    await this.pool.query(`DELETE FROM review_platform_links WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return { message: 'Удалено' };
  }

  // ─── Review Settings ─────────────────────────────────────────────
  async getSettings(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM review_settings WHERE tenant_id=$1`, [tenantId],
    );
    if (rows.length === 0) {
      await this.pool.query(
        `INSERT INTO review_settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenantId],
      );
      const { rows: newRows } = await this.pool.query(
        `SELECT * FROM review_settings WHERE tenant_id=$1`, [tenantId],
      );
      return this.mapSettings(newRows[0]);
    }
    return this.mapSettings(rows[0]);
  }

  async updateSettings(tenantId: string, dto: any) {
    await this.pool.query(
      `INSERT INTO review_settings (tenant_id, send_time, feedback_delay_hours, auto_send_enabled, message_template)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id) DO UPDATE SET
         send_time=COALESCE($2, review_settings.send_time),
         feedback_delay_hours=COALESCE($3, review_settings.feedback_delay_hours),
         auto_send_enabled=COALESCE($4, review_settings.auto_send_enabled),
         message_template=COALESCE($5, review_settings.message_template),
         updated_at=now()`,
      [tenantId, dto.sendTime, dto.feedbackDelayHours, dto.autoSendEnabled, dto.messageTemplate],
    );
    return this.getSettings(tenantId);
  }

  private mapSettings(r: any) {
    return {
      sendTime: r.send_time, feedbackDelayHours: r.feedback_delay_hours,
      autoSendEnabled: r.auto_send_enabled, messageTemplate: r.message_template,
    };
  }

  // ─── Public Review Flow ──────────────────────────────────────────
  async getReviewByToken(token: string) {
    const { rows } = await this.pool.query(
      `SELECT rt.*, t.name as tenant_name, cl.full_name as client_name,
              u.full_name as employee_name
       FROM review_tokens rt
       JOIN tenants t ON t.id = rt.tenant_id
       LEFT JOIN clients cl ON cl.id = rt.client_id
       LEFT JOIN users u ON u.id = rt.employee_id
       WHERE rt.token=$1`, [token],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Ссылка не найдена' });
    const r = rows[0];
    if (r.used_at) throw new BadRequestException({ message: 'Отзыв уже оставлен' });
    if (new Date(r.expires_at) < new Date()) throw new BadRequestException({ message: 'Ссылка истекла' });

    const links = await this.getPlatformLinks(r.tenant_id);
    return {
      tenantName: r.tenant_name, clientName: r.client_name,
      employeeName: r.employee_name, platformLinks: links,
    };
  }

  async submitReview(token: string, dto: { rating: number; comment?: string; redirectedTo?: string }) {
    if (!dto.rating || dto.rating < 1 || dto.rating > 5) {
      throw new BadRequestException({ message: 'Оценка должна быть от 1 до 5' });
    }

    const { rows } = await this.pool.query(
      `SELECT * FROM review_tokens WHERE token=$1`, [token],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Ссылка не найдена' });
    const rt = rows[0];
    if (rt.used_at) throw new BadRequestException({ message: 'Отзыв уже оставлен' });
    if (new Date(rt.expires_at) < new Date()) throw new BadRequestException({ message: 'Ссылка истекла' });

    // Save review
    await this.pool.query(
      `INSERT INTO review_responses (tenant_id, check_id, client_id, employee_id, rating, comment, redirected_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rt.tenant_id, rt.check_id, rt.client_id, rt.employee_id,
       dto.rating, dto.comment || null, dto.redirectedTo || null],
    );

    // Mark token as used
    await this.pool.query(`UPDATE review_tokens SET used_at=now() WHERE id=$1`, [rt.id]);

    // Check alerts
    await this.checkAlerts(rt.tenant_id, rt.employee_id, rt.client_id, dto.rating);

    return { success: true };
  }

  // ─── Alerts ──────────────────────────────────────────────────────
  private async checkAlerts(tenantId: string, employeeId: string | null, clientId: string | null, rating: number) {
    // 1. Consecutive negative check (3 in a row <= 3)
    if (employeeId && rating <= 3) {
      const { rows } = await this.pool.query(
        `SELECT rating FROM review_responses
         WHERE employee_id=$1 AND tenant_id=$2
         ORDER BY created_at DESC LIMIT 3`,
        [employeeId, tenantId],
      );
      if (rows.length >= 3 && rows.every(r => r.rating <= 3)) {
        const { rows: existing } = await this.pool.query(
          `SELECT 1 FROM review_alerts WHERE employee_id=$1 AND tenant_id=$2
           AND alert_type='consecutive_negative' AND created_at > now() - interval '7 days'`,
          [employeeId, tenantId],
        );
        if (existing.length === 0) {
          await this.pool.query(
            `INSERT INTO review_alerts (tenant_id, employee_id, alert_type, details)
             VALUES ($1,$2,'consecutive_negative',$3)`,
            [tenantId, employeeId, JSON.stringify({ ratings: rows.map(r => r.rating) })],
          );
        }
      }
    }

    // 2. Churn risk: rating <= 3 + customer has > 2 visits
    if (clientId && rating <= 3) {
      const { rows } = await this.pool.query(
        `SELECT COUNT(*) as visits FROM checks WHERE client_id=$1 AND tenant_id=$2`,
        [clientId, tenantId],
      );
      if (parseInt(rows[0].visits) > 2) {
        await this.pool.query(
          `INSERT INTO review_alerts (tenant_id, client_id, alert_type, details)
           VALUES ($1,$2,'churn_risk',$3)`,
          [tenantId, clientId, JSON.stringify({ rating, totalVisits: rows[0].visits })],
        );
      }
    }
  }

  async getAlerts(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT ra.*, u.full_name as employee_name, cl.full_name as client_name
       FROM review_alerts ra
       LEFT JOIN users u ON u.id = ra.employee_id
       LEFT JOIN clients cl ON cl.id = ra.client_id
       WHERE ra.tenant_id=$1 ORDER BY ra.created_at DESC LIMIT 50`,
      [tenantId],
    );
    return rows.map(r => ({
      id: r.id, alertType: r.alert_type, employeeName: r.employee_name,
      clientName: r.client_name, details: r.details, isRead: r.is_read, createdAt: r.created_at,
    }));
  }

  async markAlertRead(id: string, tenantId: string) {
    await this.pool.query(`UPDATE review_alerts SET is_read=true WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return { success: true };
  }

  // ─── Reviews List ────────────────────────────────────────────────
  async getReviews(tenantId: string, query: any) {
    const employeeId = query.employeeId;
    const minRating = query.minRating ? parseInt(query.minRating) : null;
    const maxRating = query.maxRating ? parseInt(query.maxRating) : null;

    let sql = `SELECT rr.*, u.full_name as employee_name, cl.full_name as client_name
               FROM review_responses rr
               LEFT JOIN users u ON u.id = rr.employee_id
               LEFT JOIN clients cl ON cl.id = rr.client_id
               WHERE rr.tenant_id=$1`;
    const params: any[] = [tenantId];
    let idx = 2;

    if (employeeId) { sql += ` AND rr.employee_id=$${idx++}`; params.push(employeeId); }
    if (minRating)  { sql += ` AND rr.rating >= $${idx++}`; params.push(minRating); }
    if (maxRating)  { sql += ` AND rr.rating <= $${idx++}`; params.push(maxRating); }

    sql += ` ORDER BY rr.created_at DESC LIMIT 100`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(r => ({
      id: r.id, checkId: r.check_id, clientName: r.client_name,
      employeeName: r.employee_name, rating: r.rating, comment: r.comment,
      redirectedTo: r.redirected_to, createdAt: r.created_at,
    }));
  }

  // ─── Dashboard Analytics ─────────────────────────────────────────
  async getDashboard(tenantId: string) {
    // Total reviews and avg rating
    const { rows: [stats] } = await this.pool.query(
      `SELECT COUNT(*) as total, COALESCE(AVG(rating),0) as avg_rating,
              COUNT(*) FILTER (WHERE rating <= 3) as negative,
              COUNT(*) FILTER (WHERE rating >= 4) as positive,
              COUNT(*) FILTER (WHERE redirected_to IS NOT NULL) as redirected
       FROM review_responses WHERE tenant_id=$1`,
      [tenantId],
    );

    // Total tokens sent
    const { rows: [tokenStats] } = await this.pool.query(
      `SELECT COUNT(*) as sent, COUNT(*) FILTER (WHERE used_at IS NOT NULL) as responded
       FROM review_tokens WHERE tenant_id=$1`,
      [tenantId],
    );

    // Per-employee ratings
    const { rows: employeeRatings } = await this.pool.query(
      `SELECT rr.employee_id, u.full_name as employee_name,
              COUNT(*) as review_count, AVG(rr.rating) as avg_rating,
              COUNT(*) FILTER (WHERE rr.rating <= 3) as negative_count
       FROM review_responses rr
       JOIN users u ON u.id = rr.employee_id
       WHERE rr.tenant_id=$1 AND rr.employee_id IS NOT NULL
       GROUP BY rr.employee_id, u.full_name
       ORDER BY avg_rating DESC`,
      [tenantId],
    );

    // Unread alerts count
    const { rows: [alertCount] } = await this.pool.query(
      `SELECT COUNT(*) as count FROM review_alerts WHERE tenant_id=$1 AND is_read=false`,
      [tenantId],
    );

    return {
      totalReviews: parseInt(stats.total),
      avgRating: parseFloat(parseFloat(stats.avg_rating).toFixed(1)),
      negativeReviews: parseInt(stats.negative),
      positiveReviews: parseInt(stats.positive),
      publicRedirects: parseInt(stats.redirected),
      tokensSent: parseInt(tokenStats.sent),
      tokensResponded: parseInt(tokenStats.responded),
      responseRate: tokenStats.sent > 0 ? Math.round((tokenStats.responded / tokenStats.sent) * 100) : 0,
      conversionRate: stats.positive > 0 && stats.redirected > 0 ? Math.round((stats.redirected / stats.positive) * 100) : 0,
      unreadAlerts: parseInt(alertCount.count),
      employeeRatings: employeeRatings.map(r => ({
        employeeId: r.employee_id, employeeName: r.employee_name,
        reviewCount: parseInt(r.review_count),
        avgRating: parseFloat(parseFloat(r.avg_rating).toFixed(1)),
        negativeRate: r.review_count > 0 ? Math.round((r.negative_count / r.review_count) * 100) : 0,
      })),
    };
  }

  // ─── Job Processor: Scan for completed checks ────────────────────
  private async scanCompletedChecks() {
    try {
      // Find recently completed (non-deferred) checks that don't have review jobs yet
      const { rows } = await this.pool.query(
        `SELECT c.id as check_id, c.tenant_id, c.master_id, c.client_id, cl.phone as client_phone
         FROM checks c
         LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE c.is_deferred = false
           AND c.created_at > now() - interval '7 days'
           AND c.client_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM review_jobs rj WHERE rj.check_id = c.id)
           AND EXISTS (SELECT 1 FROM review_settings rs WHERE rs.tenant_id = c.tenant_id AND rs.auto_send_enabled = true)`,
      );

      for (const row of rows) {
        if (!row.client_phone) continue;

        // Get tenant settings for schedule time
        const { rows: settingsRows } = await this.pool.query(
          `SELECT send_time, feedback_delay_hours FROM review_settings WHERE tenant_id=$1`,
          [row.tenant_id],
        );
        const settings = settingsRows[0] || { send_time: '20:00', feedback_delay_hours: 2 };

        // Schedule for today at send_time, or delay_hours from now
        const now = new Date();
        const [hh, mm] = (settings.send_time || '20:00').split(':').map(Number);
        const scheduledAt = new Date(now);
        scheduledAt.setHours(hh, mm, 0, 0);
        if (scheduledAt <= now) {
          scheduledAt.setTime(now.getTime() + (settings.feedback_delay_hours || 2) * 3600000);
        }

        await this.pool.query(
          `INSERT INTO review_jobs (tenant_id, check_id, client_id, employee_id, client_phone, scheduled_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (check_id) DO NOTHING`,
          [row.tenant_id, row.check_id, row.client_id, row.master_id, row.client_phone, scheduledAt],
        );
      }
    } catch (err) {
      this.logger.error(`Scan completed checks error: ${err}`);
    }
  }

  // ─── Job Processor: Send pending review requests ─────────────────
  private async processReviewJobs() {
    try {
      const { rows: jobs } = await this.pool.query(
        `UPDATE review_jobs SET status='processing', attempts=attempts+1
         WHERE id IN (
           SELECT id FROM review_jobs
           WHERE status='pending' AND scheduled_at <= now() AND attempts < 3
           ORDER BY scheduled_at LIMIT 10
           FOR UPDATE SKIP LOCKED
         ) RETURNING *`,
      );

      for (const job of jobs) {
        try {
          const adapter = await this.getAdapter(job.tenant_id);
          if (!adapter) {
            await this.pool.query(
              `UPDATE review_jobs SET status='skipped', error='Нет настроенного провайдера' WHERE id=$1`,
              [job.id],
            );
            continue;
          }

          // Create review token
          const token = this.generateToken();
          const expiresAt = new Date(Date.now() + 7 * 24 * 3600000); // 7 days

          await this.pool.query(
            `INSERT INTO review_tokens (tenant_id, check_id, client_id, employee_id, token, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [job.tenant_id, job.check_id, job.client_id, job.employee_id, token, expiresAt],
          );

          // Build message from template
          const { rows: settingsRows } = await this.pool.query(
            `SELECT message_template FROM review_settings WHERE tenant_id=$1`, [job.tenant_id],
          );
          const { rows: tenantRows } = await this.pool.query(
            `SELECT name FROM tenants WHERE id=$1`, [job.tenant_id],
          );
          const { rows: clientRows } = await this.pool.query(
            `SELECT full_name FROM clients WHERE id=$1`, [job.client_id],
          );

          const template = settingsRows[0]?.message_template || 'Оцените обслуживание: {reviewLink}';
          const reviewLink = `${process.env.APP_URL || 'https://crm.app'}/review/${token}`;
          const message = template
            .replace('{clientName}', clientRows[0]?.full_name || 'клиент')
            .replace('{tenantName}', tenantRows[0]?.name || '')
            .replace('{reviewLink}', reviewLink);

          await adapter.sendMessage(job.client_phone, message);
          await this.pool.query(`UPDATE review_jobs SET status='sent' WHERE id=$1`, [job.id]);
        } catch (err: any) {
          this.logger.error(`Review job ${job.id} failed: ${err.message}`);
          const newStatus = job.attempts >= 3 ? 'failed' : 'pending';
          await this.pool.query(
            `UPDATE review_jobs SET status=$1, error=$2 WHERE id=$3`,
            [newStatus, err.message, job.id],
          );
        }
      }
    } catch (err) {
      this.logger.error(`Process review jobs error: ${err}`);
    }
  }
}
