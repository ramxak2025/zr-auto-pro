import { Module } from '@nestjs/common';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';
import { WarrantyModule } from '../warranty/warranty.module';
import { PushModule } from '../push/push.module';
import { MarketingModule } from '../marketing/marketing.module';
import { InstallmentsModule } from '../installments/installments.module';

@Module({
  // MarketingModule exports MarketingService — reused (not reimplemented) for the
  // «машина готова» auto-notification fired from setWorkStatus. No cycle:
  // MarketingModule does not import ChecksModule.
  //
  // InstallmentsModule exports InstallmentsService — reused so a check sold with
  // paymentMethod 'installment' creates its installment plan INSIDE the
  // check-create transaction. No cycle: InstallmentsModule does NOT import
  // ChecksModule.
  imports: [WarrantyModule, PushModule, MarketingModule, InstallmentsModule],
  controllers: [ChecksController],
  providers: [ChecksService],
})
export class ChecksModule {}
