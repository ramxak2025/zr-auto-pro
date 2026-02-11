import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('financial_reports')
  getFinancialReport(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('period') period?: 'day' | 'week' | 'month' | 'year',
  ) {
    return this.reportsService.getFinancialReport({
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
      period,
    });
  }

  @Get('by-master')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('financial_reports')
  getSalesByMaster(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.reportsService.getSalesByMaster({
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    });
  }

  @Get('by-service')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('financial_reports')
  getSalesByService(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.reportsService.getSalesByService({
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    });
  }

  @Get('by-product')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('financial_reports')
  getSalesByProduct(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.reportsService.getSalesByProduct({
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    });
  }

  @Get('dashboard')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('profit_view')
  getDashboardStats() {
    return this.reportsService.getDashboardStats();
  }
}
