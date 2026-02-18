import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.search) {
      where.OR = [
        { fullName: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        fullName: true,
        username: true,
        role: true,
        salaryPercent: true,
        permissions: true,
        isActive: true,
        tenantId: true,
        createdAt: true,
      },
    });
    return users;
  }

  async findMasters(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId, role: 'master', isActive: true },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        salaryPercent: true,
        isActive: true,
        createdAt: true,
        permissions: true,
        tenantId: true,
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phone: true,
        fullName: true,
        username: true,
        role: true,
        salaryPercent: true,
        permissions: true,
        isActive: true,
        tenantId: true,
        tenant: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return user;
  }

  async create(data: any, tenantId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { phone: data.phone },
    });
    if (existing) {
      throw new BadRequestException('Телефон уже используется');
    }

    const hashed = await bcrypt.hash(data.password || '123456', 10);
    return this.prisma.user.create({
      data: {
        phone: data.phone,
        password: hashed,
        fullName: data.fullName,
        username: data.username,
        role: data.role || 'master',
        salaryPercent: data.salaryPercent || 0,
        permissions: data.permissions || {},
        isActive: data.isActive !== undefined ? data.isActive : true,
        tenantId: data.tenantId || tenantId,
      },
      select: {
        id: true,
        phone: true,
        fullName: true,
        username: true,
        role: true,
        salaryPercent: true,
        permissions: true,
        isActive: true,
        tenantId: true,
        createdAt: true,
      },
    });
  }

  async update(id: string, data: any) {
    const updateData: any = { ...data };
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }
    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        phone: true,
        fullName: true,
        username: true,
        role: true,
        salaryPercent: true,
        permissions: true,
        isActive: true,
        tenantId: true,
        createdAt: true,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }
}
