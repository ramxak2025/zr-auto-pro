import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true } } },
    });
    return tenants.map((t) => ({
      ...t,
      userCount: t._count.users,
      _count: undefined,
    }));
  }

  async getStats() {
    const [totalTenants, activeTenants, totalUsers] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { isActive: true } }),
      this.prisma.user.count(),
    ]);
    return { totalTenants, activeTenants, totalUsers };
  }

  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            role: true,
            isActive: true,
            createdAt: true,
            permissions: true,
            salaryPercent: true,
            tenantId: true,
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Тенант не найден');
    return tenant;
  }

  async create(data: any) {
    const tenant = await this.prisma.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        phone: data.phone,
        address: data.address,
        email: data.email,
        description: data.description,
        isActive: data.isActive !== undefined ? data.isActive : true,
        maxUsers: data.maxUsers || 10,
        subscriptionEnd: data.subscriptionEnd ? new Date(data.subscriptionEnd) : null,
        subscriptionNote: data.subscriptionNote,
      },
    });

    // Auto-create director if directorPhone provided
    if (data.directorPhone && data.directorName) {
      const hashed = await bcrypt.hash(data.directorPassword || '123456', 10);
      await this.prisma.user.create({
        data: {
          phone: data.directorPhone,
          password: hashed,
          fullName: data.directorName,
          role: 'director',
          tenantId: tenant.id,
          isActive: true,
          permissions: {
            checks_view: true,
            checks_create: true,
            checks_edit: true,
            checks_delete: true,
            profit_view: true,
            clients_view: true,
            clients_edit: true,
            warehouse_access: true,
            suppliers_access: true,
            financial_reports: true,
            export_data: true,
            user_management: true,
          },
        },
      });
    }

    return this.findById(tenant.id);
  }

  async update(id: string, data: any) {
    if (data.subscriptionEnd) {
      data.subscriptionEnd = new Date(data.subscriptionEnd);
    }
    return this.prisma.tenant.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.prisma.tenant.delete({ where: { id } });
    return { success: true };
  }
}
