import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { CallsModule } from '../calls/calls.module';
import { ReportBuilderModule } from './builder/report-builder.module';

@Module({
  // CallsModule (exports CallsService) is imported so the consolidated
  // /reports/marketing endpoint can reuse the existing call-summary logic
  // (МоиЗвонки live proxy / stored Mango) instead of duplicating it. No
  // circular dependency: CallsModule does not import ReportsModule.
  //
  // ReportBuilderModule — конструктор отчётов (GET /reports/builder/*,
  // 2026-09-25): отдельный модуль со своим контроллером, чтобы новые отчёты
  // не трогали reports.service.ts. Регистрируется здесь, а не в app.module,
  // потому что логически это часть раздела «Отчёты».
  imports: [CallsModule, ReportBuilderModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
