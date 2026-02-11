import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Check } from '../checks/entities/check.entity';
import { User } from '../users/entities/user.entity';

interface SalaryQuery {
  dateFrom?: string;
  dateTo?: string;
  period?: 'day' | 'week' | 'month';
}

@Injectable()
export class SalaryService {
  constructor(
    @InjectRepository(Check)
    private readonly checkRepo: Repository<Check>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getMasterSalary(masterId: string, query: SalaryQuery) {
    const master = await this.userRepo.findOne({ where: { id: masterId } });
    if (!master) {
      throw new NotFoundException(`Master with id ${masterId} not found`);
    }

    let dateFrom: Date;
    let dateTo: Date;

    if (query.dateFrom && query.dateTo) {
      dateFrom = new Date(query.dateFrom);
      dateTo = new Date(query.dateTo);
      dateTo.setHours(23, 59, 59, 999);
    } else if (query.period) {
      const range = this.getDateRange(query.period);
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    } else {
      const range = this.getDateRange('month');
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }

    const checks = await this.checkRepo.find({
      where: {
        masterId,
        date: Between(dateFrom, dateTo),
      },
      relations: ['client', 'car'],
      order: { date: 'DESC' },
    });

    let totalEarnings = 0;
    let totalRevenue = 0;

    const checkDetails = checks.map((check) => {
      totalEarnings += Number(check.serviceSalaryTotal);
      totalRevenue += Number(check.totalRevenue);

      return {
        id: check.id,
        number: check.number,
        date: check.date,
        serviceTotal: Number(check.serviceTotal),
        productTotal: Number(check.productTotal),
        totalRevenue: Number(check.totalRevenue),
        serviceSalaryTotal: Number(check.serviceSalaryTotal),
        profit: Number(check.profit),
        paymentMethod: check.paymentMethod,
        clientId: check.clientId,
        carId: check.carId,
      };
    });

    return {
      masterId,
      masterName: master.fullName,
      period: query.period || null,
      dateFrom,
      dateTo,
      totalEarnings,
      totalRevenue,
      checkCount: checks.length,
      checks: checkDetails,
    };
  }

  async getMasterSalarySummary(masterId: string) {
    const master = await this.userRepo.findOne({ where: { id: masterId } });
    if (!master) {
      throw new NotFoundException(`Master with id ${masterId} not found`);
    }

    const [today, week, month, total] = await Promise.all([
      this.calculateEarnings(masterId, 'day'),
      this.calculateEarnings(masterId, 'week'),
      this.calculateEarnings(masterId, 'month'),
      this.calculateEarnings(masterId, null),
    ]);

    return {
      masterName: master.fullName,
      salaryPercent: Number(master.salaryPercent),
      today,
      week,
      month,
      total,
    };
  }

  async getAllMastersSalary(query: { dateFrom?: string; dateTo?: string }) {
    const masters = await this.userRepo.find({
      where: { isActive: true },
    });

    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;

    if (query.dateFrom && query.dateTo) {
      dateFrom = new Date(query.dateFrom);
      dateTo = new Date(query.dateTo);
      dateTo.setHours(23, 59, 59, 999);
    } else {
      const range = this.getDateRange('month');
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }

    const results = await Promise.all(
      masters.map(async (master) => {
        const checks = await this.checkRepo.find({
          where: {
            masterId: master.id,
            date: Between(dateFrom, dateTo),
          },
        });

        let totalEarnings = 0;
        let totalRevenue = 0;

        checks.forEach((check) => {
          totalEarnings += Number(check.serviceSalaryTotal);
          totalRevenue += Number(check.totalRevenue);
        });

        return {
          masterId: master.id,
          masterName: master.fullName,
          salaryPercent: Number(master.salaryPercent),
          totalEarnings,
          totalRevenue,
          checkCount: checks.length,
        };
      }),
    );

    return results;
  }

  private async calculateEarnings(
    masterId: string,
    period: 'day' | 'week' | 'month' | null,
  ) {
    let whereCondition: any = { masterId };

    if (period) {
      const range = this.getDateRange(period);
      whereCondition.date = Between(range.dateFrom, range.dateTo);
    }

    const checks = await this.checkRepo.find({ where: whereCondition });

    let totalEarnings = 0;
    let totalRevenue = 0;

    checks.forEach((check) => {
      totalEarnings += Number(check.serviceSalaryTotal);
      totalRevenue += Number(check.totalRevenue);
    });

    return {
      totalEarnings,
      totalRevenue,
      checkCount: checks.length,
    };
  }

  private getDateRange(period: 'day' | 'week' | 'month'): {
    dateFrom: Date;
    dateTo: Date;
  } {
    const now = new Date();
    let dateFrom: Date;
    const dateTo = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );

    switch (period) {
      case 'day':
        dateFrom = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
          0,
        );
        break;
      case 'week':
        dateFrom = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - 7,
          0,
          0,
          0,
          0,
        );
        break;
      case 'month':
        dateFrom = new Date(
          now.getFullYear(),
          now.getMonth(),
          1,
          0,
          0,
          0,
          0,
        );
        break;
    }

    return { dateFrom, dateTo };
  }
}
