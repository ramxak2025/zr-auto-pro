import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  // Exported so PermissionTemplatesModule can reuse updatePermissions() (the
  // self-lockout-protected apply path) instead of duplicating the guard.
  exports: [UsersService],
})
export class UsersModule {}
