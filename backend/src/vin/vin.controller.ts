import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { VinService } from './vin.service';
import { DecodeVinDto } from './dto/decode-vin.dto';
import { UpdateVinSettingsDto } from './dto/update-vin-settings.dto';

/**
 * VIN (171, 2026-09-25).
 *
 *   • POST /vin/decode — ЛЮБАЯ роль тенанта: поле VIN в форме машины есть и у
 *     мастера в Кассе. Без @RequirePermission PermissionsGuard — no-op.
 *   • GET/PATCH /vin/settings — ключ 'company_manage', тот же гейт, что у
 *     PATCH /my-company (owner-class обходит внутри userHasPermission).
 *
 * Расшифровка не требует включённой опции: клиенты дёргают её только когда
 * опция включена, а лишний запрет ничего не защищает — VIN и так вводит сам
 * пользователь. Проверка «опция включена» стоит там, где VIN ПИШЕТСЯ (cars).
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('vin')
export class VinController {
  constructor(private vin: VinService) {}

  // 200, а не дефолтные 201 для POST: расшифровка — запрос, а не создание
  // (контракт createVinApi: некорректный VIN → 200 { valid:false }).
  @HttpCode(HttpStatus.OK)
  @Post('decode')
  decode(@CurrentUser() user: JwtPayload, @Body() dto: DecodeVinDto) {
    return this.vin.decode(user.tenantID, dto.vin);
  }

  @RequirePermission('company_manage')
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.vin.getSettings(user.tenantID);
  }

  @RequirePermission('company_manage')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateVinSettingsDto) {
    return this.vin.updateSettings(user.tenantID, dto);
  }
}
