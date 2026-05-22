import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { ReminderService } from './reminder.service';

@Module({
  controllers: [MarketingController],
  providers: [MarketingService, ReminderService],
})
export class MarketingModule {}
