import { Module } from '@nestjs/common';
import { SalaryController } from './salary.controller';
import { SalaryService } from './salary.service';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  // ExpensesModule provides ExpensesService — SalaryService records the
  // «Зарплата» expense through it when a payout is accepted. PushService is
  // injected from the global PushModule.
  imports: [ExpensesModule],
  controllers: [SalaryController],
  providers: [SalaryService],
})
export class SalaryModule {}
