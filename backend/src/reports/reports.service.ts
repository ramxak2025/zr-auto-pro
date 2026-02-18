import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getFinancial(tenantId: string, params: any) {
    const dateFrom = new Date(params.dateFrom);
    const dateTo = new Date(params.dateTo + 'T23:59:59');

    const checks = await this.prisma.check.findMany({
      where: {
        tenantId,
        date: { gte: dateFrom, lte: dateTo },
      },
    });

    const revenue = checks.reduce((s, c) => s + c.totalRevenue, 0);
    const productCost = checks.reduce((s, c) => s + c.productCostTotal, 0);
    const salaries = checks.reduce((s, c) => s + c.serviceSalaryTotal, 0);
    const grossProfit = revenue - productCost;
    const netProfit = grossProfit - salaries;

    return {
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      revenue,
      productCost,
      salaries,
      grossProfit,
      netProfit,
      checkCount: checks.length,
    };
  }

  async getCashFlow(tenantId: string, params: any) {
    const dateFrom = new Date(params.dateFrom);
    const dateTo = new Date(params.dateTo + 'T23:59:59');

    const checks = await this.prisma.check.findMany({
      where: {
        tenantId,
        date: { gte: dateFrom, lte: dateTo },
      },
    });

    const supplierPayments = await this.prisma.supplierPayment.findMany({
      where: {
        tenantId,
        date: { gte: dateFrom, lte: dateTo },
      },
    });

    const cashIncome = checks
      .filter((c) => c.paymentMethod === 'cash' || c.paymentMethod === 'cash_card')
      .reduce((s, c) => s + c.totalRevenue, 0);

    const cardIncome = checks
      .filter((c) => c.paymentMethod === 'card' || c.paymentMethod === 'cash_card')
      .reduce((s, c) => s + c.totalRevenue, 0);

    const totalIncome = checks.reduce((s, c) => s + c.totalRevenue, 0);
    const totalSupplierPayments = supplierPayments.reduce((s, p) => s + p.amount, 0);
    const salaryExpense = checks.reduce((s, c) => s + c.serviceSalaryTotal, 0);

    return {
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      cashIncome,
      cardIncome,
      totalIncome,
      supplierPayments: totalSupplierPayments,
      salaryExpense,
      netCashFlow: totalIncome - totalSupplierPayments - salaryExpense,
    };
  }
}
