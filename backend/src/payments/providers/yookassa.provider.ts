import { BadGatewayException } from '@nestjs/common';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  FetchPaymentResult,
  PaymentProvider,
  PaymentProviderConfig,
  PaymentStatus,
  WebhookResult,
} from './payment-provider.interface';

/**
 * Real ЮKassa (YooKassa) acquiring provider — https://yookassa.ru/developers/api
 *
 * ── Endpoint ────────────────────────────────────────────────────────────────
 *   POST   https://api.yookassa.ru/v3/payments         create a payment
 *   GET    https://api.yookassa.ru/v3/payments/{id}     re-read (reconciliation)
 *
 * ── Auth ────────────────────────────────────────────────────────────────────
 *   HTTP Basic: username = shopId, password = secretKey
 *   → `Authorization: Basic base64("<shopId>:<secretKey>")`
 *   The secret key is a SERVER secret — it is sent ONLY to api.yookassa.ru over
 *   TLS and is NEVER logged (we log status codes, never headers/keys).
 *
 * ── Idempotence ─────────────────────────────────────────────────────────────
 *   Every POST carries an `Idempotence-Key` header (a UUID). Retrying a create
 *   with the same key returns the same payment instead of double-charging.
 *
 * ── SBP (СБП) ───────────────────────────────────────────────────────────────
 *   method 'sbp'  → body `payment_method_data: { type: 'sbp' }` +
 *                   `confirmation: { type: 'qr' }`. ЮKassa returns
 *                   `confirmation.confirmation_data` — the SBP QR payload the
 *                   client scans / opens in their bank app.
 *   method 'card' (or unset) → `confirmation: { type: 'redirect', return_url }`.
 *                   ЮKassa returns `confirmation.confirmation_url` to open.
 *   `capture: true` ⇒ one-step payment (auth+capture), so a paid payment goes
 *   straight to `succeeded` with no manual capture step.
 *
 * ── Status mapping ──────────────────────────────────────────────────────────
 *   pending | waiting_for_capture → 'pending'
 *   succeeded                     → 'succeeded'
 *   canceled                      → 'canceled'
 */
export class YooKassaProvider implements PaymentProvider {
  readonly name = 'yookassa' as const;

  private static readonly BASE_URL = 'https://api.yookassa.ru/v3';
  // Network guard so a hung acquirer call can't pin a request worker forever.
  private static readonly TIMEOUT_MS = 15_000;

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private authHeader(cfg: PaymentProviderConfig): string {
    return 'Basic ' + Buffer.from(`${cfg.shopId}:${cfg.secretKey}`).toString('base64');
  }

  /** Major-unit number → ЮKassa amount string with exactly 2 decimals. */
  private formatAmount(amount: number): string {
    return (Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2);
  }

  private mapStatus(raw: unknown): PaymentStatus {
    switch (raw) {
      case 'succeeded':
        return 'succeeded';
      case 'canceled':
        return 'canceled';
      // pending, waiting_for_capture, or anything unknown → treat as not-yet-paid.
      default:
        return 'pending';
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    cfg: PaymentProviderConfig,
    extraHeaders?: Record<string, string>,
    body?: unknown,
  ): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), YooKassaProvider.TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${YooKassaProvider.BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: this.authHeader(cfg),
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // Network / abort. Surface a clean 502 — never leak the key in the message.
      throw new BadGatewayException({
        message: 'Не удалось связаться с платёжным провайдером. Повторите позже.',
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

    if (!res.ok) {
      // ЮKassa returns { type, code, description }. Surface the description (not a
      // secret) so the owner can fix bad keys; default to a generic message.
      const description = (json && (json.description || json.message)) || 'Ошибка платёжного провайдера';
      throw new BadGatewayException({ message: `ЮKassa: ${description}` });
    }
    return json;
  }

  // ─── Provider API ────────────────────────────────────────────────────────────

  async createPayment(cfg: PaymentProviderConfig, input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const isSbp = input.method === 'sbp';

    const body: Record<string, unknown> = {
      amount: { value: this.formatAmount(input.amount), currency: input.currency || 'RUB' },
      capture: true,
      description: input.description?.slice(0, 128) || undefined,
      confirmation: isSbp
        ? { type: 'qr' }
        : { type: 'redirect', return_url: input.returnUrl || 'https://autexa.pw/payment-return' },
    };
    if (isSbp) {
      body.payment_method_data = { type: 'sbp' };
    }

    const json = await this.request('POST', '/payments', cfg, { 'Idempotence-Key': input.idempotenceKey }, body);

    const confirmation = json?.confirmation ?? {};
    return {
      providerPaymentId: String(json?.id ?? ''),
      status: this.mapStatus(json?.status),
      // redirect flow → confirmation_url; qr flow → confirmation_data (the SBP QR).
      confirmationUrl: confirmation.confirmation_url ?? undefined,
      qr: confirmation.confirmation_data ?? undefined,
    };
  }

  async getPayment(cfg: PaymentProviderConfig, providerPaymentId: string): Promise<FetchPaymentResult> {
    const json = await this.request('GET', `/payments/${encodeURIComponent(providerPaymentId)}`, cfg);
    const amountValue = json?.amount?.value;
    return {
      status: this.mapStatus(json?.status),
      amount: amountValue !== undefined ? parseFloat(amountValue) : undefined,
    };
  }

  parseWebhook(_cfg: PaymentProviderConfig, body: unknown, _headers: Record<string, unknown>): WebhookResult {
    // ЮKassa notification: { type: 'notification', event: 'payment.succeeded',
    //                        object: { id, status, amount: { value, currency }, ... } }
    const b = (body ?? {}) as any;
    const obj = b.object;
    if (!obj || typeof obj.id !== 'string') {
      // Not a recognizable notification — caller turns this into a 200 no-op so
      // the acquirer stops retrying a body we can't act on.
      throw new BadGatewayException({ message: 'Нераспознанный webhook' });
    }
    const amountValue = obj?.amount?.value;
    return {
      providerPaymentId: obj.id,
      status: this.mapStatus(obj.status),
      amount: amountValue !== undefined ? parseFloat(amountValue) : undefined,
    };
  }
}
