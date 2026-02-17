import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindOptionsWhere,
  Between,
  MoreThanOrEqual,
  LessThanOrEqual,
} from 'typeorm';
import { Check } from '../checks/check.entity';
import { CheckServiceLine } from '../checks/check-service-line.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class SalaryService {
  constructor(
    @InjectRepository(Check)
    private readonly checksRepo: Repository<Check>,

    @InjectRepository(CheckServiceLine)
    private readonly serviceLinesRepo: Repository<CheckServiceLine>,

    private readonly usersService: UsersService,
  ) {}

  async getMasterSalaries(
    tenantId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<
    {
      masterId: string;
      masterName: string;
      salaryPercent: number;
      totalEarnings: number;
      totalRevenue: number;
      checkCount: number;
    }[]
  > {
    const masters = await this.usersService.findMasters(tenantId);

    const result: {
      masterId: string;
      masterName: string;
      salaryPercent: number;
      totalEarnings: number;
      totalRevenue: number;
      checkCount: number;
    }[] = [];

    for (const master of masters) {
      const where: FindOptionsWhere<Check> = {
        masterId: master.id,
        tenantId,
      };

      if (dateFrom && dateTo) {
        where.date = Between(dateFrom, dateTo);
      } else if (dateFrom) {
        where.date = MoreThanOrEqual(dateFrom);
      } else if (dateTo) {
        where.date = LessThanOrEqual(dateTo);
      }

      const checks = await this.checksRepo.find({ where });

      const totalRevenue = checks.reduce(
        (sum, check) => sum + check.totalRevenue,
        0,
      );
      const checkCount = checks.length;
      const salaryPercent = master.salaryPercent || 0;
      const totalEarnings = (totalRevenue * salaryPercent) / 100;

      result.push({
        masterId: master.id,
        masterName: master.fullName,
        salaryPercent,
        totalEarnings,
        totalRevenue,
        checkCount,
      });
    }

    return result;
  }

  async getMySalary(
    userId: string,
    tenantId: string,
  ): Promise<{
    today: number;
    week: number;
    month: number;
    total: number;
    masterName: string;
    salaryPercent: number;
    todayChecks: number;
    monthChecks: number;
    todayCash: number;
    todayCard: number;
    todayWarranty: number;
  }> {
    const master = await this.usersService.findById(userId);
    const salaryPercent = master.salaryPercent || 0;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Start of current week (Monday)
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - diffToMonday);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    // Start of current month
    const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // Today's checks
    const todayChecks = await this.checksRepo.find({
      where: { masterId: userId, tenantId, date: todayStr },
    });

    // Week checks
    const weekChecks = await this.checksRepo.find({
      where: {
        masterId: userId,
        tenantId,
        date: Between(weekStartStr, todayStr),
      },
    });

    // Month checks
    const monthChecks = await this.checksRepo.find({
      where: {
        masterId: userId,
        tenantId,
        date: Between(monthStartStr, todayStr),
      },
    });

    // All-time checks
    const allChecks = await this.checksRepo.find({
      where: { masterId: userId, tenantId },
    });

    const todayRevenue = todayChecks.reduce(
      (sum, c) => sum + c.totalRevenue,
      0,
    );
    const weekRevenue = weekChecks.reduce(
      (sum, c) => sum + c.totalRevenue,
      0,
    );
    const monthRevenue = monthChecks.reduce(
      (sum, c) => sum + c.totalRevenue,
      0,
    );
    const totalRevenue = allChecks.reduce(
      (sum, c) => sum + c.totalRevenue,
      0,
    );

    // Today's payment method breakdown
    const todayCash = todayChecks
      .filter((c) => c.paymentMethod === 'cash')
      .reduce((sum, c) => sum + c.totalRevenue, 0);
    const todayCard = todayChecks
      .filter((c) => c.paymentMethod === 'card')
      .reduce((sum, c) => sum + c.totalRevenue, 0);
    const todayWarranty = todayChecks
      .filter((c) => c.paymentMethod === 'warranty')
      .reduce((sum, c) => sum + c.totalRevenue, 0);

    return {
      today: (todayRevenue * salaryPercent) / 100,
      week: (weekRevenue * salaryPercent) / 100,
      month: (monthRevenue * salaryPercent) / 100,
      total: (totalRevenue * salaryPercent) / 100,
      masterName: master.fullName,
      salaryPercent,
      todayChecks: todayChecks.length,
      monthChecks: monthChecks.length,
      todayCash,
      todayCard,
      todayWarranty,
    };
  }
}
