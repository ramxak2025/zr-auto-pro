import { Module } from '@nestjs/common';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';
import { WarrantyModule } from '../warranty/warranty.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [WarrantyModule, PushModule],
  controllers: [ChecksController],
  providers: [ChecksService],
})
export class ChecksModule {}
