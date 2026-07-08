import { Module } from '@nestjs/common';
import { RegistrationController, AdminRegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { RegistrationRateLimitGuard } from './registration-rate-limit.guard';
import { TenantsModule } from '../tenants/tenants.module';

/**
 * Self-service registration requests (migration 123).
 *
 * TenantsModule is imported for its exported TenantsService (reused on approve to
 * create the tenant + owner with the PRE-HASHED password + free trial) and
 * AuditService (approve/reject audit trail). RegistrationRateLimitGuard is a
 * provider so it is a single shared singleton (its in-memory fallback Map is
 * process-wide).
 */
@Module({
  imports: [TenantsModule],
  controllers: [RegistrationController, AdminRegistrationController],
  providers: [RegistrationService, RegistrationRateLimitGuard],
})
export class RegistrationModule {}
