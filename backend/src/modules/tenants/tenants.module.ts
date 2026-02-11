import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { TenantsSeedService } from './tenants-seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, User])],
  providers: [TenantsService, TenantsSeedService],
  controllers: [TenantsController],
  exports: [TenantsService],
})
export class TenantsModule {}
