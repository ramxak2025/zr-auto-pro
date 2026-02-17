import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Check } from '../checks/check.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Check)
    private readonly checksRepo: Repository<Check>,
  ) {}

  async getFinancialReport(
    tenantId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<{
    dateFrom: string;
    dateTo: string;
    revenue: number;
    productCost: number;
    salaries: number;
    grossProfit: number;
    netProfit: number;
    checkCount: number;
  }> {
    const checks = await this.checksRepo.find({
      where: {
        tenantId,
        date: Between(dateFrom, dateTo),
      },
    });

    const revenue = checks.reduce((sum, c) => sum + c.totalRevenue, 0);
    const productCost = checks.reduce((sum, c) => sum + c.productCostTotal, 0);
    const salaries = checks.reduce((sum, c) => sum + c.serviceSalaryTotal, 0);
    const grossProfit = revenue - productCost;
    const netProfit = grossProfit - salaries;
    const checkCount = checks.length;

    return {
      dateFrom,
      dateTo,
      revenue,
      productCost,
      salaries,
      grossProfit,
      netProfit,
      checkCount,
    };
  }

  async getCashFlow(
    tenantId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<
    {
      date: string;
      cash: number;
      card: number;
      warranty: number;
      total: number;
    }[]
  > {
    const checks = await this.checksRepo.find({
      where: {
        tenantId,
        date: Between(dateFrom, dateTo),
      },
      order: { date: 'ASC' },
    });

    // Group checks by date
    const groupedByDate: Record<
      string,
      { cash: number; card: number; warranty: number; total: number }
    > = {};

    for (const check of checks) {
      const date = check.date;
      if (!groupedByDate[date]) {
        groupedByDate[date] = { cash: 0, card: 0, warranty: 0, total: 0 };
      }

      const method = check.paymentMethod || 'cash';
      if (method === 'cash') {
        groupedByDate[date].cash += check.totalRevenue;
      } else if (method === 'card') {
        groupedByDate[date].card += check.totalRevenue;
      } else if (method === 'warranty') {
        groupedByDate[date].warranty += check.totalRevenue;
      }
      groupedByDate[date].total += check.totalRevenue;
    }

    return Object.entries(groupedByDate).map(([date, values]) => ({
      date,
      ...values,
    }));
  }
}
