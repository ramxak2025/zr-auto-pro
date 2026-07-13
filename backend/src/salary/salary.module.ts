import { Module } from '@nestjs/common';
import { SalaryController } from './salary.controller';
import { SalaryService } from './salary.service';
import { ExpensesModule } from '../expenses/expenses.module';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  // ExpensesModule provides ExpensesService — SalaryService records the
  // «Зарплата» expense through it when a payout is accepted. PushService is
  // injected from the global PushModule. ScheduleModule provides ScheduleService
  // (buildShiftFilter) for the «ЗП за день» = earned / worked-shifts calc
  // (v3.0.1 ФИЧА 4). No circular dep: ScheduleModule imports neither.
  imports: [ExpensesModule, ScheduleModule],
  controllers: [SalaryController],
  providers: [SalaryService],
})
export class SalaryModule {}
