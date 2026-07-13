import { Module } from '@nestjs/common';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database.module';
import { MigrationRunner } from './migration-runner';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { PlansModule } from './plans/plans.module';
import { ClientsModule } from './clients/clients.module';
import { CarsModule } from './cars/cars.module';
import { ServicesModule } from './services/services.module';
import { ProductsModule } from './products/products.module';
import { ChecksModule } from './checks/checks.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { SalaryModule } from './salary/salary.module';
import { ReportsModule } from './reports/reports.module';
import { ShiftsModule } from './shifts/shifts.module';
import { ScheduleModule } from './schedule/schedule.module';
import { UploadsModule } from './uploads/uploads.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { HealthModule } from './health/health.module';
import { ExpensesModule } from './expenses/expenses.module';
import { MarketingModule } from './marketing/marketing.module';
import { CallsModule } from './calls/calls.module';
import { EquipmentModule } from './equipment/equipment.module';
import { ImportsModule } from './imports/imports.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { WarrantyModule } from './warranty/warranty.module';
import { StockMovementsModule } from './stock-movements/stock-movements.module';
import { PushModule } from './push/push.module';
import { CheckPhotosModule } from './check-photos/check-photos.module';
import { CheckTemplatesModule } from './check-templates/check-templates.module';
import { ReturnsModule } from './returns/returns.module';
import { EmployeesModule } from './employees/employees.module';
import { WarehouseAnalyticsModule } from './warehouse-analytics/warehouse-analytics.module';
import { ClientSourcesModule } from './client-sources/client-sources.module';
import { JournalModule } from './journal/journal.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BookingsModule } from './bookings/bookings.module';
import { RolesModule } from './roles/roles.module';
import { CashShiftsModule } from './cash-shifts/cash-shifts.module';
import { DebtsModule } from './debts/debts.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { PaymentsModule } from './payments/payments.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { TelephonyModule } from './telephony/telephony.module';
import { WalletModule } from './wallet/wallet.module';
import { InstallmentsModule } from './installments/installments.module';
import { AccountModule } from './account/account.module';
import { MotivationModule } from './motivation/motivation.module';
import { ProfileModule } from './profile/profile.module';
import { VoiceModule } from './voice/voice.module';
import { SettingsModule } from './settings/settings.module';
import { RegistrationModule } from './registration/registration.module';
import { PlanningModule } from './planning/planning.module';

@Module({
  imports: [
    NestScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    PlansModule,
    ClientsModule,
    CarsModule,
    ServicesModule,
    ProductsModule,
    ChecksModule,
    SuppliersModule,
    SalaryModule,
    ReportsModule,
    ShiftsModule,
    ScheduleModule,
    UploadsModule,
    WarehouseModule,
    WarehousesModule,
    WarrantyModule,
    StockMovementsModule,
    HealthModule,
    ExpensesModule,
    MarketingModule,
    CallsModule,
    EquipmentModule,
    ImportsModule,
    PushModule,
    CheckPhotosModule,
    CheckTemplatesModule,
    ReturnsModule,
    EmployeesModule,
    WarehouseAnalyticsModule,
    ClientSourcesModule,
    JournalModule,
    KnowledgeModule,
    NotificationsModule,
    BookingsModule,
    RolesModule,
    CashShiftsModule,
    DebtsModule,
    LoyaltyModule,
    PurchaseOrdersModule,
    PaymentsModule,
    FiscalModule,
    TelephonyModule,
    WalletModule,
    InstallmentsModule,
    AccountModule,
    MotivationModule,
    ProfileModule,
    VoiceModule,
    SettingsModule,
    RegistrationModule,
    PlanningModule,
  ],
  providers: [MigrationRunner],
})
export class AppModule {}
