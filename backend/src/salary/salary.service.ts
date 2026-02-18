import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SalaryService {
  constructor(private prisma: PrismaService) {}

  async getAll(tenantId: string, params?: any) {
    const dateFrom = params?.dateFrom ? new Date(params.dateFrom) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const dateTo = params?.dateTo ? new Date(params.dateTo + 'T23:59:59') : new Date();

    const masters = await this.prisma.user.findMany({
      where: { tenantId, role: 'master', isActive: true },
      select: { id: true, fullName: true, salaryPercent: true },
    });

    const checks = await this.prisma.check.findMany({
      where: { tenantId, date: { gte: dateFrom, lte: dateTo } },
    });

    return masters.map((master) => {
      const masterChecks = checks.filter((c) => c.masterId === master.id);
      const totalRevenue = masterChecks.reduce((s, c) => s + c.serviceTotal, 0);
      const totalEarnings = totalRevenue * master.salaryPercent / 100;

      return {
        masterId: master.id,
        masterName: master.fullName,
        salaryPercent: master.salaryPercent,
        totalEarnings,
        totalRevenue,
        checkCount: masterChecks.length,
      };
    });
  }

  async getMy(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, salaryPercent: true, tenantId: true },
    });
    if (!user) return null;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const allChecks = await this.prisma.check.findMany({
      where: { masterId: userId, tenantId: user.tenantId! },
    });

    const todayChecks = allChecks.filter((c) => c.date >= todayStart);
    const weekChecks = allChecks.filter((c) => c.date >= weekStart);
    const monthChecks = allChecks.filter((c) => c.date >= monthStart);

    const calcEarnings = (checks: any[]) =>
      checks.reduce((s, c) => s + c.serviceTotal, 0) * user.salaryPercent / 100;

    const todayCashChecks = todayChecks.filter((c) => c.paymentMethod === 'cash');
    const todayCardChecks = todayChecks.filter((c) => c.paymentMethod === 'card');
    const todayWarrantyChecks = todayChecks.filter((c) => c.paymentMethod === 'warranty');

    return {
      masterName: user.fullName,
      salaryPercent: user.salaryPercent,
      today: calcEarnings(todayChecks),
      week: calcEarnings(weekChecks),
      month: calcEarnings(monthChecks),
      total: calcEarnings(allChecks),
      todayChecks: todayChecks.length,
      monthChecks: monthChecks.length,
      todayCash: todayCashChecks.reduce((s, c) => s + c.totalRevenue, 0),
      todayCard: todayCardChecks.reduce((s, c) => s + c.totalRevenue, 0),
      todayWarranty: todayWarrantyChecks.reduce((s, c) => s + c.totalRevenue, 0),
    };
  }
}
