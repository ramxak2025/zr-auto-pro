import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChecksService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.dateFrom) where.date = { ...where.date, gte: new Date(params.dateFrom) };
    if (params?.dateTo) where.date = { ...where.date, lte: new Date(params.dateTo + 'T23:59:59') };
    if (params?.masterId) where.masterId = params.masterId;
    if (params?.clientId) where.clientId = params.clientId;

    const page = parseInt(params?.page) || 1;
    const limit = parseInt(params?.limit) || 50;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.check.findMany({
        where,
        include: {
          master: { select: { id: true, fullName: true } },
          client: { select: { id: true, fullName: true, phone: true } },
          car: { select: { id: true, plateNumber: true, makeModel: true } },
          services: { include: { master: { select: { id: true, fullName: true } } } },
          products: true,
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.check.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findById(id: string) {
    const check = await this.prisma.check.findUnique({
      where: { id },
      include: {
        master: { select: { id: true, fullName: true, salaryPercent: true } },
        client: { select: { id: true, fullName: true, phone: true } },
        car: { select: { id: true, plateNumber: true, makeModel: true } },
        services: { include: { master: { select: { id: true, fullName: true } } } },
        products: true,
      },
    });
    if (!check) throw new NotFoundException('Заказ-наряд не найден');
    return check;
  }

  async getDashboard(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayChecks, weekChecks, monthChecks] = await Promise.all([
      this.prisma.check.findMany({
        where: { tenantId, date: { gte: todayStart } },
      }),
      this.prisma.check.findMany({
        where: { tenantId, date: { gte: weekStart } },
      }),
      this.prisma.check.findMany({
        where: { tenantId, date: { gte: monthStart } },
      }),
    ]);

    return {
      todayRevenue: todayChecks.reduce((s, c) => s + c.totalRevenue, 0),
      todayChecks: todayChecks.length,
      todayProfit: todayChecks.reduce((s, c) => s + c.profit, 0),
      weekRevenue: weekChecks.reduce((s, c) => s + c.totalRevenue, 0),
      monthRevenue: monthChecks.reduce((s, c) => s + c.totalRevenue, 0),
      monthProfit: monthChecks.reduce((s, c) => s + c.profit, 0),
    };
  }

  async getRanking(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayChecks, monthChecks] = await Promise.all([
      this.prisma.check.findMany({
        where: { tenantId, date: { gte: todayStart } },
        include: { master: { select: { id: true, fullName: true } } },
      }),
      this.prisma.check.findMany({
        where: { tenantId, date: { gte: monthStart } },
        include: { master: { select: { id: true, fullName: true } } },
      }),
    ]);

    const aggregate = (checks: any[]) => {
      const map: Record<string, { masterId: string; masterName: string; revenue: number; checkCount: number }> = {};
      for (const c of checks) {
        if (!map[c.masterId]) {
          map[c.masterId] = {
            masterId: c.masterId,
            masterName: c.master?.fullName || '',
            revenue: 0,
            checkCount: 0,
          };
        }
        map[c.masterId].revenue += c.totalRevenue;
        map[c.masterId].checkCount++;
      }
      return Object.values(map).sort((a, b) => b.revenue - a.revenue);
    };

    return {
      today: aggregate(todayChecks),
      month: aggregate(monthChecks),
    };
  }

  async create(data: any, tenantId: string) {
    // Calculate next check number
    const lastCheck = await this.prisma.check.findFirst({
      where: { tenantId },
      orderBy: { number: 'desc' },
    });
    const nextNumber = (lastCheck?.number || 0) + 1;

    // Calculate totals
    const serviceTotal = (data.services || []).reduce((s: number, l: any) => s + (l.total || l.price * (l.quantity || 1)), 0);
    const productTotal = (data.products || []).reduce((s: number, l: any) => s + (l.totalSell || l.sellPrice * (l.quantity || 1)), 0);
    const productCostTotal = (data.products || []).reduce((s: number, l: any) => s + (l.totalCost || l.costPrice * (l.quantity || 1)), 0);
    const discount = data.discount || 0;
    const totalRevenue = serviceTotal + productTotal - discount;

    // Get master salary percent for salary calculation
    const master = await this.prisma.user.findUnique({ where: { id: data.masterId } });
    const salaryPercent = master?.salaryPercent || 0;
    const serviceSalaryTotal = serviceTotal * salaryPercent / 100;
    const totalCost = productCostTotal + serviceSalaryTotal;
    const profit = totalRevenue - totalCost;

    const check = await this.prisma.check.create({
      data: {
        number: nextNumber,
        date: data.date ? new Date(data.date) : new Date(),
        masterId: data.masterId,
        clientId: data.clientId,
        carId: data.carId,
        mileage: data.mileage,
        comment: data.comment,
        discount,
        isDeferred: data.isDeferred || false,
        paymentMethod: data.paymentMethod || 'cash',
        serviceTotal,
        productTotal,
        totalRevenue,
        productCostTotal,
        serviceSalaryTotal,
        totalCost,
        profit,
        tenantId,
        services: {
          create: (data.services || []).map((s: any) => ({
            serviceId: s.serviceId || null,
            masterId: s.masterId || data.masterId,
            name: s.name,
            price: s.price,
            quantity: s.quantity || 1,
            total: s.total || s.price * (s.quantity || 1),
          })),
        },
        products: {
          create: (data.products || []).map((p: any) => ({
            productId: p.productId || null,
            name: p.name,
            sellPrice: p.sellPrice,
            costPrice: p.costPrice,
            quantity: p.quantity || 1,
            totalSell: p.totalSell || p.sellPrice * (p.quantity || 1),
            totalCost: p.totalCost || p.costPrice * (p.quantity || 1),
          })),
        },
      },
      include: {
        master: { select: { id: true, fullName: true } },
        client: { select: { id: true, fullName: true, phone: true } },
        car: { select: { id: true, plateNumber: true, makeModel: true } },
        services: { include: { master: { select: { id: true, fullName: true } } } },
        products: true,
      },
    });

    // Deduct stock for products
    for (const p of data.products || []) {
      if (p.productId) {
        const product = await this.prisma.product.findUnique({ where: { id: p.productId } });
        if (product) {
          const stockBefore = product.stock;
          const stockAfter = Math.max(0, stockBefore - (p.quantity || 1));
          await this.prisma.product.update({
            where: { id: p.productId },
            data: { stock: stockAfter },
          });
          await this.prisma.stockMovement.create({
            data: {
              productId: p.productId,
              type: 'expense',
              quantity: p.quantity || 1,
              stockBefore,
              stockAfter,
              reason: `Заказ-наряд #${nextNumber}`,
              tenantId,
            },
          });
        }
      }
    }

    return check;
  }

  async update(id: string, data: any) {
    // Delete old lines
    await this.prisma.checkServiceLine.deleteMany({ where: { checkId: id } });
    await this.prisma.checkProductLine.deleteMany({ where: { checkId: id } });

    const serviceTotal = (data.services || []).reduce((s: number, l: any) => s + (l.total || l.price * (l.quantity || 1)), 0);
    const productTotal = (data.products || []).reduce((s: number, l: any) => s + (l.totalSell || l.sellPrice * (l.quantity || 1)), 0);
    const productCostTotal = (data.products || []).reduce((s: number, l: any) => s + (l.totalCost || l.costPrice * (l.quantity || 1)), 0);
    const discount = data.discount || 0;
    const totalRevenue = serviceTotal + productTotal - discount;

    const master = await this.prisma.user.findUnique({ where: { id: data.masterId } });
    const salaryPercent = master?.salaryPercent || 0;
    const serviceSalaryTotal = serviceTotal * salaryPercent / 100;
    const totalCost = productCostTotal + serviceSalaryTotal;
    const profit = totalRevenue - totalCost;

    return this.prisma.check.update({
      where: { id },
      data: {
        date: data.date ? new Date(data.date) : undefined,
        masterId: data.masterId,
        clientId: data.clientId,
        carId: data.carId,
        mileage: data.mileage,
        comment: data.comment,
        discount,
        isDeferred: data.isDeferred,
        paymentMethod: data.paymentMethod,
        serviceTotal,
        productTotal,
        totalRevenue,
        productCostTotal,
        serviceSalaryTotal,
        totalCost,
        profit,
        services: {
          create: (data.services || []).map((s: any) => ({
            serviceId: s.serviceId || null,
            masterId: s.masterId || data.masterId,
            name: s.name,
            price: s.price,
            quantity: s.quantity || 1,
            total: s.total || s.price * (s.quantity || 1),
          })),
        },
        products: {
          create: (data.products || []).map((p: any) => ({
            productId: p.productId || null,
            name: p.name,
            sellPrice: p.sellPrice,
            costPrice: p.costPrice,
            quantity: p.quantity || 1,
            totalSell: p.totalSell || p.sellPrice * (p.quantity || 1),
            totalCost: p.totalCost || p.costPrice * (p.quantity || 1),
          })),
        },
      },
      include: {
        master: { select: { id: true, fullName: true } },
        client: { select: { id: true, fullName: true, phone: true } },
        car: { select: { id: true, plateNumber: true, makeModel: true } },
        services: { include: { master: { select: { id: true, fullName: true } } } },
        products: true,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.check.delete({ where: { id } });
    return { success: true };
  }
}
