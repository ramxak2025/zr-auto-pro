import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindOptionsWhere,
  Between,
  MoreThanOrEqual,
  LessThanOrEqual,
} from 'typeorm';

import { Check } from './check.entity';
import { CheckServiceLine } from './check-service-line.entity';
import { CheckProductLine } from './check-product-line.entity';
import { ProductsService } from '../products/products.service';

@Injectable()
export class ChecksService {
  constructor(
    @InjectRepository(Check)
    private readonly checksRepo: Repository<Check>,

    @InjectRepository(CheckServiceLine)
    private readonly serviceLinesRepo: Repository<CheckServiceLine>,

    @InjectRepository(CheckProductLine)
    private readonly productLinesRepo: Repository<CheckProductLine>,

    private readonly productsService: ProductsService,
  ) {}

  async findAll(
    tenantId: string,
    filters?: {
      dateFrom?: string;
      dateTo?: string;
      masterId?: string;
      clientId?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ data: Check[]; total: number; page: number; limit: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;

    const where: FindOptionsWhere<Check> = { tenantId };

    if (filters?.dateFrom && filters?.dateTo) {
      where.date = Between(filters.dateFrom, filters.dateTo);
    } else if (filters?.dateFrom) {
      where.date = MoreThanOrEqual(filters.dateFrom);
    } else if (filters?.dateTo) {
      where.date = LessThanOrEqual(filters.dateTo);
    }

    if (filters?.masterId) {
      where.masterId = filters.masterId;
    }

    if (filters?.clientId) {
      where.clientId = filters.clientId;
    }

    const [data, total] = await this.checksRepo.findAndCount({
      where,
      relations: [
        'master',
        'client',
        'car',
        'services',
        'services.master',
        'products',
      ],
      order: { date: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<Check> {
    const check = await this.checksRepo.findOne({
      where: { id },
      relations: [
        'master',
        'client',
        'car',
        'services',
        'services.master',
        'products',
      ],
    });

    if (!check) {
      throw new NotFoundException(`Check with id "${id}" not found`);
    }

    return check;
  }

  async create(dto: any): Promise<Check> {
    // a) Create the Check entity from dto fields
    const check = this.checksRepo.create({
      tenantId: dto.tenantId,
      date: dto.date,
      masterId: dto.masterId,
      clientId: dto.clientId,
      carId: dto.carId,
      mileage: dto.mileage,
      comment: dto.comment,
      discount: dto.discount || 0,
      isDeferred: dto.isDeferred || false,
      paymentMethod: dto.paymentMethod || 'cash',
    });

    // b) Save first to get the ID
    const savedCheck = await this.checksRepo.save(check);

    // c) Create service lines
    const serviceLines: CheckServiceLine[] = [];
    if (dto.services && dto.services.length > 0) {
      for (const svc of dto.services) {
        const line = this.serviceLinesRepo.create({
          checkId: savedCheck.id,
          serviceId: svc.serviceId,
          masterId: svc.masterId,
          name: svc.name,
          price: svc.price,
          quantity: svc.quantity || 1,
          total: svc.price * (svc.quantity || 1),
        });
        const savedLine = await this.serviceLinesRepo.save(line);
        serviceLines.push(savedLine);
      }
    }

    // d) Create product lines
    const productLines: CheckProductLine[] = [];
    if (dto.products && dto.products.length > 0) {
      for (const prod of dto.products) {
        const line = this.productLinesRepo.create({
          checkId: savedCheck.id,
          productId: prod.productId,
          name: prod.name,
          sellPrice: prod.sellPrice,
          costPrice: prod.costPrice,
          quantity: prod.quantity || 1,
          totalSell: prod.sellPrice * (prod.quantity || 1),
          totalCost: prod.costPrice * (prod.quantity || 1),
        });
        const savedLine = await this.productLinesRepo.save(line);
        productLines.push(savedLine);

        // e) Deduct stock for each product
        await this.productsService.updateStock(
          prod.productId,
          prod.quantity || 1,
          'expense',
          'Продажа в чеке #' + savedCheck.number,
        );
      }
    }

    // f) Calculate totals
    const serviceTotal = serviceLines.reduce((sum, s) => sum + s.total, 0);
    const productTotal = productLines.reduce((sum, p) => sum + p.totalSell, 0);
    const discount = savedCheck.discount || 0;
    const totalRevenue = serviceTotal + productTotal - discount;
    const productCostTotal = productLines.reduce(
      (sum, p) => sum + p.totalCost,
      0,
    );
    const serviceSalaryTotal = 0;
    const totalCost = productCostTotal;
    const profit = totalRevenue - totalCost;

    // g) Update the check with calculated totals
    savedCheck.serviceTotal = serviceTotal;
    savedCheck.productTotal = productTotal;
    savedCheck.totalRevenue = totalRevenue;
    savedCheck.productCostTotal = productCostTotal;
    savedCheck.serviceSalaryTotal = serviceSalaryTotal;
    savedCheck.totalCost = totalCost;
    savedCheck.profit = profit;

    await this.checksRepo.save(savedCheck);

    return this.findById(savedCheck.id);
  }

  async update(id: string, dto: any): Promise<Check> {
    const check = await this.findById(id);

    if (dto.comment !== undefined) {
      check.comment = dto.comment;
    }
    if (dto.paymentMethod !== undefined) {
      check.paymentMethod = dto.paymentMethod;
    }
    if (dto.isDeferred !== undefined) {
      check.isDeferred = dto.isDeferred;
    }
    if (dto.discount !== undefined) {
      check.discount = dto.discount;
      // Recalculate totalRevenue and profit when discount changes
      check.totalRevenue =
        check.serviceTotal + check.productTotal - check.discount;
      check.profit = check.totalRevenue - check.totalCost;
    }

    await this.checksRepo.save(check);

    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    const result = await this.checksRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Check with id "${id}" not found`);
    }
  }

  async getDashboardStats(tenantId: string): Promise<{
    todayRevenue: number;
    todayChecks: number;
    weekRevenue: number;
    monthRevenue: number;
    todayProfit: number;
    monthProfit: number;
  }> {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Start of current week (Monday)
    const dayOfWeek = today.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - diffToMonday);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    // Start of current month
    const monthStartStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

    // Today stats
    const todayStats = await this.checksRepo
      .createQueryBuilder('check')
      .select('COALESCE(SUM(check.totalRevenue), 0)', 'revenue')
      .addSelect('COUNT(check.id)', 'count')
      .addSelect('COALESCE(SUM(check.profit), 0)', 'profit')
      .where('check.tenantId = :tenantId', { tenantId })
      .andWhere('check.date = :todayStr', { todayStr })
      .getRawOne();

    // Week revenue
    const weekStats = await this.checksRepo
      .createQueryBuilder('check')
      .select('COALESCE(SUM(check.totalRevenue), 0)', 'revenue')
      .where('check.tenantId = :tenantId', { tenantId })
      .andWhere('check.date >= :weekStartStr', { weekStartStr })
      .andWhere('check.date <= :todayStr', { todayStr })
      .getRawOne();

    // Month stats
    const monthStats = await this.checksRepo
      .createQueryBuilder('check')
      .select('COALESCE(SUM(check.totalRevenue), 0)', 'revenue')
      .addSelect('COALESCE(SUM(check.profit), 0)', 'profit')
      .where('check.tenantId = :tenantId', { tenantId })
      .andWhere('check.date >= :monthStartStr', { monthStartStr })
      .andWhere('check.date <= :todayStr', { todayStr })
      .getRawOne();

    return {
      todayRevenue: parseFloat(todayStats.revenue) || 0,
      todayChecks: parseInt(todayStats.count, 10) || 0,
      weekRevenue: parseFloat(weekStats.revenue) || 0,
      monthRevenue: parseFloat(monthStats.revenue) || 0,
      todayProfit: parseFloat(todayStats.profit) || 0,
      monthProfit: parseFloat(monthStats.profit) || 0,
    };
  }

  async getEmployeeRanking(
    tenantId: string,
  ): Promise<{ today: any[]; month: any[] }> {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const monthStartStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

    // Today ranking
    const todayRanking = await this.checksRepo
      .createQueryBuilder('check')
      .select('check.masterId', 'masterId')
      .addSelect('user.fullName', 'masterName')
      .addSelect('COALESCE(SUM(check.totalRevenue), 0)', 'totalRevenue')
      .addSelect('COUNT(check.id)', 'checksCount')
      .leftJoin('check.master', 'user')
      .where('check.tenantId = :tenantId', { tenantId })
      .andWhere('check.date = :todayStr', { todayStr })
      .andWhere('check.masterId IS NOT NULL')
      .groupBy('check.masterId')
      .addGroupBy('user.fullName')
      .orderBy('COALESCE(SUM(check.totalRevenue), 0)', 'DESC')
      .getRawMany();

    // Month ranking
    const monthRanking = await this.checksRepo
      .createQueryBuilder('check')
      .select('check.masterId', 'masterId')
      .addSelect('user.fullName', 'masterName')
      .addSelect('COALESCE(SUM(check.totalRevenue), 0)', 'totalRevenue')
      .addSelect('COUNT(check.id)', 'checksCount')
      .leftJoin('check.master', 'user')
      .where('check.tenantId = :tenantId', { tenantId })
      .andWhere('check.date >= :monthStartStr', { monthStartStr })
      .andWhere('check.date <= :todayStr', { todayStr })
      .andWhere('check.masterId IS NOT NULL')
      .groupBy('check.masterId')
      .addGroupBy('user.fullName')
      .orderBy('COALESCE(SUM(check.totalRevenue), 0)', 'DESC')
      .getRawMany();

    return {
      today: todayRanking.map((r) => ({
        masterId: r.masterId,
        masterName: r.masterName,
        totalRevenue: parseFloat(r.totalRevenue) || 0,
        checksCount: parseInt(r.checksCount, 10) || 0,
      })),
      month: monthRanking.map((r) => ({
        masterId: r.masterId,
        masterName: r.masterName,
        totalRevenue: parseFloat(r.totalRevenue) || 0,
        checksCount: parseInt(r.checksCount, 10) || 0,
      })),
    };
  }
}
