import { BadGatewayException } from '@nestjs/common';
import {
  FiscalProvider,
  FiscalProviderConfig,
  FiscalReceiptInput,
  FiscalStatus,
  FiscalStatusResult,
  FiscalizeResult,
} from './fiscal-provider.interface';

/**
 * Real АТОЛ Онлайн (ATOL Online) фискализация provider — https://online.atol.ru
 * API v4 docs: https://online.atol.ru/files/API_atol_online_v4.pdf
 *
 * ── Endpoints (production) ───────────────────────────────────────────────────
 *   POST  https://online.atol.ru/possystem/v4/getToken
 *         body { login, pass } → { token, error, timestamp }. Token lives ~24h.
 *   POST  https://online.atol.ru/possystem/v4/{group_code}/sell
 *         header Token; body { external_id, receipt, service, timestamp }
 *         → { uuid, status:'wait', error, timestamp }
 *   GET   https://online.atol.ru/possystem/v4/{group_code}/report/{uuid}
 *         header Token → { uuid, status:'done'|'fail'|'wait', payload, error }
 *
 *   (Test loop is https://testonline.atol.ru/possystem/v4 — same shapes. We use
 *    production here; the module is inert until the owner enters credentials, so
 *    nothing is ever sent to АТОЛ before that.)
 *
 * ── Auth / token caching ─────────────────────────────────────────────────────
 *   getToken takes login+password and returns a bearer token valid ~24h. We cache
 *   it in-process keyed by login (the token is per-account, group-independent) for
 *   23h, and pass it on every sell/report as the `Token` header. On a 401 (expired
 *   / revoked token) we drop the cache, re-issue once, and retry the call. The
 *   password is a SERVER secret — sent ONLY to online.atol.ru over TLS and NEVER
 *   logged (we log only HTTP status / АТОЛ error text, never credentials).
 *
 * ── Idempotence ──────────────────────────────────────────────────────────────
 *   Every sell carries `external_id` (our ledger row's UUID). Re-submitting the
 *   same external_id returns the same document instead of double-fiscalizing.
 *
 * ── Receipt JSON mapping ─────────────────────────────────────────────────────
 *   receipt.client  = { email?, phone? }                  (≥1 required by 54-ФЗ)
 *   receipt.company = { email, sno, inn, payment_address } (from config)
 *   receipt.items[] = { name, price, quantity, sum,
 *                       payment_method:'full_payment',     (полный расчёт)
 *                       payment_object:'service'|'commodity',
 *                       vat:{ type: cfg.vat } }
 *   receipt.payments[] = { type: 0|1, sum }  (0 наличными, 1 безналичными)
 *   receipt.total   = total
 *   service         = { inn, payment_address, callback_url:'' }
 *   timestamp       = 'dd.mm.yyyy HH:MM:SS'
 *
 * ── Status mapping ───────────────────────────────────────────────────────────
 *   sell → 'wait'            → 'pending'
 *   report status 'done'     → 'done'   (payload carries ФД № + ФПД + ОФД url)
 *   report status 'fail'     → 'failed' (error text surfaced)
 *   report status 'wait'/etc → 'pending'
 */
export class AtolProvider implements FiscalProvider {
  readonly name = 'atol' as const;

  private static readonly BASE_URL = 'https://online.atol.ru/possystem/v4';
  // Network guard so a hung operator call can't pin a request worker forever.
  private static readonly TIMEOUT_MS = 20_000;
  // АТОЛ tokens live 24h; refresh a little early.
  private static readonly TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

  /** In-process token cache, keyed by login (token is per-account). */
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  // ─── HTTP ────────────────────────────────────────────────────────────────

  private async request(
    method: 'GET' | 'POST',
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<{ ok: boolean; status: number; json: any }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AtolProvider.TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${AtolProvider.BASE_URL}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...(opts.token ? { Token: opts.token } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      // Network / abort. Clean 502 — never leak credentials in the message.
      throw new BadGatewayException({
        message: 'Не удалось связаться с сервисом фискализации АТОЛ. Повторите позже.',
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  }

  /** Extract a human АТОЛ error text without ever surfacing a token/credential. */
  private errorText(json: any, fallback: string): string {
    const e = json?.error;
    if (e && typeof e === 'object') {
      return String(e.text || e.code || fallback);
    }
    return fallback;
  }

  // ─── Token ─────────────────────────────────────────────────────────────────

  private async getToken(cfg: FiscalProviderConfig, forceRefresh = false): Promise<string> {
    const cached = this.tokenCache.get(cfg.login);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
    const { ok, json } = await this.request('POST', '/getToken', {
      body: { login: cfg.login, pass: cfg.password },
    });
    const token = json?.token;
    if (!ok || !token || (json?.error && json.error !== null)) {
      throw new BadGatewayException({
        message: `АТОЛ: не удалось авторизоваться — ${this.errorText(json, 'проверьте login и пароль')}`,
      });
    }
    this.tokenCache.set(cfg.login, { token, expiresAt: Date.now() + AtolProvider.TOKEN_TTL_MS });
    return token;
  }

  /**
   * Run an authenticated call, transparently re-issuing the token once on a 401
   * (expired / revoked). Any other failure surfaces as a clean 502.
   */
  private async withToken<T>(
    cfg: FiscalProviderConfig,
    run: (token: string) => Promise<{ ok: boolean; status: number; json: any }>,
    onResult: (json: any) => T,
    contextLabel: string,
  ): Promise<T> {
    let token = await this.getToken(cfg);
    let { ok, status, json } = await run(token);
    if (status === 401) {
      this.tokenCache.delete(cfg.login);
      token = await this.getToken(cfg, true);
      ({ ok, status, json } = await run(token));
    }
    if (!ok && status !== 200) {
      throw new BadGatewayException({ message: `АТОЛ (${contextLabel}): ${this.errorText(json, 'ошибка оператора')}` });
    }
    return onResult(json);
  }

  // ─── Serialization ──────────────────────────────────────────────────────────

  /** 'dd.mm.yyyy HH:MM:SS' in the operator's expected timestamp format. */
  private formatTimestamp(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(
      d.getSeconds(),
    )}`;
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private buildSellBody(cfg: FiscalProviderConfig, receipt: FiscalReceiptInput): Record<string, unknown> {
    const client: Record<string, unknown> = {};
    if (receipt.email) client.email = receipt.email;
    if (receipt.phone) client.phone = receipt.phone;

    const company: Record<string, unknown> = {};
    if (cfg.companyEmail) company.email = cfg.companyEmail;
    if (cfg.sno) company.sno = cfg.sno;
    if (cfg.inn) company.inn = cfg.inn;
    if (cfg.paymentAddress) company.payment_address = cfg.paymentAddress;

    const items = receipt.items.map((it) => ({
      name: it.name.slice(0, 128),
      price: this.round2(it.price),
      quantity: it.quantity,
      sum: this.round2(it.sum),
      payment_method: 'full_payment',
      payment_object: it.paymentObject,
      vat: { type: cfg.vat || 'none' },
    }));

    const payments = receipt.payments.map((p) => ({
      // АТОЛ payment types: 0 — наличными, 1 — безналичными (электронно).
      type: p.type === 'cash' ? 0 : 1,
      sum: this.round2(p.sum),
    }));

    return {
      external_id: receipt.externalId,
      receipt: {
        client,
        company,
        items,
        payments,
        total: this.round2(receipt.total),
      },
      service: {
        callback_url: '',
        ...(cfg.inn ? { inn: cfg.inn } : {}),
        ...(cfg.paymentAddress ? { payment_address: cfg.paymentAddress } : {}),
      },
      timestamp: this.formatTimestamp(new Date()),
    };
  }

  private mapReportStatus(raw: unknown): FiscalStatus {
    switch (raw) {
      case 'done':
        return 'done';
      case 'fail':
        return 'failed';
      // 'wait' or anything unknown → still processing.
      default:
        return 'pending';
    }
  }

  // ─── Provider API ────────────────────────────────────────────────────────────

  async fiscalize(cfg: FiscalProviderConfig, receipt: FiscalReceiptInput): Promise<FiscalizeResult> {
    const body = this.buildSellBody(cfg, receipt);
    return this.withToken(
      cfg,
      (token) => this.request('POST', `/${encodeURIComponent(cfg.groupCode)}/sell`, { token, body }),
      (json) => {
        const uuid = json?.uuid;
        if (!uuid || (json?.error && json.error !== null)) {
          throw new BadGatewayException({ message: `АТОЛ (sell): ${this.errorText(json, 'документ не принят')}` });
        }
        return { providerUuid: String(uuid), status: this.mapReportStatus(json?.status) };
      },
      'sell',
    );
  }

  async getStatus(cfg: FiscalProviderConfig, providerUuid: string): Promise<FiscalStatusResult> {
    return this.withToken(
      cfg,
      (token) =>
        this.request('GET', `/${encodeURIComponent(cfg.groupCode)}/report/${encodeURIComponent(providerUuid)}`, {
          token,
        }),
      (json) => {
        const status = this.mapReportStatus(json?.status);
        const payload = json?.payload ?? {};
        const result: FiscalStatusResult = { status };
        if (status === 'done') {
          if (payload.fiscal_document_number !== undefined) {
            result.fiscalDocNumber = String(payload.fiscal_document_number);
          }
          if (payload.fiscal_document_attribute !== undefined) {
            result.fiscalSign = String(payload.fiscal_document_attribute);
          }
          if (payload.ofd_receipt_url) {
            result.ofdReceiptUrl = String(payload.ofd_receipt_url);
          }
        } else if (status === 'failed') {
          result.error = this.errorText(json, 'ФН отклонил документ');
        }
        return result;
      },
      'report',
    );
  }
}
