import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { FiscalService } from './fiscal.service';
import { UpdateFiscalSettingsDto } from './dto/update-fiscal-settings.dto';
import { FiscalizeDto } from './dto/fiscalize.dto';

/**
 * Онлайн-касса / фискализация 54-ФЗ (АТОЛ Онлайн) — tenant-scoped from the JWT.
 *
 * AUTHENTICATED controller: JwtAuthGuard is applied here at the class level, the
 * same opt-in pattern every other controller uses. АТОЛ is POLL-based, so there is
 * NO public webhook route in this module (unlike payments).
 *
 * Config (settings) is owner-class only. `fiscalize` is gated to the cashier-
 * capable set (director/admin/master/superadmin) — the roles that work the cash
 * screen and close checks. `GET receipt/:checkId` is open to any tenant user but is
 * tenant-scoped so it only ever returns this tenant's receipt.
 *
 * INERT until configured: `fiscalize` returns 422 until the owner enters a real
 * АТОЛ login + password + group_code AND flips `enabled` on.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('fiscal')
export class FiscalController {
  constructor(private fiscal: FiscalService) {}

  // ─── Config (owner-class only). Literal routes BEFORE param routes. ───────
  @Roles('director', 'admin', 'superadmin')
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.fiscal.getSettings(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateFiscalSettingsDto) {
    return this.fiscal.updateSettings(user.tenantID, dto);
  }

  // ─── Fiscalize a check (cashier-capable roles) ────────────────────────────
  @Roles('director', 'admin', 'master', 'superadmin')
  @Post('fiscalize')
  fiscalize(@CurrentUser() user: JwtPayload, @Body() dto: FiscalizeDto) {
    return this.fiscal.fiscalize(user, dto);
  }

  // ─── Latest receipt for a check (any tenant user; tenant-scoped) ──────────
  @Get('receipt/:checkId')
  getReceipt(@CurrentUser() user: JwtPayload, @Param('checkId') checkId: string) {
    return this.fiscal.getReceiptForCheck(user.tenantID, checkId);
  }
}
