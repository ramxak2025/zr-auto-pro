import { Module } from '@nestjs/common';
import { MarketingModule } from '../marketing/marketing.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingReminderService } from './booking-reminder.service';
import { PublicBookingsService } from './public-bookings.service';
import { PublicBookingsController, BookingPublicationController } from './public-bookings.controller';

@Module({
  // MarketingModule exports MarketingService (messaging adapter reuse).
  // PushService is provided globally by PushModule (@Global) — no import needed.
  imports: [MarketingModule],
  controllers: [BookingPublicationController, BookingsController, PublicBookingsController],
  providers: [BookingsService, BookingReminderService, PublicBookingsService],
})
export class BookingsModule {}
