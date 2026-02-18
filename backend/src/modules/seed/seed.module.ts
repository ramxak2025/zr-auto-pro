import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SeedService } from './seed.service';
import { User } from '../users/user.entity';

@Module({
  imports: [UsersModule, TenantsModule, TypeOrmModule.forFeature([User])],
  providers: [SeedService],
})
export class SeedModule {}
