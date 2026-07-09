import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  // Exported so other modules can reuse UsersService. (permission-templates,
  // which previously consumed updatePermissions(), was removed in the ROLE-ONLY
  // consolidation 2026-07.)
  exports: [UsersService],
})
export class UsersModule {}
