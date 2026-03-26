import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class CallsService {
  private readonly logger = new Logger('CallsService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private async getMoiZvonkiConfig(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT api_key, sender_name, webhook_url FROM messaging_integrations
       WHERE tenant_id=$1 AND provider_type='moizvonki' AND is_active=true LIMIT 1`,
      [tenantId],
    );
    if (rows.length === 0) return null;
    return {
      apiKey: rows[0].api_key,
      userName: rows[0].sender_name,
      domain: rows[0].webhook_url,
    };
  }

  async getCalls(tenantId: string, query: { date?: string; dateFrom?: string; dateTo?: string }) {
    const config = await this.getMoiZvonkiConfig(tenantId);
    if (!config) {
      throw new BadRequestException({ message: 'МоиЗвонки не настроен. Подключите интеграцию в разделе Маркетинг.' });
    }

    if (!config.domain) {
      throw new BadRequestException({ message: 'Домен МоиЗвонки не настроен.' });
    }

    const apiUrl = `https://${config.domain}.moizvonki.ru/api/v1`;

    const now = new Date();
    const dateFrom = query.dateFrom || query.date || now.toISOString().split('T')[0];
    const dateTo = query.dateTo || query.date || now.toISOString().split('T')[0];

    const fromTimestamp = Math.floor(new Date(`${dateFrom}T00:00:00`).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(`${dateTo}T23:59:59`).getTime() / 1000);

    const requestData = JSON.stringify({
      user_name: config.userName,
      api_key: config.apiKey,
      action: 'calls.list',
      from_date: fromTimestamp,
      to_date: toTimestamp,
    });

    this.logger.log(`Fetching calls from ${dateFrom} to ${dateTo} via ${apiUrl}`);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `request_data=${encodeURIComponent(requestData)}`,
      });

      const raw = await response.text();
      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        this.logger.error(`Non-JSON response: ${raw.substring(0, 300)}`);
        throw new BadRequestException({ message: 'МоиЗвонки: неожиданный формат ответа' });
      }

      if (data.result === 'error' || data.error) {
        const err = data.error || data.message || data.error_text || 'Unknown error';
        this.logger.warn(`MoiZvonki error: ${err}`);
        throw new BadRequestException({ message: `МоиЗвонки: ${err}` });
      }

      const calls = Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);

      const clientPhones = new Map<string, { id: string; fullName: string; cars: any[] }>();
      if (calls.length > 0) {
        const { rows: clients } = await this.pool.query(
          `SELECT c.id, c.full_name, c.phone FROM clients c WHERE c.tenant_id=$1`,
          [tenantId],
        );
        for (const client of clients) {
          const cleanPhone = client.phone.replace(/[\s\-\+\(\)]/g, '');
          clientPhones.set(cleanPhone, { id: client.id, fullName: client.full_name, cars: [] });
          if (cleanPhone.length >= 10) {
            clientPhones.set(cleanPhone.slice(-10), { id: client.id, fullName: client.full_name, cars: [] });
          }
        }

        const clientIds = [...new Set([...clientPhones.values()].map(c => c.id))];
        if (clientIds.length > 0) {
          const { rows: cars } = await this.pool.query(
            `SELECT id, plate_number, make_model, client_id FROM cars WHERE client_id = ANY($1) AND tenant_id=$2`,
            [clientIds, tenantId],
          );
          for (const car of cars) {
            for (const [, client] of clientPhones) {
              if (client.id === car.client_id) {
                client.cars.push({ plateNumber: car.plate_number, makeModel: car.make_model });
              }
            }
          }
        }
      }

      const deduped = new Map<string, any>();
      for (const call of calls) {
        const phone = (call.client_number || '').replace(/[\s\-\+\(\)]/g, '');
        const key = `${phone}_${call.start_time}_${call.direction}`;
        const existing = deduped.get(key);
        if (!existing) {
          deduped.set(key, call);
        } else {
          const existDur = parseInt(existing.duration || '0') || 0;
          const newDur = parseInt(call.duration || '0') || 0;
          if ((!existing.recording && call.recording) || newDur > existDur) {
            deduped.set(key, call);
          }
        }
      }

      const mappedCalls = [...deduped.values()].map((call: any) => {
        // Handle direction as number, string number, or string name
        const dir = call.direction;
        const direction = (dir === 1 || dir === '1' || dir === 'in' || dir === 'incoming' || dir === 'IN')
          ? 'incoming'
          : (dir === 2 || dir === '2' || dir === 'out' || dir === 'outgoing' || dir === 'OUT')
            ? 'outgoing'
            : 'incoming'; // default to incoming if unknown
        const clientPhone = (call.client_number || '').replace(/[\s\-\+\(\)]/g, '');
        const clientPhoneShort = clientPhone.length >= 10 ? clientPhone.slice(-10) : clientPhone;

        const matchedClient = clientPhones.get(clientPhone) || clientPhones.get(clientPhoneShort) || null;

        const callDate = call.start_time
          ? new Date(call.start_time * 1000).toISOString()
          : call.date || '';

        const answered = call.answered;
        const isAnswered = answered === 1 || answered === '1' || answered === true || answered === 'true';
        const duration = parseInt(call.duration || '0') || 0;
        // Also consider answered if duration > 0
        const finalAnswered = isAnswered || duration > 0;

        return {
          id: call.db_call_id || call.event_pbx_call_id || `${call.start_time}_${clientPhone}`,
          date: callDate,
          direction,
          from: direction === 'incoming' ? (call.client_number || '') : (call.src_number || ''),
          to: direction === 'incoming' ? (call.src_number || '') : (call.client_number || ''),
          duration,
          status: finalAnswered ? 'answered' : 'missed',
          recordingUrl: call.recording || null,
          clientPhone,
          calledBack: false, // will be computed below
          client: matchedClient ? {
            id: matchedClient.id,
            fullName: matchedClient.fullName,
            cars: matchedClient.cars,
          } : null,
        };
      });

      this.logger.log(`Mapped ${mappedCalls.length} calls: ${mappedCalls.filter(c => c.direction === 'incoming').length} in, ${mappedCalls.filter(c => c.direction === 'outgoing').length} out`);

      const incoming = mappedCalls.filter((c: any) => c.direction === 'incoming');
      const outgoing = mappedCalls.filter((c: any) => c.direction === 'outgoing');
      const missed = mappedCalls.filter((c: any) =>
        c.direction === 'incoming' && c.status === 'missed',
      );

      // Build set of phones we called back (outgoing with duration > 0 OR any answered incoming from same number after the missed call)
      const calledBackPhones = new Set<string>();
      // Outgoing calls to the same number count as "called back"
      for (const c of outgoing) {
        if (c.duration > 0) {
          const phone = (c.to || '').replace(/[\s\-\+\(\)]/g, '');
          calledBackPhones.add(phone.length >= 10 ? phone.slice(-10) : phone);
        }
      }
      // Answered incoming from the same number also counts (they called again and we picked up)
      for (const c of incoming) {
        if (c.status === 'answered') {
          const phone = (c.from || '').replace(/[\s\-\+\(\)]/g, '');
          calledBackPhones.add(phone.length >= 10 ? phone.slice(-10) : phone);
        }
      }

      // Mark missed calls as calledBack and count notCalledBack
      const notCalledBack: any[] = [];
      for (const c of missed) {
        const phone = (c.from || '').replace(/[\s\-\+\(\)]/g, '');
        const phoneShort = phone.length >= 10 ? phone.slice(-10) : phone;
        if (calledBackPhones.has(phoneShort)) {
          c.calledBack = true;
        } else {
          notCalledBack.push(c);
        }
      }

      return {
        calls: mappedCalls,
        summary: {
          total: mappedCalls.length,
          incoming: incoming.length,
          outgoing: outgoing.length,
          missed: missed.length,
          notCalledBack: notCalledBack.length,
        },
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Fetch calls error: ${err.message}`, err.stack);
      throw new BadRequestException({ message: `МоиЗвонки: сетевая ошибка — ${err.message}` });
    }
  }

  async getRecordingUrl(tenantId: string, recordUrl: string) {
    const config = await this.getMoiZvonkiConfig(tenantId);
    if (!config) {
      throw new BadRequestException({ message: 'МоиЗвонки не настроен' });
    }

    if (!recordUrl) {
      throw new BadRequestException({ message: 'URL записи не указан' });
    }

    if (recordUrl.startsWith('http://') || recordUrl.startsWith('https://')) {
      return { url: recordUrl };
    }

    const apiUrl = `https://${config.domain}.moizvonki.ru/api/v1`;
    const requestData = JSON.stringify({
      user_name: config.userName,
      api_key: config.apiKey,
      action: 'calls.record_url',
      recording: recordUrl,
    });

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `request_data=${encodeURIComponent(requestData)}`,
      });
      const data = await response.json();
      if (data.url) {
        return { url: data.url };
      }
    } catch (err) {
      this.logger.warn(`Failed to get recording URL from API: ${err}`);
    }

    return { url: `https://${config.domain}.moizvonki.ru/records/${recordUrl}` };
  }

  async getClientCalls(tenantId: string, clientId: string, query: { dateFrom?: string; dateTo?: string }) {
    const { rows: clientRows } = await this.pool.query(
      `SELECT phone FROM clients WHERE id=$1 AND tenant_id=$2`,
      [clientId, tenantId],
    );
    if (clientRows.length === 0) {
      throw new BadRequestException({ message: 'Клиент не найден' });
    }

    const clientPhone = clientRows[0].phone.replace(/[\s\-\+\(\)]/g, '');
    const clientPhoneShort = clientPhone.length >= 10 ? clientPhone.slice(-10) : clientPhone;

    const allCalls = await this.getCalls(tenantId, query);

    const clientCalls = allCalls.calls.filter((call: any) => {
      const from = call.from.replace(/[\s\-\+\(\)]/g, '');
      const to = call.to.replace(/[\s\-\+\(\)]/g, '');
      return from.endsWith(clientPhoneShort) || to.endsWith(clientPhoneShort);
    });

    return { calls: clientCalls, total: clientCalls.length };
  }

  async getClientSmsHistory(tenantId: string, clientId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, direction, phone, message, status, provider, created_at
       FROM sms_history WHERE tenant_id=$1 AND client_id=$2
       ORDER BY created_at DESC LIMIT 100`,
      [tenantId, clientId],
    );
    return rows.map(r => ({
      id: r.id,
      direction: r.direction,
      phone: r.phone,
      message: r.message,
      status: r.status,
      provider: r.provider,
      createdAt: r.created_at,
    }));
  }

  async saveSmsToHistory(tenantId: string, clientId: string | null, phone: string, message: string, provider: string) {
    await this.pool.query(
      `INSERT INTO sms_history (tenant_id, client_id, direction, phone, message, status, provider)
       VALUES ($1, $2, 'outgoing', $3, $4, 'sent', $5)`,
      [tenantId, clientId, phone, message, provider],
    );
  }
}
