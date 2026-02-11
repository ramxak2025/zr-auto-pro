import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('financial_reports')
  getFinancialReport(
    @TenantId() tenantId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('period') period?: 'day' | 'week' | 'month' | 'year',
  ) {
    return this.reportsService.getFinancialReport(tenantId, {
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
      period,
    });
  }

  @Get('by-master')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('financial_reports')
  getSalesByMaster(
    @TenantId() tenantId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.reportsService.getSalesByMaster(tenantId, {
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    });
  }

  @Get('by-service')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('financial_reports')
  getSalesByService(
    @TenantId() tenantId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.reportsService.getSalesByService(tenantId, {
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    });
  }

  @Get('by-product')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('financial_reports')
  getSalesByProduct(
    @TenantId() tenantId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.reportsService.getSalesByProduct(tenantId, {
      dateFrom: new Date(dateFrom),
      dateTo: new Date(dateTo),
    });
  }

  @Get('dashboard')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('profit_view')
  getDashboardStats(@TenantId() tenantId: string) {
    return this.reportsService.getDashboardStats(tenantId);
  }
}
