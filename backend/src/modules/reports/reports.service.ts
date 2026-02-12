import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Check } from '../checks/entities/check.entity';
import { CheckService as CheckServiceEntity } from '../checks/entities/check-service.entity';
import { CheckProduct } from '../checks/entities/check-product.entity';
import { User } from '../users/entities/user.entity';

export interface FinancialReportQuery {
  dateFrom: Date;
  dateTo: Date;
  period?: 'day' | 'week' | 'month' | 'year';
}

export interface DateRangeQuery {
  dateFrom: Date;
  dateTo: Date;
}

export interface FinancialReportResult {
  dateFrom: Date;
  dateTo: Date;
  revenue: number;
  productCost: number;
  salaries: number;
  grossProfit: number;
  netProfit: number;
  checkCount: number;
}

export interface SalesByMasterResult {
  masterId: string;
  masterName: string;
  revenue: number;
  checkCount: number;
  salaryTotal: number;
}

export interface SalesByServiceResult {
  serviceName: string;
  count: number;
  revenue: number;
}

export interface SalesByProductResult {
  productName: string;
  count: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface DashboardStatsResult {
  todayRevenue: number;
  todayChecks: number;
  weekRevenue: number;
  monthRevenue: number;
  todayProfit: number;
  monthProfit: number;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Check)
    private readonly checkRepo: Repository<Check>,
    @InjectRepository(CheckServiceEntity)
    private readonly checkServiceRepo: Repository<CheckServiceEntity>,
    @InjectRepository(CheckProduct)
    private readonly checkProductRepo: Repository<CheckProduct>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getFinancialReport(
    tenantId: string,
    query: FinancialReportQuery,
  ): Promise<FinancialReportResult> {
    const { dateFrom, dateTo } = query;

    const result = await this.checkRepo
      .createQueryBuilder('check')
      .select('COALESCE(SUM(check.totalRevenue), 0)', 'revenue')
      .addSelect('COALESCE(SUM(check.productCostTotal), 0)', 'productCost')
      .addSelect(
        'COALESCE(SUM(check.serviceSalaryTotal), 0)',
        'salaries',
      )
      .addSelect('COALESCE(SUM(check.profit), 0)', 'netProfit')
      .addSelect('COUNT(check.id)', 'checkCount')
      .where('check.date BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      })
      .andWhere('check.deletedAt IS NULL')
      .andWhere('check.tenantId = :tenantId', { tenantId })
      .getRawOne();

    const revenue = parseFloat(result.revenue) || 0;
    const productCost = parseFloat(result.productCost) || 0;
    const salaries = parseFloat(result.salaries) || 0;
    const netProfit = parseFloat(result.netProfit) || 0;
    const grossProfit = revenue - productCost;
    const checkCount = parseInt(result.checkCount, 10) || 0;

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

  async getSalesByMaster(
    tenantId: string,
    query: DateRangeQuery,
  ): Promise<SalesByMasterResult[]> {
    const { dateFrom, dateTo } = query;

    const results = await this.checkRepo
      .createQueryBuilder('check')
      .select('check.masterId', 'masterId')
      .addSelect('user.fullName', 'masterName')
      .addSelect('COALESCE(SUM(check.totalRevenue), 0)', 'revenue')
      .addSelect('COUNT(check.id)', 'checkCount')
      .addSelect(
        'COALESCE(SUM(check.serviceSalaryTotal), 0)',
        'salaryTotal',
      )
      .innerJoin('check.master', 'user')
      .where('check.date BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      })
      .andWhere('check.deletedAt IS NULL')
      .andWhere('check.tenantId = :tenantId', { tenantId })
      .groupBy('check.masterId')
      .addGroupBy('user.fullName')
      .orderBy('revenue', 'DESC')
      .getRawMany();

    return results.map((row) => ({
      masterId: row.masterId,
      masterName: row.masterName,
      revenue: parseFloat(row.revenue) || 0,
      checkCount: parseInt(row.checkCount, 10) || 0,
      salaryTotal: parseFloat(row.salaryTotal) || 0,
    }));
  }

  async getSalesByService(
    tenantId: string,
    query: DateRangeQuery,
  ): Promise<SalesByServiceResult[]> {
    const { dateFrom, dateTo } = query;

    const results = await this.checkServiceRepo
      .createQueryBuilder('cs')
      .select('cs.name', 'serviceName')
      .addSelect('COALESCE(SUM(cs.quantity), 0)', 'count')
      .addSelect('COALESCE(SUM(cs.total), 0)', 'revenue')
      .innerJoin('cs.check', 'check')
      .where('check.date BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      })
      .andWhere('check.deletedAt IS NULL')
      .andWhere('check.tenantId = :tenantId', { tenantId })
      .groupBy('cs.name')
      .orderBy('revenue', 'DESC')
      .getRawMany();

    return results.map((row) => ({
      serviceName: row.serviceName,
      count: parseInt(row.count, 10) || 0,
      revenue: parseFloat(row.revenue) || 0,
    }));
  }

  async getSalesByProduct(
    tenantId: string,
    query: DateRangeQuery,
  ): Promise<SalesByProductResult[]> {
    const { dateFrom, dateTo } = query;

    const results = await this.checkProductRepo
      .createQueryBuilder('cp')
      .select('cp.name', 'productName')
      .addSelect('COALESCE(SUM(cp.quantity), 0)', 'count')
      .addSelect('COALESCE(SUM(cp.totalSell), 0)', 'revenue')
      .addSelect('COALESCE(SUM(cp.totalCost), 0)', 'cost')
      .addSelect(
        'COALESCE(SUM(cp.totalSell), 0) - COALESCE(SUM(cp.totalCost), 0)',
        'profit',
      )
      .innerJoin('cp.check', 'check')
      .where('check.date BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      })
      .andWhere('check.deletedAt IS NULL')
      .andWhere('check.tenantId = :tenantId', { tenantId })
      .groupBy('cp.name')
      .orderBy('revenue', 'DESC')
      .getRawMany();

    return results.map((row) => ({
      productName: row.productName,
      count: parseInt(row.count, 10) || 0,
      revenue: parseFloat(row.revenue) || 0,
      cost: parseFloat(row.cost) || 0,
      profit: parseFloat(row.profit) || 0,
    }));
  }

  async getDashboardStats(tenantId: string): Promise<DashboardStatsResult> {
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const weekStart = new Date(now);
    const dayOfWeek = weekStart.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    weekStart.setDate(weekStart.getDate() - diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const todayResult = await this.checkRepo
      .createQueryBuilder('check')
      .select('COALESCE(SUM(check.totalRevenue), 0)', 'revenue')
      .addSelect('COUNT(check.id)', 'checkCount')
      .addSelect('COALESCE(SUM(check.profit), 0)', 'profit')
      .where('check.date BETWEEN :dateFrom AND :dateTo', {
        dateFrom: todayStart,
        dateTo: todayEnd,
      })
      .andWhere('check.deletedAt IS NULL')
      .andWhere('check.tenantId = :tenantId', { tenantId })
      .getRawOne();

    const weekResult = await this.checkRepo
      .createQueryBuilder('check')
      .select('COALESCE(SUM(check.totalRevenue), 0)', 'revenue')
      .where('check.date BETWEEN :dateFrom AND :dateTo', {
        dateFrom: weekStart,
        dateTo: todayEnd,
      })
      .andWhere('check.deletedAt IS NULL')
      .andWhere('check.tenantId = :tenantId', { tenantId })
      .getRawOne();

    const monthResult = await this.checkRepo
      .createQueryBuilder('check')
      .select('COALESCE(SUM(check.totalRevenue), 0)', 'revenue')
      .addSelect('COALESCE(SUM(check.profit), 0)', 'profit')
      .where('check.date BETWEEN :dateFrom AND :dateTo', {
        dateFrom: monthStart,
        dateTo: todayEnd,
      })
      .andWhere('check.deletedAt IS NULL')
      .andWhere('check.tenantId = :tenantId', { tenantId })
      .getRawOne();

    return {
      todayRevenue: parseFloat(todayResult.revenue) || 0,
      todayChecks: parseInt(todayResult.checkCount, 10) || 0,
      weekRevenue: parseFloat(weekResult.revenue) || 0,
      monthRevenue: parseFloat(monthResult.revenue) || 0,
      todayProfit: parseFloat(todayResult.profit) || 0,
      monthProfit: parseFloat(monthResult.profit) || 0,
    };
  }

  async getEmployeeRanking(tenantId: string): Promise<{
    today: Array<{ masterId: string; masterName: string; revenue: number; checkCount: number }>;
    month: Array<{ masterId: string; masterName: string; revenue: number; checkCount: number }>;
  }> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const buildQuery = (from: Date, to: Date) =>
      this.checkRepo
        .createQueryBuilder('check')
        .select('check.masterId', 'masterId')
        .addSelect('user.fullName', 'masterName')
        .addSelect('COALESCE(SUM(check.totalRevenue), 0)', 'revenue')
        .addSelect('COUNT(check.id)', 'checkCount')
        .innerJoin('check.master', 'user')
        .where('check.date BETWEEN :dateFrom AND :dateTo', { dateFrom: from, dateTo: to })
        .andWhere('check.deletedAt IS NULL')
        .andWhere('check.tenantId = :tenantId', { tenantId })
        .groupBy('check.masterId')
        .addGroupBy('user.fullName')
        .orderBy('revenue', 'DESC')
        .getRawMany();

    const [todayResults, monthResults] = await Promise.all([
      buildQuery(todayStart, todayEnd),
      buildQuery(monthStart, todayEnd),
    ]);

    const mapResult = (rows: any[]) =>
      rows.map((row) => ({
        masterId: row.masterId,
        masterName: row.masterName,
        revenue: parseFloat(row.revenue) || 0,
        checkCount: parseInt(row.checkCount, 10) || 0,
      }));

    return {
      today: mapResult(todayResults),
      month: mapResult(monthResults),
    };
  }
