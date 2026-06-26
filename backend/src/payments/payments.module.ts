import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { PaymentsService } from './payments.service';

/**
 * Эквайринг + СБП (acquiring + SBP). PG_POOL is provided globally by
 * DatabaseModule (@Global) — no import needed. Two controllers:
 *   • PaymentsController        — authenticated (JwtAuthGuard at class level).
 *   • PaymentsWebhookController  — PUBLIC (no JwtAuthGuard); the acquirer posts
 *                                 notifications here. See that file for why this
 *                                 is the only guard-free route and how trust is
 *                                 re-established server-side.
 *
 * Provider-agnostic: the service selects a PaymentProvider adapter (ЮKassa real,
 * Tinkoff stub) at call time from the per-tenant config. Inert until the owner
 * adds real ЮKassa keys — POST /payments/create returns 422 otherwise.
 */
@Module({
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
