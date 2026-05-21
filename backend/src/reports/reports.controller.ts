import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// Financial aggregates (revenue, profit, salary totals, expenses) must never
// be visible to a regular master — they would expose how much the tenant
// earns and the per-master payouts of their colleagues. The plan-level
// `reports_view` feature gate on the frontend filters by tenant tier; the
// role gate here filters by who inside the tenant can read these numbers.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('director', 'admin', 'superadmin')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('financial')
  getFinancial(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.reportsService.getFinancial(user.tenantID, query);
  }

  @Get('cashflow')
  getCashFlow(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.reportsService.getCashFlow(user.tenantID, query);
  }

  /**
   * Aggregates for the defect + writeoff dashboard. `from`/`to` are ISO
   * date strings; tenant scoping handled inside the service via tenantID.
   */
  @Get('defect-writeoff')
  getDefectWriteoff(@CurrentUser() user: JwtPayload, @Query() query: { from?: string; to?: string }) {
    return this.reportsService.getDefectWriteoffReport(user.tenantID, query);
  }
}
