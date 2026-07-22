import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// Financial aggregates (revenue, profit, salary totals, expenses) must never
// be visible to a regular master — they would expose how much the tenant
// earns and the per-master payouts of their colleagues. The plan-level
// `reports_view` feature gate on the frontend filters by tenant tier; the
// permission gate here filters by who inside the tenant can read these numbers.
//
// ROLE-ONLY (волна «права как в Битрикс24», 2026-07): классовый @Roles снят —
// МАТРИЦА роли авторитетна. Ячейка reports.view ('financial_reports') теперь
// реально работает в обе стороны: кастомная роль с ней получает отчёты,
// админ без неё — 403. Сиды системных ролей (мастер false, админ true) дают
// поведение 1:1 для нетронутых тенантов; owner-class (director/superadmin)
// проходит permission-гейт всегда.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('financial_reports')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('financial')
  getFinancial(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.reportsService.getFinancial(user.tenantID, query);
  }

  // «Движение денег» (ITEM 6) — доступ по ROLE-разрешению cashflow_view (НЕ по
  // плановой фиче cashflow_view из feature-catalog — это разные пространства),
  // а НЕ по financial_reports класса. Метод-@RequirePermission ПЕРЕКРЫВАЕТ
  // классовый (Reflector.getAllAndOverride, handler первым). Охват свои/все
  // решает сервис (cashflow_view_all); owner-class видит всё (bypass).
  @Get('cashflow')
  @RequirePermission('cashflow_view')
  getCashFlow(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.reportsService.getCashFlow(user, query);
  }

  /**
   * Aggregates for the defect + writeoff dashboard. `from`/`to` are ISO
   * date strings; tenant scoping handled inside the service via tenantID.
   */
  @Get('defect-writeoff')
  getDefectWriteoff(@CurrentUser() user: JwtPayload, @Query() query: { from?: string; to?: string }) {
    return this.reportsService.getDefectWriteoffReport(user.tenantID, query);
  }

  @Get('call-funnel')
  getCallFunnel(@CurrentUser() user: JwtPayload, @Query() query: { dateFrom?: string; dateTo?: string }) {
    return this.reportsService.getCallFunnel(user.tenantID, query);
  }

  // ── Owner dashboard v2 ───────────────────────────────────────────────
  // Augments /checks/dashboard with net profit, cash position, margin,
  // deferred sum, personal records, month forecast. Cached 30s.
  @Get('dashboard-v2')
  async dashboardV2(@CurrentUser() user: JwtPayload, @Query() query: { period?: 'today' | 'week' | 'month' | 'year' }) {
    const period = (query?.period ?? 'month') as 'today' | 'week' | 'month' | 'year';
    const [base, returns] = await Promise.all([
      this.reportsService.dashboardV2(user.tenantID, period),
      this.reportsService.returnsSummaryForDashboard(user.tenantID),
    ]);
    return { ...base, ...returns };
  }

  @Get('clients-new-vs-returning')
  clientsNewVsReturning(@CurrentUser() user: JwtPayload, @Query() query: { from: string; to: string }) {
    return this.reportsService.clientsNewVsReturning(user.tenantID, query);
  }

  @Get('alerts')
  alerts(@CurrentUser() user: JwtPayload) {
    return this.reportsService.alerts(user.tenantID);
  }

  @Get('best-day-of-week')
  bestDayOfWeek(@CurrentUser() user: JwtPayload, @Query() query: { from: string; to: string }) {
    return this.reportsService.bestDayOfWeek(user.tenantID, query);
  }

  @Get('recent-reviews')
  recentReviews(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    return this.reportsService.recentReviews(user.tenantID, limit ? parseInt(limit) : 5);
  }

  @Get('retention')
  retention(@CurrentUser() user: JwtPayload, @Query() query: { period?: 'week' | 'month' | 'year' }) {
    return this.reportsService.retention(user.tenantID, query?.period ?? 'month');
  }

  // ── Consolidated «Маркетинговые отчёты» ──────────────────────────────
  // ONE period → acquisition (new/returning + by-source), retention, calls
  // (+ funnel), reviews. Gate: @RequirePermission('marketing_access')
  // OVERRIDING the class-level 'financial_reports' (method decorator wins via
  // Reflector.getAllAndOverride — same pattern as getCashFlow above): маркетолог
  // с marketing_access читает отчёт без доступа к финансовым отчётам. Every
  // sub-section is computed best-effort in the service, so one failing section
  // never 500s.
  @Get('marketing')
  @RequirePermission('marketing_access')
  getMarketingReport(@CurrentUser() user: JwtPayload, @Query() query: { from?: string; to?: string }) {
    return this.reportsService.getMarketingReport(user.tenantID, query);
  }
}
