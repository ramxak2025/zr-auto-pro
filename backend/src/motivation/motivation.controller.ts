import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { MotivationRulesService } from './motivation-rules.service';
import { MotivationService } from './motivation.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission, userHasPermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { SetPromoDto } from './dto/set-promo.dto';

/**
 * «Мотивация сотрудников» v1 — акционные товары.
 *
 * Матрица ролей АВТОРИТЕТНА (волна «права как в Битрикс24», 2026-07): promo
 * config (list / set / clear) — 'motivation_manage' (ячейка salary.motivation;
 * сид: Директор/Админ true, Мастер false — прежний @Roles(d,a,sa) 1:1,
 * миграция 136). Accrual listing is open to any authenticated user but a
 * non-privileged caller is forced to their OWN accruals (a master sees their
 * own bonuses, not a colleague's) — охват решает 'salary_view_all'.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('motivation')
export class MotivationController {
  constructor(
    private motivation: MotivationService,
    private rules: MotivationRulesService,
  ) {}

  @RequirePermission('motivation_manage')
  @Get('rules')
  listRules(@CurrentUser() user: JwtPayload) {
    return this.rules.list(user.tenantID);
  }

  @RequirePermission('motivation_manage')
  @Post('rules/bulk')
  bulkRules(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.rules.bulk(user.tenantID, body);
  }

  @RequirePermission('motivation_manage')
  @Patch('rules/:id')
  patchRule(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    return this.rules.change(user.tenantID, id, body);
  }

  @RequirePermission('motivation_manage')
  @Delete('rules/:id')
  deleteRule(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('expectedRevision') expectedRevision: string,
  ) {
    return this.rules.change(user.tenantID, id, { expectedRevision }, true);
  }

  @Get('accruals-v2')
  listMixedAccruals(
    @CurrentUser() user: JwtPayload,
    @Query() query: { userId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const q = { ...(query || {}) };
    if (!userHasPermission(user, 'salary_view_all')) q.userId = user.userID;
    return this.motivation.listAccruals(user.tenantID, q, true);
  }

  // ── Promo products ('motivation_manage') ───────────────────────────────────

  @RequirePermission('motivation_manage')
  @Get('promos')
  listPromos(@CurrentUser() user: JwtPayload) {
    return this.motivation.listPromos(user.tenantID);
  }

  /** Set / update a product's promo percent (upsert by tenant+product). */
  @RequirePermission('motivation_manage')
  @Post('promos')
  setPromo(@CurrentUser() user: JwtPayload, @Body() dto: SetPromoDto) {
    return this.motivation.setPromo(user.tenantID, dto);
  }

  /** Remove a product from the promo programme. */
  @RequirePermission('motivation_manage')
  @Delete('promos/:productId')
  clearPromo(@Param('productId') productId: string, @CurrentUser() user: JwtPayload) {
    return this.motivation.clearPromo(user.tenantID, productId);
  }

  // ── Accruals (transparency) ────────────────────────────────────────────────

  /**
   * List motivation accruals. Держатель 'salary_view_all' (owner-class всегда;
   * системный «Админ» — по сиду матрицы) получает полный вид по тенанту
   * (optionally filtered by `?userId=`); any other caller is force-scoped to
   * their own accruals so a master cannot read a colleague's bonus history.
   */
  @Get('accruals')
  listAccruals(
    @CurrentUser() user: JwtPayload,
    @Query() query: { userId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const privileged = userHasPermission(user, 'salary_view_all');
    const q = { ...(query || {}) };
    if (!privileged) q.userId = user.userID;
    return this.motivation.listAccruals(user.tenantID, q);
  }
}
