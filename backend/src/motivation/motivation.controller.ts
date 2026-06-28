import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { MotivationService } from './motivation.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { SetPromoDto } from './dto/set-promo.dto';

/**
 * «Мотивация сотрудников» v1 — акционные товары.
 *
 * Promo config (list / set / clear) is owner-class (director / admin / superadmin)
 * — the owner decides which products are акционные and at what percent. Accrual
 * listing is open to any authenticated user but a non-privileged caller is forced
 * to their OWN accruals (a master sees their own bonuses, not a colleague's).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('motivation')
export class MotivationController {
  constructor(private motivation: MotivationService) {}

  // ── Promo products (owner-class) ───────────────────────────────────────────

  @Roles('director', 'admin', 'superadmin')
  @Get('promos')
  listPromos(@CurrentUser() user: JwtPayload) {
    return this.motivation.listPromos(user.tenantID);
  }

  /** Set / update a product's promo percent (upsert by tenant+product). */
  @Roles('director', 'admin', 'superadmin')
  @Post('promos')
  setPromo(@CurrentUser() user: JwtPayload, @Body() dto: SetPromoDto) {
    return this.motivation.setPromo(user.tenantID, dto);
  }

  /** Remove a product from the promo programme. */
  @Roles('director', 'admin', 'superadmin')
  @Delete('promos/:productId')
  clearPromo(@Param('productId') productId: string, @CurrentUser() user: JwtPayload) {
    return this.motivation.clearPromo(user.tenantID, productId);
  }

  // ── Accruals (transparency) ────────────────────────────────────────────────

  /**
   * List motivation accruals. Director / admin / superadmin get the full tenant
   * view (optionally filtered by `?userId=`); any other role is force-scoped to
   * their own accruals so a master cannot read a colleague's bonus history.
   */
  @Get('accruals')
  listAccruals(
    @CurrentUser() user: JwtPayload,
    @Query() query: { userId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const privileged = ['director', 'admin', 'superadmin'].includes(user.role);
    const q = { ...(query || {}) };
    if (!privileged) q.userId = user.userID;
    return this.motivation.listAccruals(user.tenantID, q);
  }
}
