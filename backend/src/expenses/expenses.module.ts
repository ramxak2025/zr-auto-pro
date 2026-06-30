import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
  // Exported so SalaryService can record the «Зарплата» expense on payout
  // accept through the expenses service (instead of hand-rolling SQL).
  exports: [ExpensesService],
})
export class ExpensesModule {}
