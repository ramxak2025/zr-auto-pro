import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { LoyaltyService } from './loyalty.service';
import { UpdateLoyaltySettingsDto } from './dto/update-loyalty-settings.dto';
import { AccrueBonusDto } from './dto/accrue-bonus.dto';
import { RedeemBonusDto } from './dto/redeem-bonus.dto';
import { AdjustBonusDto } from './dto/adjust-bonus.dto';

/**
 * Программа лояльности / бонусы / кешбэк — tenant-scoped from the JWT.
 *
 * Reads (settings, per-client summary) are open to ANY authenticated user in the
 * tenant (no @Roles ⇒ RolesGuard passes everyone), consistent with /clients and
 * /checks GET being role-open so a cashier can see the bonus balance.
 *
 * `accrue` / `redeem` are the explicit actions the cash UI fires at/after a
 * sale; they're gated to the cashier-capable set (director/admin/master/
 * superadmin) — the same roles that work the cash screen and create checks.
 *
 * `PATCH settings` and `adjust` (manual correction) are owner-class only.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('loyalty')
export class LoyaltyController {
  constructor(private loyalty: LoyaltyService) {}

  // ─── Reads (open to any tenant user) ───────────────────────────────────
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.loyalty.getSettings(user.tenantID);
  }

  @Get('client/:clientId')
  clientSummary(@CurrentUser() user: JwtPayload, @Param('clientId') clientId: string) {
    return this.loyalty.clientSummary(user.tenantID, clientId);
  }

  // ─── Cash-screen actions (cashier-capable roles) ───────────────────────
  @Roles('director', 'admin', 'master', 'superadmin')
  @Post('accrue')
  accrue(@CurrentUser() user: JwtPayload, @Body() dto: AccrueBonusDto) {
    return this.loyalty.accrue(user, dto);
  }

  @Roles('director', 'admin', 'master', 'superadmin')
  @Post('redeem')
  redeem(@CurrentUser() user: JwtPayload, @Body() dto: RedeemBonusDto) {
    return this.loyalty.redeem(user, dto);
  }

  // ─── Owner-class (config + manual correction) ──────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateLoyaltySettingsDto) {
    return this.loyalty.updateSettings(user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('adjust')
  adjust(@CurrentUser() user: JwtPayload, @Body() dto: AdjustBonusDto) {
    return this.loyalty.adjust(user, dto);
  }
}
