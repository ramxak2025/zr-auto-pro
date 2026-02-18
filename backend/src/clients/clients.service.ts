import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.search) {
      where.OR = [
        { fullName: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search } },
      ];
    }

    const page = parseInt(params?.page) || 1;
    const limit = parseInt(params?.limit) || 50;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        include: { cars: true, _count: { select: { checks: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.client.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findById(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        cars: true,
        checks: {
          include: { master: { select: { id: true, fullName: true } }, car: true },
          orderBy: { date: 'desc' },
        },
      },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
    return client;
  }

  async create(data: any, tenantId: string) {
    return this.prisma.client.create({
      data: {
        fullName: data.fullName,
        phone: data.phone,
        comment: data.comment,
        tenantId,
      },
      include: { cars: true },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.client.update({
      where: { id },
      data: {
        fullName: data.fullName,
        phone: data.phone,
        comment: data.comment,
      },
      include: { cars: true },
    });
  }

  async remove(id: string) {
    await this.prisma.client.delete({ where: { id } });
    return { success: true };
  }
}
