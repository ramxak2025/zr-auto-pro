/**
 * Provider-agnostic acquiring contract.
 *
 * One small interface so the rest of the module (controller/service/ledger) never
 * knows which acquirer is behind it. ЮKassa is implemented for real; Tinkoff is a
 * stub that throws "not configured". Adding a third provider = one more class.
 *
 * The normalized PaymentStatus is the project-internal lifecycle ('pending' |
 * 'succeeded' | 'canceled'); each provider maps its own richer status set onto it.
 */

/** Normalized payment lifecycle used across the whole module + the API contract. */
export type PaymentStatus = 'pending' | 'succeeded' | 'canceled';

/** How the client pays. NULL/omitted ⇒ the provider's default flow. */
export type PaymentMethod = 'sbp' | 'card';

export type PaymentProviderName = 'yookassa' | 'tinkoff';

/** Per-tenant credentials pulled from `payment_integrations`. */
export interface PaymentProviderConfig {
  provider: PaymentProviderName;
  shopId: string;
  secretKey: string;
}

export interface CreatePaymentInput {
  /** Major-unit amount (RUB), e.g. 1500.5 → "1500.50". Must be > 0. */
  amount: number;
  currency: string;
  description: string;
  method?: PaymentMethod;
  /** Where the acquirer returns the client after a redirect (card flow). */
  returnUrl?: string;
  /**
   * Idempotence key — the SAME logical create retried with this key must not
   * double-charge. We pass our ledger row's intent id; ЮKassa dedups on it.
   */
  idempotenceKey: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  status: PaymentStatus;
  /** URL the client opens to pay (card redirect). Present for the redirect flow. */
  confirmationUrl?: string;
  /** SBP-QR payload (a string to render as a QR / open). Present for the QR flow. */
  qr?: string;
}

/** Authoritative re-read of a payment straight from the provider (reconciliation). */
export interface FetchPaymentResult {
  status: PaymentStatus;
  /** Provider-reported amount in major units, for amount reconciliation. */
  amount?: number;
}

export interface WebhookResult {
  providerPaymentId: string;
  status: PaymentStatus;
  /** Amount the webhook claims, in major units. NEVER trusted on its own. */
  amount?: number;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;

  /** Create a payment at the acquirer and return the normalized result. */
  createPayment(cfg: PaymentProviderConfig, input: CreatePaymentInput): Promise<CreatePaymentResult>;

  /**
   * Parse + minimally validate an inbound webhook into a normalized result.
   * Throws if the body shape is not a recognizable notification. The caller
   * RE-VERIFIES against the provider (getPayment) and the stored ledger row
   * before trusting the status — the webhook body is never authoritative.
   */
  parseWebhook(cfg: PaymentProviderConfig, body: unknown, headers: Record<string, unknown>): WebhookResult;

  /**
   * Authoritative re-read by provider payment id. Optional: used to reconcile a
   * webhook / poll against the source of truth. A provider that can't re-read
   * may omit it; the caller then falls back to the (amount-reconciled) webhook.
   */
  getPayment?(cfg: PaymentProviderConfig, providerPaymentId: string): Promise<FetchPaymentResult>;
}
