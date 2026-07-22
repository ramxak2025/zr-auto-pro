import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
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
 * Matrix-gated (миграция 136; owner-class director/superadmin bypasses via
 * PermissionsGuard): settings → 'settings_manage'; `fiscalize` is part of the
 * check flow → 'checks_create' (master seed true — the cash screen keeps
 * working); `GET receipt/:checkId` → 'checks_view' (tenant-scoped in service).
 *
 * INERT until configured: `fiscalize` returns 422 until the owner enters a real
 * АТОЛ login + password + group_code AND flips `enabled` on.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('fiscal')
export class FiscalController {
  constructor(private fiscal: FiscalService) {}

  // ─── Config ('settings_manage'). Literal routes BEFORE param routes. ──────
  @RequirePermission('settings_manage')
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.fiscal.getSettings(user.tenantID);
  }

  @RequirePermission('settings_manage')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateFiscalSettingsDto) {
    return this.fiscal.updateSettings(user.tenantID, dto);
  }

  // ─── Fiscalize a check ('checks_create' — check flow) ─────────────────────
  @RequirePermission('checks_create')
  @Post('fiscalize')
  fiscalize(@CurrentUser() user: JwtPayload, @Body() dto: FiscalizeDto) {
    return this.fiscal.fiscalize(user, dto);
  }

  // ─── Latest receipt for a check ('checks_view'; tenant-scoped) ────────────
  @RequirePermission('checks_view')
  @Get('receipt/:checkId')
  getReceipt(@CurrentUser() user: JwtPayload, @Param('checkId') checkId: string) {
    return this.fiscal.getReceiptForCheck(user.tenantID, checkId);
  }
}
