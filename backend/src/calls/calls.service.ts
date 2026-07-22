import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

// Бизнес-таймзона продукта: границы «дня» в звонках считаются по Москве
// (UTC+3, без DST), а не по TZ сервера (Docker = UTC) — иначе звонки
// 00:00–03:00 МСК попадали в соседние сутки.
const BUSINESS_TZ = 'Europe/Moscow';
const BUSINESS_TZ_OFFSET = '+03:00';

@Injectable()
export class CallsService {
  private readonly logger = new Logger('CallsService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /** YYYY-MM-DD «сегодня» в бизнес-таймзоне (Europe/Moscow), не в TZ сервера. */
  private todayInBusinessTz(): string {
    // en-CA даёт формат YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ }).format(new Date());
  }

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

  /** True when the Mango telephony integration (migration 088) is on for a tenant. */
  private async isMangoEnabled(tenantId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM telephony_integrations WHERE tenant_id=$1 AND provider='mango' AND enabled=true LIMIT 1`,
      [tenantId],
    );
    return rows.length > 0;
  }

  async getCalls(tenantId: string, query: { date?: string; dateFrom?: string; dateTo?: string }) {
    // Mango (telephony module, migration 088) PUSHES call events to us and they are
    // PERSISTED in the `calls` table — so a Mango tenant lists straight from the DB
    // instead of the live МоиЗвонки proxy below, in the SAME response shape.
    // МоиЗвонки tenants are completely unaffected by this branch.
    if (await this.isMangoEnabled(tenantId)) {
      return this.getStoredCalls(tenantId, query);
    }

    const config = await this.getMoiZvonkiConfig(tenantId);
    if (!config) {
      throw new BadRequestException({ message: 'МоиЗвонки не настроен. Подключите интеграцию в разделе Маркетинг.' });
    }

    if (!config.domain) {
      throw new BadRequestException({ message: 'Домен МоиЗвонки не настроен.' });
    }

    const apiUrl = `https://${config.domain}.moizvonki.ru/api/v1`;

    const today = this.todayInBusinessTz();
    const dateFrom = query.dateFrom || query.date || today;
    const dateTo = query.dateTo || query.date || today;

    // Явный оффсет БИЗНЕС-таймзоны: без него строка парсится в TZ процесса (UTC).
    const fromTimestamp = Math.floor(new Date(`${dateFrom}T00:00:00${BUSINESS_TZ_OFFSET}`).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(`${dateTo}T23:59:59${BUSINESS_TZ_OFFSET}`).getTime() / 1000);

    const requestData = JSON.stringify({
      user_name: config.userName,
      api_key: config.apiKey,
      action: 'calls.list',
      from_date: fromTimestamp,
      to_date: toTimestamp,
    });

    this.logger.log(`Fetching calls from ${dateFrom} to ${dateTo} via ${apiUrl}`);

    try {
      // 10s hard deadline (item 7): a hung МоиЗвонки endpoint must fail the
      // request cleanly (the catch below already maps it to a 400 «сетевая
      // ошибка») instead of pinning a pooled HTTP worker indefinitely.
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `request_data=${encodeURIComponent(requestData)}`,
        signal: AbortSignal.timeout(10_000),
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

      const calls = Array.isArray(data.results) ? data.results : Array.isArray(data) ? data : [];

      // Log first 3 raw calls for debugging
      if (calls.length > 0) {
        for (let i = 0; i < Math.min(3, calls.length); i++) {
          const c = calls[i];
          this.logger.log(
            `Raw call[${i}]: direction=${c.direction}, answered=${c.answered}, duration=${c.duration}, client_number=${c.client_number}, src_number=${c.src_number}, src_id=${c.src_id}, recording=${c.recording ? 'yes' : 'no'}`,
          );
        }
      }

      // Collect ONLY the phone numbers that actually appear in this batch of
      // calls, so we can fetch just the matching clients instead of scanning
      // the whole tenant. Cleaning mirrors the matching logic below exactly
      // (strip spaces / dashes / plus / parens), and we also add the last-10
      // short form, since the in-memory matcher keys on both forms.
      const callPhoneCandidates = new Set<string>();
      for (const call of calls) {
        const cleaned = (call.client_number || '').replace(/[\s\-\+\(\)]/g, '');
        if (!cleaned) continue;
        callPhoneCandidates.add(cleaned);
        if (cleaned.length >= 10) callPhoneCandidates.add(cleaned.slice(-10));
      }

      const clientPhones = new Map<string, { id: string; fullName: string; cars: any[] }>();
      if (calls.length > 0 && callPhoneCandidates.size > 0) {
        const candidates = [...callPhoneCandidates];
        // Fetch only clients whose phone matches one of the call numbers.
        // Tenant-scoped. We clean the stored phone the SAME way the JS matcher
        // does — strip spaces, tabs, CR/LF, '-', '+', '(' and ')' — but with
        // translate() (literal char stripping, no regex-engine ambiguity, and
        // faster than regexp_replace). The JS regex /[\s\-\+\(\)]/ only ever
        // meets spaces among the whitespace class in real phone data, but we
        // also strip tab/CR/LF for completeness. Match either the full cleaned
        // phone or its last 10 digits against the candidate list.
        const { rows: clients } = await this.pool.query(
          `SELECT c.id, c.full_name, c.phone
             FROM clients c
            WHERE c.tenant_id = $1
              AND (
                translate(c.phone, E' \\t\\n\\r-+()', '') = ANY($2)
                OR right(translate(c.phone, E' \\t\\n\\r-+()', ''), 10) = ANY($2)
              )`,
          [tenantId, candidates],
        );
        // Rebuild the matcher map with IDENTICAL keying to the previous
        // implementation: cleaned full phone + its last-10 form. Matching the
        // mapped calls against this map below is therefore byte-for-byte the
        // same as before — we just narrowed which clients we loaded.
        for (const client of clients) {
          const cleanPhone = client.phone.replace(/[\s\-\+\(\)]/g, '');
          clientPhones.set(cleanPhone, { id: client.id, fullName: client.full_name, cars: [] });
          if (cleanPhone.length >= 10) {
            clientPhones.set(cleanPhone.slice(-10), { id: client.id, fullName: client.full_name, cars: [] });
          }
        }

        const clientIds = [...new Set([...clientPhones.values()].map((c) => c.id))];
        if (clientIds.length > 0) {
          const { rows: cars } = await this.pool.query(
            `SELECT id, plate_number, make_model, client_id FROM cars WHERE client_id = ANY($1) AND tenant_id=$2`,
            [clientIds, tenantId],
          );
          // Build O(N) reverse index: clientId -> client refs in clientPhones
          // Previously this was O(cars * phones) = quadratic. With ~5000 clients
          // and ~500 cars that is 2.5M comparisons; the new version does ~5500.
          const clientById = new Map<string, Array<{ cars: any[] }>>();
          for (const client of clientPhones.values()) {
            const list = clientById.get(client.id) || [];
            list.push(client);
            clientById.set(client.id, list);
          }
          for (const car of cars) {
            const targets = clientById.get(car.client_id);
            if (!targets) continue;
            const carRef = { plateNumber: car.plate_number, makeModel: car.make_model };
            for (const t of targets) t.cars.push(carRef);
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
        // MoiZvonki direction: 0 = incoming, 1 = outgoing
        // Also support string variants and other APIs
        const dir = call.direction ?? call.type ?? call.call_type ?? '';
        const dirVal = typeof dir === 'number' ? dir : parseInt(String(dir), 10);
        let direction: 'incoming' | 'outgoing';
        if (!isNaN(dirVal)) {
          // MoiZvonki uses 0=incoming, 1=outgoing
          direction = dirVal === 1 ? 'outgoing' : 'incoming';
        } else {
          const dirStr = String(dir).toLowerCase().trim();
          if (dirStr === 'out' || dirStr === 'outgoing' || dirStr === 'outbound') {
            direction = 'outgoing';
          } else {
            direction = 'incoming';
          }
        }
        const clientPhone = (call.client_number || '').replace(/[\s\-\+\(\)]/g, '');
        const clientPhoneShort = clientPhone.length >= 10 ? clientPhone.slice(-10) : clientPhone;

        const matchedClient = clientPhones.get(clientPhone) || clientPhones.get(clientPhoneShort) || null;

        const callDate = call.start_time ? new Date(call.start_time * 1000).toISOString() : call.date || '';

        const answered = call.answered;
        const isAnswered = answered === 1 || answered === '1' || answered === true || answered === 'true';
        const duration = parseInt(call.duration || '0') || 0;
        // Also consider answered if duration > 0
        const finalAnswered = isAnswered || duration > 0;

        return {
          id: call.db_call_id || call.event_pbx_call_id || `${call.start_time}_${clientPhone}`,
          date: callDate,
          direction,
          from: direction === 'incoming' ? call.client_number || '' : call.src_number || '',
          to: direction === 'incoming' ? call.src_number || '' : call.client_number || '',
          duration,
          status: finalAnswered ? 'answered' : 'missed',
          recordingUrl: call.recording || null,
          clientPhone,
          calledBack: false, // will be computed below
          client: matchedClient
            ? {
                id: matchedClient.id,
                fullName: matchedClient.fullName,
                cars: matchedClient.cars,
              }
            : null,
        };
      });

      this.logger.log(
        `Mapped ${mappedCalls.length} calls: ${mappedCalls.filter((c) => c.direction === 'incoming').length} in, ${mappedCalls.filter((c) => c.direction === 'outgoing').length} out`,
      );

      // Sort by date descending (newest first)
      mappedCalls.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const incoming = mappedCalls.filter((c: any) => c.direction === 'incoming');
      const outgoing = mappedCalls.filter((c: any) => c.direction === 'outgoing');
      const missed = mappedCalls.filter((c: any) => c.direction === 'incoming' && c.status === 'missed');

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

  /**
   * List PERSISTED calls (Mango / telephony module, migration 088) for a tenant,
   * mapped to the EXACT same shape the МоиЗвонки live-proxy `getCalls` returns:
   * `{ calls: [...], summary: {...} }`, direction 'incoming'|'outgoing', status
   * 'answered'|'missed', plus the calledBack / notCalledBack follow-up flags. So
   * the existing CallsController / CallsScreen render Mango calls with no change.
   */
  private async getStoredCalls(tenantId: string, query: { date?: string; dateFrom?: string; dateTo?: string }) {
    const today = this.todayInBusinessTz();
    const dateFrom = query.dateFrom || query.date || today;
    const dateTo = query.dateTo || query.date || today;

    // Границы суток — в бизнес-таймзоне (BUSINESS_TZ = Europe/Moscow): naive
    // midnight каст к timestamptz через AT TIME ZONE, иначе $2::date давал
    // полночь UTC и звонки 00:00–03:00 МСК уезжали в соседние сутки.
    // LIMIT 1000 — потолок против «dateFrom=2025-01-01&dateTo=2026-12-31»,
    // тянувшего все звонки тенанта без пагинации (класс limit-500).
    const { rows } = await this.pool.query(
      `SELECT c.id, c.provider_call_id, c.direction, c.from_number, c.to_number,
              c.client_phone, c.client_id, c.status, c.duration, c.recording_url,
              c.started_at, cl.full_name AS client_full_name
         FROM calls c
         LEFT JOIN clients cl ON cl.id = c.client_id AND cl.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1
          AND c.started_at >= ($2::date::timestamp AT TIME ZONE 'Europe/Moscow')
          AND c.started_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Europe/Moscow')
        ORDER BY c.started_at DESC
        LIMIT 1000`,
      [tenantId, dateFrom, dateTo],
    );

    // Cars for matched clients (same enrichment МоиЗвонки does), tenant-scoped.
    const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))] as string[];
    const carsByClient = new Map<string, Array<{ plateNumber: string; makeModel: string }>>();
    if (clientIds.length > 0) {
      const { rows: cars } = await this.pool.query(
        `SELECT plate_number, make_model, client_id FROM cars WHERE client_id = ANY($1) AND tenant_id=$2`,
        [clientIds, tenantId],
      );
      for (const car of cars) {
        const list = carsByClient.get(car.client_id) || [];
        list.push({ plateNumber: car.plate_number, makeModel: car.make_model });
        carsByClient.set(car.client_id, list);
      }
    }

    const mappedCalls = rows.map((r) => {
      const direction: 'incoming' | 'outgoing' = r.direction === 'outbound' ? 'outgoing' : 'incoming';
      const duration = parseInt(r.duration ?? '0', 10) || 0;
      return {
        id: r.id,
        date: r.started_at ? new Date(r.started_at).toISOString() : '',
        direction,
        from: r.from_number || '',
        to: r.to_number || '',
        duration,
        status: r.status === 'answered' ? 'answered' : 'missed',
        recordingUrl: r.recording_url || null,
        clientPhone: r.client_phone || '',
        calledBack: false, // computed below
        client: r.client_id
          ? {
              id: r.client_id,
              fullName: r.client_full_name || '',
              cars: carsByClient.get(r.client_id) || [],
            }
          : null,
      };
    });

    const incoming = mappedCalls.filter((c) => c.direction === 'incoming');
    const outgoing = mappedCalls.filter((c) => c.direction === 'outgoing');
    const missed = mappedCalls.filter((c) => c.direction === 'incoming' && c.status === 'missed');

    // "Called back": an outgoing answered call OR a later answered incoming from the
    // same number clears a missed call — identical logic to the МоиЗвонки path.
    const calledBackPhones = new Set<string>();
    const short = (phone: string) => {
      const p = (phone || '').replace(/[\s\-\+\(\)]/g, '');
      return p.length >= 10 ? p.slice(-10) : p;
    };
    for (const c of outgoing) {
      if (c.duration > 0) calledBackPhones.add(short(c.to));
    }
    for (const c of incoming) {
      if (c.status === 'answered') calledBackPhones.add(short(c.from));
    }

    const notCalledBack: typeof missed = [];
    for (const c of missed) {
      if (calledBackPhones.has(short(c.from))) {
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
  }

  async getRecordingUrl(tenantId: string, recordUrl: string) {
    if (!recordUrl) {
      throw new BadRequestException({ message: 'URL записи не указан' });
    }

    // Mango-тенант листает звонки из БД (getStoredCalls), где recordingUrl —
    // это provider recording_id, а не URL. Ветвимся по провайдеру ровно как
    // getCalls: раньше этот метод был жёстко завязан на МоиЗвонки и для Mango
    // отвечал 400 «МоиЗвонки не настроен» (записи неслушабельны в принципе).
    if (await this.isMangoEnabled(tenantId)) {
      return this.getMangoRecordingUrl(tenantId, recordUrl);
    }

    const config = await this.getMoiZvonkiConfig(tenantId);
    if (!config) {
      throw new BadRequestException({ message: 'МоиЗвонки не настроен' });
    }

    // Only allow URLs from the configured MoiZvonki domain.
    // Earlier we used `.includes(allowedDomain)` here, which a crafted URL
    // like https://attacker.com/?fake=tenant.moizvonki.ru could pass — the
    // recording then opens an attacker-controlled origin in the mobile/web
    // app's WebView. Parse the URL and compare the actual hostname instead.
    if (recordUrl.startsWith('http://') || recordUrl.startsWith('https://')) {
      const allowedHost = `${config.domain}.moizvonki.ru`;
      let parsed: URL;
      try {
        parsed = new URL(recordUrl);
      } catch {
        throw new BadRequestException({ message: 'Недопустимый URL записи' });
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new BadRequestException({ message: 'Недопустимый URL записи' });
      }
      if (parsed.hostname !== allowedHost) {
        throw new BadRequestException({ message: 'Недопустимый URL записи' });
      }
      return { url: parsed.toString() };
    }

    const apiUrl = `https://${config.domain}.moizvonki.ru/api/v1`;
    const requestData = JSON.stringify({
      user_name: config.userName,
      api_key: config.apiKey,
      action: 'calls.record_url',
      recording: recordUrl,
    });

    try {
      // Same 10s deadline as getCalls (item 7); the catch below keeps the
      // existing graceful fallback to the direct /records URL.
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `request_data=${encodeURIComponent(requestData)}`,
        signal: AbortSignal.timeout(10_000),
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

  /**
   * Exchange a Mango recording_id (persisted into calls.recording_url by the
   * telephony webhook, see telephony.service.onRecording) for a playable
   * temporary URL. Mango's /vpbx/queries/recording/post answers 302 with the
   * file URL in Location; the request is signed exactly like webhook callbacks
   * are verified (mango.provider): sign = sha256(api_key + json + api_salt).
   */
  private async getMangoRecordingUrl(tenantId: string, recordingRef: string) {
    const { rows } = await this.pool.query(
      `SELECT api_key, api_salt FROM telephony_integrations
        WHERE tenant_id=$1 AND provider='mango' AND enabled=true LIMIT 1`,
      [tenantId],
    );
    const apiKey = rows[0]?.api_key as string | undefined;
    const apiSalt = rows[0]?.api_salt as string | undefined;
    if (!apiKey || !apiSalt) {
      throw new BadRequestException({ message: 'Телефония Mango не настроена' });
    }

    const json = JSON.stringify({ recording_id: recordingRef, action: 'play' });
    const sign = createHash('sha256')
      .update(apiKey + json + apiSalt)
      .digest('hex');
    const body = new URLSearchParams({ vpbx_api_key: apiKey, sign, json }).toString();

    try {
      // redirect: 'manual' — нужен сам Location (временный URL файла), а не
      // редирект. Тот же 10s-дедлайн, что и в остальных внешних запросах.
      const response = await fetch('https://app.mango-office.ru/vpbx/queries/recording/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      const location = response.headers.get('location');
      if (location) {
        return { url: location };
      }
      this.logger.warn(`Mango recording: unexpected status ${response.status} for tenant ${tenantId}`);
    } catch (err) {
      this.logger.warn(`Mango recording request failed: ${err}`);
    }
    throw new BadRequestException({ message: 'Не удалось получить запись разговора' });
  }

  async getClientCalls(tenantId: string, clientId: string, query: { dateFrom?: string; dateTo?: string }) {
    const { rows: clientRows } = await this.pool.query(`SELECT phone FROM clients WHERE id=$1 AND tenant_id=$2`, [
      clientId,
      tenantId,
    ]);
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
    return rows.map((r) => ({
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
