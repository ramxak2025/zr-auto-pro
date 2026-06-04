import { Module } from '@nestjs/common';
import { NotificationsController, AdminBroadcastController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// PushService comes from the @Global PushModule (push/push.module.ts), so it's
// injectable in NotificationsService without importing PushModule here. Used to
// fan out superadmin broadcasts via the always-deliver path.
@Module({
  controllers: [NotificationsController, AdminBroadcastController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
