import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { ClientsModule } from './clients/clients.module';
import { CarsModule } from './cars/cars.module';
import { ServicesModule } from './services/services.module';
import { ProductsModule } from './products/products.module';
import { ChecksModule } from './checks/checks.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { SalaryModule } from './salary/salary.module';
import { ShiftsModule } from './shifts/shifts.module';
import { ScheduleModule } from './schedule/schedule.module';
import { ReportsModule } from './reports/reports.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/api/uploads',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    ClientsModule,
    CarsModule,
    ServicesModule,
    ProductsModule,
    ChecksModule,
    SuppliersModule,
    SalaryModule,
    ShiftsModule,
    ScheduleModule,
    ReportsModule,
    UploadsModule,
  ],
})
export class AppModule {}
