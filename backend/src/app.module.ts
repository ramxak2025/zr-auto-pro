import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CarsModule } from './modules/cars/cars.module';
import { ProductsModule } from './modules/products/products.module';
import { ServicesModule } from './modules/services/services.module';
import { ChecksModule } from './modules/checks/checks.module';
import { SalaryModule } from './modules/salary/salary.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { SeedModule } from './modules/seed/seed.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { ScheduleModule } from './modules/schedule/schedule.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    NestScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USERNAME', 'postgres'),
        password: config.get('DB_PASSWORD', 'postgres'),
        database: config.get('DB_NAME', 'zr_auto_pro'),
        autoLoadEntities: true,
        synchronize: true,
        logging: ['error', 'warn', 'schema'],
      }),
    }),
    AuthModule,
    UsersModule,
    ClientsModule,
    CarsModule,
    ProductsModule,
    ServicesModule,
    ChecksModule,
    SalaryModule,
    SuppliersModule,
    ReportsModule,
    TenantsModule,
    UploadsModule,
    SeedModule,
    ShiftsModule,
    ScheduleModule,
  ],
})
export class AppModule {}
