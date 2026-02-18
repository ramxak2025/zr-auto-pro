import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScheduleService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, params: any) {
    const where: any = { tenantId };
    if (params?.userId) where.userId = params.userId;
    if (params?.dateFrom && params?.dateTo) {
      where.date = {
        gte: new Date(params.dateFrom),
        lte: new Date(params.dateTo + 'T23:59:59'),
      };
    }

    return this.prisma.scheduleEntry.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, role: true } } },
      orderBy: { date: 'asc' },
    });
  }

  async create(data: any, tenantId: string) {
    return this.prisma.scheduleEntry.create({
      data: {
        userId: data.userId,
        date: new Date(data.date),
        shiftStart: data.shiftStart,
        shiftEnd: data.shiftEnd,
        isDayOff: data.isDayOff || false,
        actualArrival: data.actualArrival,
        lateMinutes: data.lateMinutes || 0,
        lateStatus: data.lateStatus,
        note: data.note,
        isManualOverride: data.isManualOverride || false,
        tenantId,
      },
      include: { user: { select: { id: true, fullName: true, role: true } } },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.scheduleEntry.update({
      where: { id },
      data: {
        shiftStart: data.shiftStart,
        shiftEnd: data.shiftEnd,
        isDayOff: data.isDayOff,
        actualArrival: data.actualArrival,
        lateMinutes: data.lateMinutes,
        lateStatus: data.lateStatus,
        note: data.note,
        isManualOverride: data.isManualOverride,
      },
      include: { user: { select: { id: true, fullName: true, role: true } } },
    });
  }

  async remove(id: string) {
    await this.prisma.scheduleEntry.delete({ where: { id } });
    return { success: true };
  }

  // Work Modes
  async getWorkModes(tenantId: string) {
    return this.prisma.workMode.findMany({ where: { tenantId } });
  }

  async createWorkMode(data: any, tenantId: string) {
    return this.prisma.workMode.create({
      data: {
        name: data.name,
        type: data.type,
        workDays: data.workDays || 0,
        offDays: data.offDays || 0,
        weekDays: data.weekDays || [],
        shiftStart: data.shiftStart,
        shiftEnd: data.shiftEnd,
        tenantId,
      },
    });
  }

  async updateWorkMode(id: string, data: any) {
    return this.prisma.workMode.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
        workDays: data.workDays,
        offDays: data.offDays,
        weekDays: data.weekDays,
        shiftStart: data.shiftStart,
        shiftEnd: data.shiftEnd,
      },
    });
  }

  async getToday(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: ['master', 'admin'] } },
      select: { id: true, fullName: true, role: true },
    });

    const scheduleEntries = await this.prisma.scheduleEntry.findMany({
      where: {
        tenantId,
        date: { gte: todayStart, lt: todayEnd },
      },
    });

    const shifts = await this.prisma.shift.findMany({
      where: {
        tenantId,
        date: { gte: todayStart, lt: todayEnd },
      },
    });

    return users.map((user) => {
      const entry = scheduleEntries.find((e) => e.userId === user.id);
      const shift = shifts.find((s) => s.userId === user.id);

      return {
        userId: user.id,
        fullName: user.fullName,
        role: user.role,
        isDayOff: entry?.isDayOff || false,
        shiftStart: entry?.shiftStart || null,
        shiftEnd: entry?.shiftEnd || null,
        actualArrival: entry?.actualArrival || null,
        lateMinutes: entry?.lateMinutes || 0,
        lateStatus: entry?.lateStatus || null,
        isWorking: !!shift && !shift.closedAt,
        hasSchedule: !!entry,
      };
    });
  }
}
