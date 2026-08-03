import { Module } from '@nestjs/common';
import { SalaryController } from './salary.controller';
import { SalaryService } from './salary.service';
import { ExpensesModule } from '../expenses/expenses.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  // ExpensesModule provides ExpensesService — SalaryService records the
  // «Зарплата» expense through it when a payout is accepted. PushService is
  // injected from the global PushModule. ScheduleModule provides ScheduleService
  // (buildShiftFilter) for the «ЗП за день» = earned / worked-shifts calc
  // (v3.0.1 ФИЧА 4). No circular dep: ScheduleModule imports neither.
  //
  // TenantsModule exports AuditService — Round 15 (153): транзакционный аудит
  // денежных корректировок (отмена выплаты / сторно / правка штрафа), тот же
  // паттерн, что ChecksModule для editClosedCheck. No cycle: TenantsModule
  // imports only AuthModule.
  imports: [ExpensesModule, ScheduleModule, TenantsModule],
  controllers: [SalaryController],
  providers: [SalaryService],
})
export class SalaryModule {}
