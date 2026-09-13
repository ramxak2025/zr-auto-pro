import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { PlanningService } from './planning.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId } from '../common/point-scope';

// «Планирование / Постоянные расходы» — config that drives the ACCRUAL net
// profit on the owner dashboard (reports v2). Матрица ролей АВТОРИТЕТНА (волна
// «права как в Битрикс24», 2026-07): класс-@Roles снят, гейт — только
// @RequirePermission('financial_reports') (ячейка reports.view; сид: Директор/
// Админ true, Мастер false — прежний @Roles(d,a,sa) 1:1). Owner-class
// (director/superadmin) обходит проверку в PermissionsGuard; кастомная роль с
// reports.view=true теперь реально проходит.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('financial_reports')
@Controller('planning')
export class PlanningController {
  constructor(private planningService: PlanningService) {}

  // ── Fixed costs (планово-повторяющиеся, помесячно) ─────────────────────────
  @Get('fixed-costs')
  listFixedCosts(@CurrentUser() user: JwtPayload) {
    // 167 — план филиала сессии.
    return this.planningService.listFixedCosts(user.tenantID, actorPointId(user));
  }

  @Post('fixed-costs')
  createFixedCost(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.planningService.createFixedCost(user.tenantID, dto, actorPointId(user));
  }

  @Patch('fixed-costs/:id')
  updateFixedCost(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.planningService.updateFixedCost(id, user.tenantID, dto, actorPointId(user));
  }

  @Delete('fixed-costs/:id')
  removeFixedCost(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.planningService.removeFixedCost(id, user.tenantID, actorPointId(user));
  }

  // ── Employee compensation (оклад / % с оборота / % с прибыли) ───────────────
  @Get('compensation')
  listCompensation(@CurrentUser() user: JwtPayload) {
    return this.planningService.listCompensation(user.tenantID, actorPointId(user));
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
