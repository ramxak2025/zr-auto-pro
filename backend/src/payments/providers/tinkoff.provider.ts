import { NotImplementedException } from '@nestjs/common';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  PaymentProviderConfig,
  WebhookResult,
} from './payment-provider.interface';

/**
 * Tinkoff acquiring — RESERVED stub.
 *
 * The schema + adapter are provider-agnostic, so 'tinkoff' is a valid value in
 * `payment_integrations.provider`, but the real Tinkoff Internet-Acquiring REST
 * integration is not implemented yet. Every entry point throws a clear, explicit
 * error so a tenant that selects Tinkoff gets an honest "not configured" instead
 * of a silent no-charge. Implement against https://www.tbank.ru/kassa/dev/payments
 * (Init / GetState, token signing) when needed.
 */
export class TinkoffProvider implements PaymentProvider {
  readonly name = 'tinkoff' as const;

  private notConfigured(): never {
    throw new NotImplementedException({
      message: 'Провайдер Tinkoff пока не подключён. Выберите ЮKassa.',
    });
  }

  createPayment(_cfg: PaymentProviderConfig, _input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return this.notConfigured();
  }

  parseWebhook(_cfg: PaymentProviderConfig, _body: unknown, _headers: Record<string, unknown>): WebhookResult {
    return this.notConfigured();
  }
}
