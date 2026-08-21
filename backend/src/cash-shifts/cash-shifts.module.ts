import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { CashShiftsController } from './cash-shifts.controller';
import { CashShiftsService } from './cash-shifts.service';

/**
 * Кассовая смена / Z-отчёт / Инкассация / Сейф (155). PG_POOL is provided
 * globally by DatabaseModule (@Global) — no import needed. Reads
 * checks/expenses for the Z-report aggregation; owns cash_shifts,
 * cash_collections, safe_transactions и cash_shift_settlements. PushModule —
 * пуши 'cash_shift_closed' / 'cash_collection'.
 */
@Module({
  imports: [PushModule],
  controllers: [CashShiftsController],
  providers: [CashShiftsService],
})
export class CashShiftsModule {}
