import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServicesAppService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.search) {
      where.name = { contains: params.search, mode: 'insensitive' };
    }
    if (params?.category) {
      where.category = params.category;
    }

    return this.prisma.service.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) throw new NotFoundException('Услуга не найдена');
    return service;
  }

  async create(data: any, tenantId: string) {
    return this.prisma.service.create({
      data: {
        name: data.name,
        category: data.category,
        defaultPrice: data.defaultPrice || 0,
        tenantId,
      },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.service.update({
      where: { id },
      data: {
        name: data.name,
        category: data.category,
        defaultPrice: data.defaultPrice,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.service.delete({ where: { id } });
    return { success: true };
  }
}
