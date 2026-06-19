import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PermissionTemplatesController } from './permission-templates.controller';
import { PermissionTemplatesService } from './permission-templates.service';

@Module({
  // UsersModule exports UsersService — reused by the apply path so the
  // self-lockout guard is not duplicated.
  imports: [UsersModule],
  controllers: [PermissionTemplatesController],
  providers: [PermissionTemplatesService],
})
export class PermissionTemplatesModule {}
