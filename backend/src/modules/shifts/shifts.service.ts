import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Shift } from './entities/shift.entity';
import { Schedule } from '../schedule/entities/schedule.entity';

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);

  constructor(
    @InjectRepository(Shift)
    private readonly shiftRepo: Repository<Shift>,
    @InjectRepository(Schedule)
    private readonly scheduleRepo: Repository<Schedule>,
  ) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async openShift(tenantId: string, userId: string): Promise<Shift> {
    const date = this.today();

    const existing = await this.shiftRepo.findOne({
      where: { tenantId, userId, date },
    });

    if (existing && !existing.closedAt) {
      throw new BadRequestException('Смена уже открыта');
    }

    if (existing && existing.closedAt) {
      throw new BadRequestException('Смена на сегодня уже была закрыта');
    }

    const now = new Date();

    const shift = this.shiftRepo.create({
      tenantId,
      userId,
      date,
      openedAt: now,
    });

    const savedShift = await this.shiftRepo.save(shift);

    // Update schedule with actual arrival and calculate lateness
    const schedule = await this.scheduleRepo.findOne({
      where: { tenantId, userId, date },
    });

    if (schedule && !schedule.isDayOff) {
      schedule.actualArrival = now;

      // Calculate lateness
      const [h, m] = schedule.shiftStart.split(':').map(Number);
      const scheduledTime = new Date(now);
      scheduledTime.setHours(h, m, 0, 0);

      const diffMs = now.getTime() - scheduledTime.getTime();
      const diffMinutes = Math.floor(diffMs / 60000);

      if (diffMinutes > 0) {
        schedule.lateMinutes = diffMinutes;
        schedule.lateStatus = diffMinutes <= 60 ? 'late_minor' : 'late_major';
      } else {
        schedule.lateMinutes = 0;
        schedule.lateStatus = 'on_time';
      }

      await this.scheduleRepo.save(schedule);
    }

    return (await this.shiftRepo.findOne({
      where: { id: savedShift.id },
      relations: ['user'],
    }))!;
  }

  async closeShift(tenantId: string, userId: string, note?: string): Promise<Shift> {
    const date = this.today();

    const shift = await this.shiftRepo.findOne({
      where: { tenantId, userId, date, closedAt: IsNull() },
    });

    if (!shift) {
      throw new BadRequestException('Нет открытой смены');
    }

    shift.closedAt = new Date();
    if (note) shift.note = note;

    return this.shiftRepo.save(shift);
  }

  async getMyShift(tenantId: string, userId: string): Promise<Shift | null> {
    return this.shiftRepo.findOne({
      where: { tenantId, userId, date: this.today() },
      relations: ['user'],
    });
  }

  async getTodayShifts(tenantId: string): Promise<Shift[]> {
    return this.shiftRepo.find({
      where: { tenantId, date: this.today() },
      relations: ['user'],
      order: { openedAt: 'ASC' },
    });
  }

  /** Auto-close all open shifts at 23:59 */
  @Cron('59 23 * * *')
  async autoCloseShifts() {
    this.logger.log('Auto-closing open shifts...');
    const date = this.today();

    const openShifts = await this.shiftRepo.find({
      where: { date, closedAt: IsNull() },
    });

    for (const shift of openShifts) {
      shift.closedAt = new Date();
      shift.isAutoClosed = true;
      shift.note = (shift.note ? shift.note + ' | ' : '') + 'Автозакрытие в 23:59';
      await this.shiftRepo.save(shift);
    }

    if (openShifts.length > 0) {
      this.logger.log(`Auto-closed ${openShifts.length} shifts`);
    }
  }

  async getShiftHistory(
    tenantId: string,
    query: { userId?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number },
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.shiftRepo.createQueryBuilder('shift');
    qb.leftJoinAndSelect('shift.user', 'user');
    qb.where('shift.tenantId = :tenantId', { tenantId });

    if (query.userId) {
      qb.andWhere('shift.userId = :userId', { userId: query.userId });
    }
    if (query.dateFrom) {
      qb.andWhere('shift.date >= :dateFrom', { dateFrom: query.dateFrom });
    }
    if (query.dateTo) {
      qb.andWhere('shift.date <= :dateTo', { dateTo: query.dateTo });
    }

    qb.orderBy('shift.date', 'DESC').addOrderBy('shift.openedAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }
}
