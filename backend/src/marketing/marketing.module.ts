import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { ReminderService } from './reminder.service';
import { ClientsModule } from '../clients/clients.module';

@Module({
  // ClientsModule — ради ClientsService.separatePointFor / separatePointWhere
  // (161): рассылка обязана резаться теми же границами филиала, что и база
  // клиентов, иначе SMS становятся способом дотянуться до чужой базы.
  imports: [ClientsModule],
  controllers: [MarketingController],
  providers: [MarketingService, ReminderService],
  // Exported so other modules (e.g. BookingsModule) can reuse the messaging
  // adapter via MarketingService.sendClientMessage without duplicating the
  // provider-strategy logic.
  exports: [MarketingService],
})
export class MarketingModule {}
