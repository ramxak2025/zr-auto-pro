import { Module } from '@nestjs/common';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';
import { WarrantyModule } from '../warranty/warranty.module';
import { PushModule } from '../push/push.module';
import { MarketingModule } from '../marketing/marketing.module';
import { InstallmentsModule } from '../installments/installments.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ClientsModule } from '../clients/clients.module';

@Module({
  // MarketingModule exports MarketingService — reused (not reimplemented) for the
  // «машина готова» auto-notification fired from setWorkStatus. No cycle:
  // MarketingModule does not import ChecksModule.
  //
  // InstallmentsModule exports InstallmentsService — reused so a check sold with
  // paymentMethod 'installment' creates its installment plan INSIDE the
  // check-create transaction. No cycle: InstallmentsModule does NOT import
  // ChecksModule.
  //
  // TenantsModule exports AuditService — reused (same pattern as
  // NotificationsModule) so the closed-check money edit (#61) appends a
  // transactional row to admin_audit_log. No cycle: TenantsModule imports only
  // AuthModule and does NOT import ChecksModule.
  //
  // ClientsModule exports ClientsService — переиспользуется (не переписывается)
  // предикат «клиент виден на моём филиале» (161): журнал при ?clientId/?carId
  // снимает фильтр филиала ради истории клиента и обязан спрашивать о
  // видимости ТЕМ ЖЕ кодом, что список клиентов и гараж. Цикла нет:
  // ClientsModule не импортирует ничего.
  imports: [WarrantyModule, PushModule, MarketingModule, InstallmentsModule, TenantsModule, ClientsModule],
  controllers: [ChecksController],
  providers: [ChecksService],
})
export class ChecksModule {}
