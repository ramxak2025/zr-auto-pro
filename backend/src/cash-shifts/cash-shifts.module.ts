import { Module } from '@nestjs/common';
import { CashShiftsController } from './cash-shifts.controller';
import { CashShiftsService } from './cash-shifts.service';

/**
 * Кассовая смена / Z-отчёт / Инкассация. PG_POOL is provided globally by
 * DatabaseModule (@Global) — no import needed. Reads checks/expenses for the
 * Z-report aggregation; owns only cash_shifts + cash_collections.
 */
@Module({
  controllers: [CashShiftsController],
  providers: [CashShiftsService],
})
export class CashShiftsModule {}
