import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { CallsModule } from '../calls/calls.module';

@Module({
  // CallsModule (exports CallsService) is imported so the consolidated
  // /reports/marketing endpoint can reuse the existing call-summary logic
  // (МоиЗвонки live proxy / stored Mango) instead of duplicating it. No
  // circular dependency: CallsModule does not import ReportsModule.
  imports: [CallsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
