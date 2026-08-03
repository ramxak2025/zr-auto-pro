import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RUN_BACKGROUND_JOBS } from '../common/run-jobs';
import { UsersService } from './users.service';

/**
 * Round 14 (150) — ежедневный cron переноса ставок «с будущего месяца».
 * Владелец назначает мастеру процент «с сентября» (master_rate_history);
 * запекание НОВЫХ чеков читает users.salary_percent / product_salary_percent,
 * поэтому в первый день назначенного месяца users.* надо синхронизировать с
 * effective-процентом истории — это делает UsersService.rollForwardDueRates()
 * (идемпотентен: расхождений нет → no-op; заодно доводит чеки первых часов
 * месяца, запечённые старой ставкой).
 *
 * 03:30 МСК ежедневно (не только 1-го числа — самолечение после даунтайма в
 * ночь смены месяца). Gated on RUN_BACKGROUND_JOBS — ровно одна реплика, как
 * остальные cron-джобы (installments / review / shift-auto-close).
 */
@Injectable()
export class RateRollforwardService implements OnModuleInit {
  private readonly logger = new Logger('RateRollforwardService');

  constructor(private users: UsersService) {}

  onModuleInit() {
    if (!RUN_BACKGROUND_JOBS) {
      this.logger.log('Rate roll-forward cron disabled on this replica (RUN_BACKGROUND_JOBS=false)');
    }
  }

  @Cron('30 3 * * *', { timeZone: 'Europe/Moscow' })
  async handleDailyRollforward() {
    if (!RUN_BACKGROUND_JOBS) return;
    try {
      const applied = await this.users.rollForwardDueRates();
      if (applied > 0) this.logger.log(`Rate roll-forward applied for ${applied} user(s)`);
    } catch (err) {
      this.logger.error(`Rate roll-forward sweep error: ${err}`);
    }
  }
}
