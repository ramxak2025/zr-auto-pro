import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { AuditService, AuditActor } from './audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { ExtendSubscriptionDto, AssignPlanDto, SuspendTenantDto } from './dto/subscription.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TenantsController {
  constructor(
    private tenantsService: TenantsService,
    private audit: AuditService,
  ) {}

  /** Build the audit actor for a superadmin action (name resolved best-effort). */
  private async actor(user: JwtPayload): Promise<AuditActor> {
    return { userId: user.userID, name: await this.audit.resolveActorName(user.userID) };
  }

  // ─── Superadmin-only routes (manage all tenants) ──────────────────

  @Roles('superadmin')
  @Get('tenants')
  getAll() {
    return this.tenantsService.getAll();
  }

  @Roles('superadmin')
  @Get('tenants/stats')
  getStats() {
    return this.tenantsService.getStats();
  }

  @Roles('superadmin')
  @Get('tenants/:id')
  getById(@Param('id') id: string) {
    return this.tenantsService.getById(id);
  }

  @Roles('superadmin')
  @Get('tenants/:id/metrics')
  getMetrics(@Param('id') id: string) {
    return this.tenantsService.getMetrics(id);
  }

  /** Composed "drill-in" cabinet: identity + subscription status/plan + metrics. */
  @Roles('superadmin')
  @Get('tenants/:id/cabinet')
  getCabinet(@Param('id') id: string) {
    return this.tenantsService.getCabinet(id);
  }

  @Roles('superadmin')
  @Post('tenants')
  create(@Body() dto: any) {
    return this.tenantsService.create(dto);
  }

  @Roles('superadmin')
  @Patch('tenants/:id')
  async update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: any) {
    return this.tenantsService.update(id, dto, await this.actor(user));
  }

  @Roles('superadmin')
  @Delete('tenants/:id')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.tenantsService.remove(id, await this.actor(user));
  }

  // ─── Subscription management (from the tenant card) ─────────────────

  @Roles('superadmin')
  @Post('tenants/:id/extend')
  async extend(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ExtendSubscriptionDto) {
    // 122 — pass the whole DTO (paid/free, amount, until, days, note). The
    // legacy `{ days }` body still validates and records a FREE ledger row.
    return this.tenantsService.extend(id, dto, await this.actor(user));
  }

  @Roles('superadmin')
  @Post('tenants/:id/assign-plan')
  async assignPlan(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: AssignPlanDto) {
    return this.tenantsService.assignPlan(id, dto.planId, await this.actor(user));
  }

  @Roles('superadmin')
  @Post('tenants/:id/suspend')
  async suspend(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: SuspendTenantDto) {
    return this.tenantsService.suspend(id, dto.reason, await this.actor(user));
  }

  @Roles('superadmin')
  @Post('tenants/:id/unsuspend')
  async unsuspend(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.tenantsService.unsuspend(id, await this.actor(user));
  }

  @Roles('superadmin')
  @Post('tenants/:id/impersonate')
  async impersonate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.tenantsService.impersonate(id, await this.actor(user));
  }

  // ─── Director routes (own company settings) ─────────────────────

  @Roles('director', 'superadmin')
  @Get('my-company')
  getMyCompany(@CurrentUser() user: JwtPayload) {
    return this.tenantsService.getMyCompany(user.tenantID);
  }

  @Roles('director', 'superadmin')
  @Patch('my-company')
  updateMyCompany(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.tenantsService.updateMyCompany(user.tenantID, dto);
  }

  // ─── Regular user route (view own subscription) ───────────────────

  @Get('subscription')
  getSubscription(@CurrentUser() user: JwtPayload) {
    return this.tenantsService.getSubscription(user.tenantID);
  }
}

/**
 * Superadmin platform-operator endpoints not tied to a single tenant (audit
 * trail + dashboard analytics). Separate controller because the routes live
 * under `/admin`, not `/tenants`. Same global JwtAuthGuard; the
 * @Roles('superadmin') below is enforced by RolesGuard.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminAuditController {
  constructor(
    private audit: AuditService,
    private tenantsService: TenantsService,
  ) {}

  @Roles('superadmin')
  @Get('audit-log')
  listAuditLog() {
    return this.audit.list(50);
  }

  /**
   * Monthly MRR trend for the admin dashboard. `months` defaults to 12 and is
   * clamped to 1..36 server-side. Oldest month first.
   */
  @Roles('superadmin')
  @Get('mrr-trends')
  getMrrTrends(@Query('months') months?: string) {
    return this.tenantsService.getMrrTrends(months !== undefined ? parseInt(months, 10) : undefined);
  }

  /**
   * 122 — платная выручка от подписок (собрано за месяц/всего, счётчики платных
   * vs бесплатных продлений, помесячный ряд). Бесплатные продления в выручку НЕ
   * входят. `months` по умолчанию 12, клампится на сервере в 1..36.
   */
  @Roles('superadmin')
  @Get('subscription-revenue')
  getSubscriptionRevenue(@Query('months') months?: string) {
    return this.tenantsService.getSubscriptionRevenue(months !== undefined ? parseInt(months, 10) : undefined);
  }
}
