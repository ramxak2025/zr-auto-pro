import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ScheduleEntry } from './schedule-entry.entity';
import { WorkMode } from './work-mode.entity';
import { UsersService } from '../users/users.service';

export interface TodayEmployeeStatus {
  userId: string;
  fullName: string;
  isScheduled: boolean;
  isDayOff: boolean;
  shiftStart: string | null;
  shiftEnd: string | null;
  actualArrival: string | null;
  lateMinutes: number;
  lateStatus: string | null;
  note: string | null;
}

@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(ScheduleEntry)
    private readonly scheduleRepo: Repository<ScheduleEntry>,

    @InjectRepository(WorkMode)
    private readonly workModeRepo: Repository<WorkMode>,

    private readonly usersService: UsersService,
  ) {}

  async getSchedule(
    tenantId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<ScheduleEntry[]> {
    return this.scheduleRepo.find({
      where: {
        tenantId,
        date: Between(dateFrom, dateTo),
      },
      relations: ['user'],
      order: { date: 'ASC', userId: 'ASC' },
    });
  }

  async createEntry(dto: Partial<ScheduleEntry>): Promise<ScheduleEntry> {
    const entry = this.scheduleRepo.create(dto);
    return this.scheduleRepo.save(entry);
  }

  async updateEntry(
    id: string,
    dto: Partial<ScheduleEntry>,
  ): Promise<ScheduleEntry> {
    const entry = await this.scheduleRepo.findOne({ where: { id } });
    if (!entry) {
      throw new NotFoundException(`Schedule entry with id "${id}" not found`);
    }
    Object.assign(entry, dto);
    return this.scheduleRepo.save(entry);
  }

  async deleteEntry(id: string): Promise<void> {
    const result = await this.scheduleRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Schedule entry with id "${id}" not found`);
    }
  }

  async getWorkModes(tenantId: string): Promise<WorkMode[]> {
    return this.workModeRepo.find({ where: { tenantId } });
  }

  async createWorkMode(dto: Partial<WorkMode>): Promise<WorkMode> {
    const workMode = this.workModeRepo.create(dto);
    return this.workModeRepo.save(workMode);
  }

  async updateWorkMode(
    id: string,
    dto: Partial<WorkMode>,
  ): Promise<WorkMode> {
    const workMode = await this.workModeRepo.findOne({ where: { id } });
    if (!workMode) {
      throw new NotFoundException(`Work mode with id "${id}" not found`);
    }
    Object.assign(workMode, dto);
    return this.workModeRepo.save(workMode);
  }

  async getTodayStatus(tenantId: string): Promise<TodayEmployeeStatus[]> {
    const todayStr = new Date().toISOString().split('T')[0];
    const masters = await this.usersService.findMasters(tenantId);

    const todayEntries = await this.scheduleRepo.find({
      where: { tenantId, date: todayStr },
    });

    const entryByUserId: Record<string, ScheduleEntry> = {};
    for (const entry of todayEntries) {
      entryByUserId[entry.userId] = entry;
    }

    return masters.map((master) => {
      const entry = entryByUserId[master.id];
      return {
        userId: master.id,
        fullName: master.fullName,
        isScheduled: !!entry,
        isDayOff: entry ? entry.isDayOff : false,
        shiftStart: entry ? entry.shiftStart : null,
        shiftEnd: entry ? entry.shiftEnd : null,
        actualArrival: entry ? entry.actualArrival : null,
        lateMinutes: entry ? entry.lateMinutes : 0,
        lateStatus: entry ? entry.lateStatus : null,
        note: entry ? entry.note : null,
      };
    });
  }
}
