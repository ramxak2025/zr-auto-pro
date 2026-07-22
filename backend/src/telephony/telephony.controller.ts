import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { TelephonyService } from './telephony.service';
import { UpdateTelephonySettingsDto } from './dto/update-telephony-settings.dto';

/**
 * Телефония (Mango Office) — tenant-scoped config from the JWT.
 *
 * AUTHENTICATED controller: JwtAuthGuard is applied here at the class level — the
 * same opt-in pattern every other controller uses (there is NO global JWT guard in
 * this project, only RateLimitGuard is global in main.ts). The PUBLIC webhook lives
 * in a SEPARATE controller (telephony-webhook.controller.ts) that simply does NOT
 * apply JwtAuthGuard — that is how Mango reaches us without a token, with the
 * authenticated surface left fully intact.
 *
 * Config (settings) rides the class-level 'settings_manage' matrix cell
 * (миграция 136) — the matrix is authoritative; owner-class (director/
 * superadmin) bypasses via PermissionsGuard. The Mango api_key / api_salt are
 * WRITE-ONLY — getSettings returns only masks + "configured" flags, never the
 * raw secrets.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('settings_manage')
@Controller('telephony')
export class TelephonyController {
  constructor(private telephony: TelephonyService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.telephony.getSettings(user.tenantID);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateTelephonySettingsDto) {
    return this.telephony.updateSettings(user.tenantID, dto);
  }
}
