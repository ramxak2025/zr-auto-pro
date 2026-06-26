import { Module } from '@nestjs/common';
import { TenantsController, AdminAuditController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { AuditService } from './audit.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule re-exports the configured JwtModule, so TenantsService can inject
  // the SAME JwtService (same secret/config) that AuthService uses to mint
  // login tokens — required for impersonation tokens to validate identically.
  imports: [AuthModule],
  controllers: [TenantsController, AdminAuditController],
  providers: [TenantsService, AuditService],
  // AuditService is exported so NotificationsModule can audit-log broadcast
  // cancels through the SAME append-only admin_audit_log writer.
  exports: [AuditService],
})
export class TenantsModule {}
