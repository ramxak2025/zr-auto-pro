import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('financial')
  getFinancial(@CurrentUser() user: any, @Query() query: any) {
    return this.reportsService.getFinancial(user.tenantId, query);
  }

  @Get('cashflow')
  getCashFlow(@CurrentUser() user: any, @Query() query: any) {
    return this.reportsService.getCashFlow(user.tenantId, query);
  }
}
