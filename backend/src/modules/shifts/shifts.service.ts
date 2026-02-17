import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift } from './shift.entity';

@Injectable()
export class ShiftsService {
  constructor(
    @InjectRepository(Shift)
    private readonly shiftsRepo: Repository<Shift>,
  ) {}

  async findAll(tenantId: string, date?: string): Promise<Shift[]> {
    const where: any = { tenantId };
    if (date) {
      where.date = date;
    }

    return this.shiftsRepo.find({
      where,
      relations: ['user'],
      order: { date: 'DESC' },
    });
  }

  async openShift(
    tenantId: string,
    userId: string,
    note?: string,
  ): Promise<Shift> {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const shift = this.shiftsRepo.create({
      tenantId,
      userId,
      date: todayStr,
      openedAt: now,
      note: note || undefined,
    });

    return this.shiftsRepo.save(shift);
  }

  async closeShift(id: string): Promise<Shift> {
    const shift = await this.shiftsRepo.findOne({ where: { id } });
    if (!shift) {
      throw new NotFoundException(`Shift with id "${id}" not found`);
    }

    shift.closedAt = new Date();
    return this.shiftsRepo.save(shift);
  }

  async getMyShift(userId: string, date: string): Promise<Shift | null> {
    return this.shiftsRepo.findOne({
      where: { userId, date },
      relations: ['user'],
    });
  }
}
