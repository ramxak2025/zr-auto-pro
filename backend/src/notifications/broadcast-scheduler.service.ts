import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { NotificationsService } from './notifications.service';

/**
 * Scheduled-broadcast worker (096). Every minute it picks up superadmin
 * broadcasts whose `scheduled_at` has come due (and that are not yet sent and
 * not cancelled) and releases them through the SAME delivery path as an
 * immediate broadcast — atomic claim, segment-recipient materialization, push.
 *
 * Gated on RUN_BACKGROUND_JOBS so it fires on exactly ONE replica (the HTTP-only
 * `backend2` sets it false), exactly like the installment-reminder /
 * warehouse-analytics jobs — otherwise a scheduled broadcast could be released
 * twice. The release itself is additionally idempotent (the claim flips sent_at
 * NULL→now() under a WHERE guard), so even a double-tick can't double-send.
 *
 * Cancelling a scheduled broadcast before its time prevents send: the due scan
 * filters `cancelled_at IS NULL` and the claim re-checks it.
 */
@Injectable()
export class BroadcastSchedulerService implements OnModuleInit {
  private readonly logger = new Logger('BroadcastSchedulerService');

  constructor(private notifications: NotificationsService) {}

  onModuleInit() {
    if (!RUN_BACKGROUND_JOBS) {
      this.logger.log('Broadcast scheduler disabled on this replica (RUN_BACKGROUND_JOBS=false)');
    }
  }

  // Every minute — a scheduled broadcast fires within ~60s of its scheduled_at.
  @Cron('* * * * *')
  async handleDueBroadcasts() {
    if (!RUN_BACKGROUND_JOBS) return;
    try {
      await this.notifications.releaseDueBroadcasts();
    } catch (err) {
      this.logger.error(`due-broadcast sweep error: ${err}`);
    }
  }
}
