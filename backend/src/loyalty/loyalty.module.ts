import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

/**
 * Программа лояльности / бонусы / кешбэк. PG_POOL is provided globally by
 * DatabaseModule (@Global) — no import needed. Owns `loyalty_settings` and
 * `client_bonuses`; reads clients/checks read-only. Never touches the checks
 * write path — accrual/redemption are explicit endpoints the cash UI calls.
 */
@Module({
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
})
export class LoyaltyModule {}
