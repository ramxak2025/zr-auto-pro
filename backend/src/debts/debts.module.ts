import { Module } from '@nestjs/common';
import { DebtsController } from './debts.controller';
import { DebtsService } from './debts.service';

/**
 * Дебиторка / долги клиентов. PG_POOL is provided globally by DatabaseModule
 * (@Global) — no import needed. Owns only `client_debts`; reads clients/checks.
 */
@Module({
  controllers: [DebtsController],
  providers: [DebtsService],
})
export class DebtsModule {}
