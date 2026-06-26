import { Module } from '@nestjs/common';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';
import { WarrantyModule } from '../warranty/warranty.module';
import { PushModule } from '../push/push.module';
import { MarketingModule } from '../marketing/marketing.module';

@Module({
  // MarketingModule exports MarketingService — reused (not reimplemented) for the
  // «машина готова» auto-notification fired from setWorkStatus. No cycle:
  // MarketingModule does not import ChecksModule.
  imports: [WarrantyModule, PushModule, MarketingModule],
  controllers: [ChecksController],
  providers: [ChecksService],
})
export class ChecksModule {}
