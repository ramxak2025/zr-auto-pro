import { Module } from '@nestjs/common';
import { MotivationController } from './motivation.controller';
import { MotivationService } from './motivation.service';

/**
 * «Мотивация сотрудников» v1 — акционные товары (employee motivation: promo
 * products). Owns `motivation_promo_products` (config) and reads
 * `motivation_accruals` (ledger). PG_POOL is provided globally by DatabaseModule
 * (@Global) — no import needed. The accrual WRITE lives on the check payment path
 * (ChecksService); salary reads the ledger directly — so there is no cross-module
 * dependency to wire here.
 */
@Module({
  controllers: [MotivationController],
  providers: [MotivationService],
})
export class MotivationModule {}
