import { Module } from '@nestjs/common';
import { MarketingModule } from '../marketing/marketing.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingReminderService } from './booking-reminder.service';

@Module({
  // MarketingModule exports MarketingService (messaging adapter reuse).
  // PushService is provided globally by PushModule (@Global) — no import needed.
  imports: [MarketingModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingReminderService],
})
export class BookingsModule {}
