import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SeedService } from './seed.service';

@Module({
  imports: [UsersModule, TenantsModule],
  providers: [SeedService],
})
export class SeedModule {}
