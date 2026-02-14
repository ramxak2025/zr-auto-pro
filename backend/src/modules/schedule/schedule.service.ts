import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Schedule, LateStatus } from './entities/schedule.entity';
import { WorkMode } from './entities/work-mode.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    @InjectRepository(Schedule)
    private readonly scheduleRepo: Repository<Schedule>,
    @InjectRepository(WorkMode)
    private readonly workModeRepo: Repository<WorkMode>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ─── Work Modes ─────────────────────────────────────────────

  async getWorkModes(tenantId: string): Promise<WorkMode[]> {
    return this.workModeRepo.find({
      where: { tenantId },
      order: { name: 'ASC' },
    });
  }

  async createWorkMode(tenantId: string, dto: Partial<WorkMode>): Promise<WorkMode> {
    const mode = this.workModeRepo.create({ ...dto, tenantId });
    return this.workModeRepo.save(mode);
  }

  async updateWorkMode(tenantId: string, id: string, dto: Partial<WorkMode>): Promise<WorkMode> {
    const mode = await this.workModeRepo.findOne({ where: { id, tenantId } });
    if (!mode) throw new NotFoundException('Режим работы не найден');
    Object.assign(mode, dto);
    return this.workModeRepo.save(mode);
  }

  async deleteWorkMode(tenantId: string, id: string): Promise<void> {
    const mode = await this.workModeRepo.findOne({ where: { id, tenantId } });
    if (!mode) throw new NotFoundException('Режим работы не найден');
    await this.workModeRepo.remove(mode);
  }

  // ─── Schedule Generation ────────────────────────────────────

  async generateSchedule(
    tenantId: string,
    userId: string,
    workModeId: string,
    dateFrom: string,
    dateTo: string,
    startOffset = 0,
  ): Promise<Schedule[]> {
    const mode = await this.workModeRepo.findOne({ where: { id: workModeId, tenantId } });
    if (!mode) throw new NotFoundException('Режим работы не найден');

    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Сотрудник не найден');

    const entries: Schedule[] = [];
    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    let dayIndex = startOffset;

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);

      let isDayOff = false;

      if (mode.type === 'weekly') {
        const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay();
        isDayOff = !mode.weekDays.includes(dayOfWeek);
      } else {
        // Rotating schedule
        const cycleLength = mode.workDays + mode.offDays;
        const posInCycle = dayIndex % cycleLength;
        isDayOff = posInCycle >= mode.workDays;
        dayIndex++;
      }

      // Check if entry already exists
      const existing = await this.scheduleRepo.findOne({
        where: { tenantId, userId, date: dateStr },
      });

      if (existing) {
        // Don't overwrite manual overrides
        if (!existing.isManualOverride) {
          existing.isDayOff = isDayOff;
          existing.shiftStart = mode.shiftStart;
          existing.shiftEnd = mode.shiftEnd;
          entries.push(await this.scheduleRepo.save(existing));
        } else {
          entries.push(existing);
        }
      } else {
        const entry = this.scheduleRepo.create({
          tenantId,
          userId,
          date: dateStr,
          shiftStart: mode.shiftStart,
          shiftEnd: mode.shiftEnd,
          isDayOff,
        });
        entries.push(await this.scheduleRepo.save(entry));
      }
    }

    return entries;
  }

  // ─── Schedule CRUD ──────────────────────────────────────────

  async getSchedule(
    tenantId: string,
    dateFrom: string,
    dateTo: string,
    userId?: string,
  ): Promise<Schedule[]> {
    const qb = this.scheduleRepo.createQueryBuilder('schedule');
    qb.leftJoinAndSelect('schedule.user', 'user');
    qb.where('schedule.tenantId = :tenantId', { tenantId });
    qb.andWhere('schedule.date >= :dateFrom', { dateFrom });
    qb.andWhere('schedule.date <= :dateTo', { dateTo });

    if (userId) {
      qb.andWhere('schedule.userId = :userId', { userId });
    }

    qb.orderBy('user.fullName', 'ASC').addOrderBy('schedule.date', 'ASC');

    return qb.getMany();
  }

  async updateScheduleEntry(
    tenantId: string,
    id: string,
    dto: {
      isDayOff?: boolean;
      shiftStart?: string;
      shiftEnd?: string;
      lateStatus?: LateStatus;
      lateMinutes?: number;
      note?: string;
    },
  ): Promise<Schedule> {
    const entry = await this.scheduleRepo.findOne({
      where: { id, tenantId },
      relations: ['user'],
    });
    if (!entry) throw new NotFoundException('Запись графика не найдена');

    Object.assign(entry, dto);
    entry.isManualOverride = true;

    return this.scheduleRepo.save(entry);
  }

  async createScheduleEntry(
    tenantId: string,
    dto: {
      userId: string;
      date: string;
      isDayOff?: boolean;
      shiftStart?: string;
      shiftEnd?: string;
      note?: string;
    },
  ): Promise<Schedule> {
    const existing = await this.scheduleRepo.findOne({
      where: { tenantId, userId: dto.userId, date: dto.date },
    });

    if (existing) {
      Object.assign(existing, dto);
      existing.isManualOverride = true;
      return this.scheduleRepo.save(existing);
    }

    const entry = this.scheduleRepo.create({
      ...dto,
      tenantId,
      isManualOverride: true,
    });
    return this.scheduleRepo.save(entry);
  }

  // ─── Dashboard Status ───────────────────────────────────────

  async getTodayStatus(tenantId: string) {
    const today = new Date().toISOString().slice(0, 10);

    // Get all active users for this tenant
    const users = await this.userRepo.find({
      where: { tenantId, isActive: true },
      order: { fullName: 'ASC' },
    });

    // Get today's schedules
    const schedules = await this.scheduleRepo.find({
      where: { tenantId, date: today },
    });

    const scheduleMap = new Map<string, Schedule>();
    for (const s of schedules) {
      scheduleMap.set(s.userId, s);
    }

    const result = users
      .filter((u) => u.role !== 'superadmin')
      .map((user) => {
        const schedule = scheduleMap.get(user.id);
        return {
          userId: user.id,
          fullName: user.fullName,
          role: user.role,
          isDayOff: schedule?.isDayOff ?? false,
          shiftStart: schedule?.shiftStart ?? null,
          shiftEnd: schedule?.shiftEnd ?? null,
          actualArrival: schedule?.actualArrival ?? null,
          lateMinutes: schedule?.lateMinutes ?? 0,
          lateStatus: schedule?.lateStatus ?? null,
          isWorking: !!schedule?.actualArrival && !schedule?.isDayOff,
          hasSchedule: !!schedule,
        };
      });

    return result;
  }
}
