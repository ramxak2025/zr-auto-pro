import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { ReminderService } from './reminder.service';

@Module({
  controllers: [MarketingController],
  providers: [MarketingService, ReminderService],
  // Exported so other modules (e.g. BookingsModule) can reuse the messaging
  // adapter via MarketingService.sendClientMessage without duplicating the
  // provider-strategy logic.
  exports: [MarketingService],
})
export class MarketingModule {}
