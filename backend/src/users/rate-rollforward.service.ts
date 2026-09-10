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
 *
 * ПОЧЕМУ ЧАС КРОНА ОСТАЛСЯ МОСКОВСКИМ, хотя «текущий месяц» теперь считается
 * в поясе КАЖДОГО тенанта (UsersService.rollForwardDueRates). В 03:30 МСК это
 * 00:30 UTC, а у всех российских поясов (МСК−1 … МСК+9) в этот момент уже
 * наступило то же самое календарное число — значит 1-е число у каждого тенанта
 * уже началось, и перенос применяется в его первый день. Дробить джоб по часам,
 * как shift-auto-close, смысла нет: он идемпотентен и самолечится ежедневно, а
 * лишние пробуждения только гоняли бы полный свип истории ставок.
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
