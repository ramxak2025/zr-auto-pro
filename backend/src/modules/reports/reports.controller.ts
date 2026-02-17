import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial')
  async getFinancialReport(
    @Req() req: any,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.reportsService.getFinancialReport(tenantId, dateFrom, dateTo);
  }

  @Get('cashflow')
  async getCashFlow(
    @Req() req: any,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.reportsService.getCashFlow(tenantId, dateFrom, dateTo);
  }
}
