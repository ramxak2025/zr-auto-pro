import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { TelephonyService } from './telephony.service';

/**
 * PUBLIC Mango VPBX callback — POST /api/telephony/webhook/:tenantId
 *
 * ── How this route is public (and ONLY this route) ──────────────────────────
 * This project has NO global JwtAuthGuard (main.ts wires only the global
 * RateLimitGuard); JWT auth is opt-in PER CONTROLLER via
 * `@UseGuards(JwtAuthGuard, RolesGuard)`. This controller deliberately applies
 * NEITHER guard, so Mango can POST without a token. The global JwtAuthGuard is
 * therefore not weakened at all — there is none to weaken — and every other
 * controller keeps its own `@UseGuards(JwtAuthGuard, ...)`. Splitting the webhook
 * into its own guard-free controller (instead of an exception inside the
 * authenticated TelephonyController) makes the public surface explicit and
 * impossible to widen by accident.
 *
 * The global RateLimitGuard STILL applies (write bucket, per source IP). Mango
 * posts from a small set of IPs and retries on a non-2xx, so a throttle only
 * delays delivery, never drops it.
 *
 * ── Trust model ─────────────────────────────────────────────────────────────
 * The body is NOT trusted until verified. The service recomputes the Mango
 * signature — sha256(api_key + json + api_salt) — with the tenant's OWN stored
 * salt and timing-safe-compares it to `sign`; a mismatch is dropped. The tenant
 * is identified by the :tenantId path segment (the value the owner puts in the
 * Mango callback URL). Mango sends form-urlencoded { vpbx_api_key, json, sign };
 * main.ts enables express urlencoded(), so `body` arrives as a plain object.
 *
 * Always answers 200 quickly (handleWebhook never throws) so Mango marks the
 * callback delivered.
 */
@Controller('telephony/webhook')
export class TelephonyWebhookController {
  constructor(private telephony: TelephonyService) {}

  @Post(':tenantId')
  @HttpCode(200)
  async webhook(@Param('tenantId') tenantId: string, @Body() body: unknown): Promise<{ received: true }> {
    // handleWebhook never throws — process best-effort and acknowledge fast.
    await this.telephony.handleWebhook(tenantId, body);
    return { received: true };
  }
}
