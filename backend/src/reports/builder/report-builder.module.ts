import { Module } from '@nestjs/common';
import { SalaryModule } from '../../salary/salary.module';
import { ReportBuilderController } from './report-builder.controller';
import { ReportBuilderService } from './report-builder.service';
import { SummaryBuilder } from './builders/summary.builder';
import { MastersBuilder } from './builders/masters.builder';
import { SalaryBuilder } from './builders/salary.builder';
import { SuppliersBuilder } from './builders/suppliers.builder';
import { ClientsBuilder } from './builders/clients.builder';
import { ProductsBuilder } from './builders/products.builder';
import { ServicesBuilder } from './builders/services.builder';
import { PaymentsBuilder } from './builders/payments.builder';
import { ExpensesBuilder } from './builders/expenses.builder';
import { BookingsBuilder } from './builders/bookings.builder';
import { PointsBuilder } from './builders/points.builder';

/**
 * Конструктор отчётов (раздел «Отчёты», 2026-09-25). Отдельный модуль внутри
 * reports/, чтобы не пересекаться с reports.service.ts: новый отчёт = новый
 * билдер в providers + строка в shared/reports/catalog.ts (и его зеркале).
 *
 * SalaryModule импортируется ради SalaryService: отчёт «По зарплатам» берёт
 * начисления тем же расчётом, что экран «Зарплата», а не переписывает
 * формулу процента. Цикла нет: SalaryModule отчёты не импортирует.
 */
@Module({
  imports: [SalaryModule],
  controllers: [ReportBuilderController],
  providers: [
    ReportBuilderService,
    SummaryBuilder,
    MastersBuilder,
    SalaryBuilder,
    SuppliersBuilder,
    ClientsBuilder,
    ProductsBuilder,
    ServicesBuilder,
    PaymentsBuilder,
    ExpensesBuilder,
    BookingsBuilder,
    PointsBuilder,
  ],
})
export class ReportBuilderModule {}
