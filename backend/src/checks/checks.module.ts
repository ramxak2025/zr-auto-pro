import { Module } from '@nestjs/common';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';

@Module({
  controllers: [ChecksController],
  providers: [ChecksService],
  exports: [ChecksService],
})
export class ChecksModule {}
