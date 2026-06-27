import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { TenantsModule } from '../tenants/tenants.module';

/**
 * Self-service account deletion (Apple 5.1.1(v) / Google Play).
 *
 * - PG_POOL is provided globally (DatabaseModule) and PushService globally
 *   (PushModule @Global), so neither needs importing here.
 * - TenantsModule is imported for TenantsService, whose authoritative cascade
 *   the grace-period purge cron reuses (single source of truth for tenant
 *   teardown).
 */
@Module({
  imports: [TenantsModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
