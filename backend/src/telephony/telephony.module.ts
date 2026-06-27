import { Module } from '@nestjs/common';
import { TelephonyController } from './telephony.controller';
import { TelephonyWebhookController } from './telephony-webhook.controller';
import { TelephonyService } from './telephony.service';

/**
 * Телефония (Mango Office). PG_POOL is provided globally by DatabaseModule
 * (@Global) and PushService by PushModule (@Global) — no imports needed. Two
 * controllers:
 *   • TelephonyController        — authenticated (JwtAuthGuard at class level),
 *                                  owner-class settings.
 *   • TelephonyWebhookController — PUBLIC (no JwtAuthGuard); Mango POSTs callbacks
 *                                  here. See that file for why this is the only
 *                                  guard-free route and how trust is re-established
 *                                  (signature verification) server-side.
 *
 * Provider-agnostic: the service selects a TelephonyProvider adapter (Mango real)
 * at call time from the per-tenant config. INERT until the owner pastes a real
 * Mango vpbx api key + salt and flips `enabled` on — the webhook is a 200 no-op
 * until then.
 */
@Module({
  controllers: [TelephonyController, TelephonyWebhookController],
  providers: [TelephonyService],
})
export class TelephonyModule {}
