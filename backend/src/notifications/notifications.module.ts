import { Module } from '@nestjs/common';
import { NotificationsController, AdminBroadcastController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { BroadcastSchedulerService } from './broadcast-scheduler.service';
import { TenantsModule } from '../tenants/tenants.module';

// PushService comes from the @Global PushModule (push/push.module.ts), so it's
// injectable in NotificationsService without importing PushModule here. Used to
// fan out superadmin broadcasts via the always-deliver path.
//
// TenantsModule is imported for its exported AuditService, so broadcast cancels
// land in the same admin_audit_log trail as the other superadmin actions.
@Module({
  imports: [TenantsModule],
  controllers: [NotificationsController, AdminBroadcastController],
  providers: [NotificationsService, BroadcastSchedulerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
