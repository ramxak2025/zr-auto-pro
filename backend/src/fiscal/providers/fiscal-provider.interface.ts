/**
 * Provider-agnostic фискализация (54-ФЗ) contract.
 *
 * One small interface so the rest of the module (controller/service/ledger) never
 * knows which ОФД/фискализация operator is behind it. АТОЛ Онлайн is implemented
 * for real; adding a second operator = one more class. The provider is given a
 * fully-built, normalized receipt — it ONLY serializes it into the operator's
 * wire format, calls the operator, and maps the operator's status onto the
 * project-internal lifecycle. ALL business logic (reading the check, scaling the
 * discount, choosing payment_object/payment tender) lives in the service.
 *
 * The normalized FiscalStatus is the project-internal lifecycle ('pending' |
 * 'done' | 'failed'); each provider maps its own richer status set onto it.
 */

/** Normalized фискализация lifecycle used across the module + the API contract. */
export type FiscalStatus = 'pending' | 'done' | 'failed';

export type FiscalProviderName = 'atol';

/**
 * Per-tenant credentials + receipt-header config pulled from
 * `fiscal_integrations`. `login`/`password`/`groupCode` are required to call the
 * operator (the service guarantees they are non-empty before constructing this).
 * `password` is a SERVER secret — sent ONLY to the operator over TLS, never logged.
 */
export interface FiscalProviderConfig {
  provider: FiscalProviderName;
  login: string;
  password: string;
  groupCode: string;
  /** Система налогообложения: 'osn'|'usn_income'|'usn_income_outcome'|'envd'|'esn'|'patent'. */
  sno: string | null;
  inn: string | null;
  /** Адрес расчётов (place of settlement / shop address). */
  paymentAddress: string | null;
  /** Email организации-отправителя чека (company.email). */
  companyEmail: string | null;
  /** vat.type for every item: 'none'|'vat0'|'vat10'|'vat20'|'vat110'|'vat120'. */
  vat: string;
}

/** How a single tender is settled on the receipt. cash → наличные, electronic → безналичные. */
export type FiscalTenderType = 'cash' | 'electronic';

/** One receipt line, already net of any check-level discount (built by the service). */
export interface FiscalReceiptItem {
  name: string;
  /** Per-unit price in major units (RUB), 2 decimals. */
  price: number;
  /** Quantity (units). */
  quantity: number;
  /** Line sum in major units (price × quantity, reconciled to the receipt total). */
  sum: number;
  /** ОФД предмет расчёта: 'service' (услуга) or 'commodity' (товар). */
  paymentObject: 'service' | 'commodity';
}

/** One tender split (how the client paid this receipt). Σ sum == receipt total. */
export interface FiscalReceiptPayment {
  type: FiscalTenderType;
  sum: number;
}

/**
 * Fully-built, normalized receipt the service hands to the provider. The provider
 * does NOT compute anything financial — it only serializes this into the operator
 * JSON (adding sno/inn/vat/company from the config) and sends it.
 */
export interface FiscalReceiptInput {
  /** Idempotence key (a UUID) — the operator dedups a retried fiscalization on it. */
  externalId: string;
  /** Client email for the electronic receipt (54-ФЗ). At least one of email/phone set. */
  email?: string | null;
  /** Client phone for the electronic receipt (54-ФЗ). At least one of email/phone set. */
  phone?: string | null;
  items: FiscalReceiptItem[];
  payments: FiscalReceiptPayment[];
  /** Receipt total in major units (== Σ items.sum == Σ payments.sum). */
  total: number;
}

/** Result of submitting a receipt to the operator (sell). */
export interface FiscalizeResult {
  /** Operator document uuid — used to poll the fiscal result. */
  providerUuid: string;
  /** Almost always 'pending' right after submit (ФН processes asynchronously). */
  status: FiscalStatus;
}

/** Authoritative re-read of a фискализация result straight from the operator. */
export interface FiscalStatusResult {
  status: FiscalStatus;
  /** ФД — фискальный документ № (once done). */
  fiscalDocNumber?: string;
  /** ФП/ФПД — фискальный признак документа (once done). */
  fiscalSign?: string;
  /** Ссылка на чек в ОФД, если оператор её вернул. */
  ofdReceiptUrl?: string;
  /** Текст ошибки при failed. */
  error?: string;
}

export interface FiscalProvider {
  readonly name: FiscalProviderName;

  /** Submit a receipt to the operator and return its document uuid + status. */
  fiscalize(cfg: FiscalProviderConfig, receipt: FiscalReceiptInput): Promise<FiscalizeResult>;

  /** Authoritative re-read of a fiscalization by operator document uuid (poll). */
  getStatus(cfg: FiscalProviderConfig, providerUuid: string): Promise<FiscalStatusResult>;
}
