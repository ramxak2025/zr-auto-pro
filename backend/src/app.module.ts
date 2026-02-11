import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'frontend', 'dist'),
      exclude: ['/api/(.*)'],
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
  ],
})
export class AppModule {}
