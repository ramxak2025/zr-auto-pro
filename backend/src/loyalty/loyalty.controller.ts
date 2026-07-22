import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
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
 * tenant (undecorated ⇒ guards pass everyone), consistent with /clients and
 * /checks GET being role-open so a cashier can see the bonus balance.
 *
 * `accrue` / `redeem` are the explicit actions the cash UI fires at/after a
 * sale — part of the check flow, so they ride the 'checks_create' matrix cell
 * (master seed true → the cash screen keeps working for masters).
 *
 * `PATCH settings` and `adjust` (manual correction) are 'settings_manage'
 * (миграция 136). The matrix is authoritative; owner-class (director/
 * superadmin) bypasses via PermissionsGuard.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
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

  // ─── Cash-screen actions ('checks_create' — check flow) ────────────────
  @RequirePermission('checks_create')
  @Post('accrue')
  accrue(@CurrentUser() user: JwtPayload, @Body() dto: AccrueBonusDto) {
    return this.loyalty.accrue(user, dto);
  }

  @RequirePermission('checks_create')
  @Post('redeem')
  redeem(@CurrentUser() user: JwtPayload, @Body() dto: RedeemBonusDto) {
    return this.loyalty.redeem(user, dto);
  }

  // ─── Config + manual correction ('settings_manage') ────────────────────
  @RequirePermission('settings_manage')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateLoyaltySettingsDto) {
    return this.loyalty.updateSettings(user.tenantID, dto);
  }

  @RequirePermission('settings_manage')
  @Post('adjust')
  adjust(@CurrentUser() user: JwtPayload, @Body() dto: AdjustBonusDto) {
    return this.loyalty.adjust(user, dto);
  }
}
