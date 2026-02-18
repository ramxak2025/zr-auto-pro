import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.userId) where.userId = params.userId;
    if (params?.date) where.date = { gte: new Date(params.date), lte: new Date(params.date + 'T23:59:59') };

    return this.prisma.shift.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, role: true } } },
      orderBy: { openedAt: 'desc' },
    });
  }

  async getMy(userId: string) {
    return this.prisma.shift.findMany({
      where: { userId },
      include: { user: { select: { id: true, fullName: true, role: true } } },
      orderBy: { openedAt: 'desc' },
      take: 30,
    });
  }

  async open(userId: string, tenantId: string, data?: any) {
    // Check if already has open shift
    const openShift = await this.prisma.shift.findFirst({
      where: { userId, closedAt: null },
    });
    if (openShift) {
      throw new BadRequestException('У вас уже есть открытая смена');
    }

    return this.prisma.shift.create({
      data: {
        userId,
        tenantId,
        date: new Date(),
        openedAt: new Date(),
        note: data?.note,
      },
      include: { user: { select: { id: true, fullName: true, role: true } } },
    });
  }

  async close(id: string) {
    return this.prisma.shift.update({
      where: { id },
      data: { closedAt: new Date() },
      include: { user: { select: { id: true, fullName: true, role: true } } },
    });
  }
}
