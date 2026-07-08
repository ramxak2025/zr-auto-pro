import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// Financial aggregates (revenue, profit, salary totals, expenses) must never
// be visible to a regular master — they would expose how much the tenant
// earns and the per-master payouts of their colleagues. The plan-level
// `reports_view` feature gate on the frontend filters by tenant tier; the
// role gate here filters by who inside the tenant can read these numbers.
//
// Defence-in-depth: @RequirePermission('financial_reports') is layered on top
// of the role gate. With the current @Roles list, only owner-class roles reach
// here and they ALWAYS pass the permission check — so this is behaviour-
// preserving today. It future-proofs the endpoint: if the role gate is ever
// loosened to let a master in, they still need the explicit permission.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('director', 'admin', 'superadmin')
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
  // а НЕ по financial_reports класса. Метод-декораторы ПЕРЕКРЫВАЮТ классовые
  // (Reflector.getAllAndOverride, handler первым):
  //   • @Roles(+'master') — впускаем и мастера; настоящий гейт — разрешение;
  //   • @RequirePermission('cashflow_view') — вместо financial_reports.
  // Охват свои/все решает сервис (cashflow_view_all). Ноль регрессии: owner-class
  // проходят разрешение всегда (bypass) и видят всё; мастер без cashflow_view →
  // 403, ровно как сегодня (эндпоинт был owner-class).
  @Get('cashflow')
  @Roles('director', 'admin', 'superadmin', 'master')
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
  // (+ funnel), reviews. Gate: owner-class via the class-level @Roles
  // (director/admin/superadmin) + @RequirePermission('marketing_access')
  // OVERRIDING the class-level 'financial_reports' (method decorator wins via
  // Reflector.getAllAndOverride — same pattern as getCashFlow above). Owner-
  // class roles bypass the permission check entirely (permissions.guard), so
  // in practice this stays owner-class-only today; the marketing_access key
  // future-proofs it if the role gate is ever loosened. Every sub-section is
  // computed best-effort in the service, so one failing section never 500s.
  @Get('marketing')
  @RequirePermission('marketing_access')
  getMarketingReport(@CurrentUser() user: JwtPayload, @Query() query: { from?: string; to?: string }) {
    return this.reportsService.getMarketingReport(user.tenantID, query);
  }
}
