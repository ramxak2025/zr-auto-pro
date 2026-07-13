import { Module } from '@nestjs/common';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

@Module({
  controllers: [ScheduleController],
  providers: [ScheduleService],
  // Exported so SalaryService (and reports) can reuse buildShiftFilter — the
  // single source of truth for «что считать отработанной сменой» (schedule
  // settings). v3.0.1 ФИЧА 4 «ЗП за день».
  exports: [ScheduleService],
})
export class ScheduleModule {}
