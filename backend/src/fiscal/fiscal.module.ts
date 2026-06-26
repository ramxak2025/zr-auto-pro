import { Module } from '@nestjs/common';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';

/**
 * Онлайн-касса / фискализация 54-ФЗ (АТОЛ Онлайн). PG_POOL is provided globally by
 * DatabaseModule (@Global) — no import needed. Single AUTHENTICATED controller —
 * АТОЛ is poll-based, so there is NO public webhook route.
 *
 * Provider-agnostic: the service selects a FiscalProvider adapter (АТОЛ Онлайн
 * real) at call time from the per-tenant config. INERT until the owner adds real
 * АТОЛ login + password + group_code AND enables it — POST /fiscal/fiscalize
 * returns 422 otherwise.
 */
@Module({
  controllers: [FiscalController],
  providers: [FiscalService],
})
export class FiscalModule {}
