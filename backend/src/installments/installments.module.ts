import { Module } from '@nestjs/common';
import { InstallmentsController } from './installments.controller';
import { InstallmentsService } from './installments.service';
import { InstallmentsReminderService } from './installments-reminder.service';
import { MarketingModule } from '../marketing/marketing.module';

/**
 * Рассрочка (installments). PG_POOL is provided globally by DatabaseModule.
 *
 * Imports MarketingModule to reuse MarketingService.sendClientMessage for the
 * reminder flow (no new send logic). Exports InstallmentsService so ChecksModule
 * can create the plan INSIDE the check-create transaction
 * (createPlanForCheckTx). No cycle: this module does NOT import ChecksModule.
 */
@Module({
  imports: [MarketingModule],
  controllers: [InstallmentsController],
  providers: [InstallmentsService, InstallmentsReminderService],
  exports: [InstallmentsService],
})
export class InstallmentsModule {}
