import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RateRollforwardService } from './rate-rollforward.service';

@Module({
  controllers: [UsersController],
  // RateRollforwardService — ежедневный cron (150): переносит ставки «с
  // будущего месяца» из master_rate_history в users.* когда месяц наступает.
  providers: [UsersService, RateRollforwardService],
  // Exported so other modules can reuse UsersService. (permission-templates,
  // which previously consumed updatePermissions(), was removed in the ROLE-ONLY
  // consolidation 2026-07.)
  exports: [UsersService],
})
export class UsersModule {}
