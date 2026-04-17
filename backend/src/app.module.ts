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
    HealthModule,
    ExpensesModule,
    MarketingModule,
    CallsModule,
    EquipmentModule,
  ],
  providers: [MigrationRunner],
})
export class AppModule {}
