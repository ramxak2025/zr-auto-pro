import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { PlanningService } from './planning.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// «Планирование / Постоянные расходы» — owner-only config that drives the ACCRUAL
// net profit on the owner dashboard (reports v2). Gate mirrors ReportsController:
// class-level @Roles owner-class + @RequirePermission('financial_reports'). Owner-
// class roles bypass the permission check (permissions.guard), so this is owner-
// only in practice today; the permission key future-proofs it if the role gate is
// ever loosened. Reuses the EXISTING financial_reports permission — no new key, so
// the roles matrix / shared PERMISSION_GROUPS are untouched.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('director', 'admin', 'superadmin')
@RequirePermission('financial_reports')
@Controller('planning')
export class PlanningController {
  constructor(private planningService: PlanningService) {}

  // ── Fixed costs (планово-повторяющиеся, помесячно) ─────────────────────────
  @Get('fixed-costs')
  listFixedCosts(@CurrentUser() user: JwtPayload) {
    return this.planningService.listFixedCosts(user.tenantID);
  }

  @Post('fixed-costs')
  createFixedCost(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.planningService.createFixedCost(user.tenantID, dto);
  }

  @Patch('fixed-costs/:id')
  updateFixedCost(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.planningService.updateFixedCost(id, user.tenantID, dto);
  }

  @Delete('fixed-costs/:id')
  removeFixedCost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.planningService.removeFixedCost(id, user.tenantID);
  }

  // ── Employee compensation (оклад / % с оборота / % с прибыли) ───────────────
  @Get('compensation')
  listCompensation(@CurrentUser() user: JwtPayload) {
    return this.planningService.listCompensation(user.tenantID);
  }

  // Upsert by (tenant, employee) — one config per employee (v1).
  @Post('compensation')
  upsertCompensation(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.planningService.upsertCompensation(user.tenantID, dto);
  }

  @Patch('compensation/:id')
  updateCompensation(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.planningService.updateCompensation(id, user.tenantID, dto);
  }

  @Delete('compensation/:id')
  removeCompensation(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.planningService.removeCompensation(id, user.tenantID);
  }
}
