import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * PUBLIC acquiring webhook — POST /api/payments/webhook/:tenantId
 *
 * ── How this route is public (and ONLY this route) ──────────────────────────
 * This project has NO global JwtAuthGuard (main.ts wires only the global
 * RateLimitGuard); JWT auth is opt-in PER CONTROLLER via
 * `@UseGuards(JwtAuthGuard, RolesGuard)`. This controller deliberately applies
 * NEITHER guard, so it is reachable without a token. The global JwtAuthGuard is
 * therefore not weakened at all — there is none to weaken — and every other
 * controller keeps its own `@UseGuards(JwtAuthGuard, ...)`. Splitting the webhook
 * into its own guard-free controller (instead of an exception inside the
 * authenticated PaymentsController) makes the public surface explicit and
 * impossible to widen by accident.
 *
 * The global RateLimitGuard STILL applies (write bucket, per source IP). The
 * acquirer sends notifications from a small set of IPs; the limit is generous and
 * it retries on a non-2xx, so a throttle just delays delivery, never drops it.
 *
 * ── Trust model ─────────────────────────────────────────────────────────────
 * The body is NOT trusted. The service re-reads the payment from the provider
 * (authenticated with the tenant's own keys) and reconciles the amount against
 * the stored ledger row before changing any status. The tenant is identified by
 * the :tenantId path segment (set when the owner registers the webhook URL).
 *
 * Always answers 200 quickly so the acquirer marks the notification delivered.
 */
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(private payments: PaymentsService) {}

  @Post(':tenantId')
  @HttpCode(200)
  async webhook(
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string>,
  ): Promise<{ received: true }> {
    // handleWebhook never throws — process best-effort and acknowledge fast.
    await this.payments.handleWebhook(tenantId, body, headers);
    return { received: true };
  }
}
