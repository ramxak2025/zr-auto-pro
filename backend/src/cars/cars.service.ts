import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CarsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.clientId) where.clientId = params.clientId;
    if (params?.search) {
      where.OR = [
        { plateNumber: { contains: params.search, mode: 'insensitive' } },
        { makeModel: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.car.findMany({
      where,
      include: { client: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const car = await this.prisma.car.findUnique({
      where: { id },
      include: { client: true },
    });
    if (!car) throw new NotFoundException('Автомобиль не найден');
    return car;
  }

  async create(data: any, tenantId: string) {
    return this.prisma.car.create({
      data: {
        plateNumber: data.plateNumber,
        makeModel: data.makeModel,
        comment: data.comment,
        clientId: data.clientId,
        tenantId,
      },
      include: { client: { select: { id: true, fullName: true } } },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.car.update({
      where: { id },
      data: {
        plateNumber: data.plateNumber,
        makeModel: data.makeModel,
        comment: data.comment,
        clientId: data.clientId,
      },
      include: { client: { select: { id: true, fullName: true } } },
    });
  }

  async remove(id: string) {
    await this.prisma.car.delete({ where: { id } });
    return { success: true };
  }
}
