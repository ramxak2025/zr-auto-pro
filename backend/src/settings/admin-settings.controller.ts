import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { PlatformSettingsService } from './platform-settings.service';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

/**
 * Глобальные настройки платформы (супер-админ). Живут под /admin — как
 * AdminAuditController: тот же глобальный JwtAuthGuard плюс локальный RolesGuard,
 * @Roles('superadmin') на каждом методе. Роуты не пересекаются с
 * /admin/audit-log и /admin/mrr-trends, поэтому два контроллера с префиксом
 * 'admin' сосуществуют штатно.
 *
 * Полный путь (setGlobalPrefix('api')): GET/PATCH /api/admin/settings.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Roles('superadmin')
  @Get('settings')
  get() {
    return this.settings.getSettings();
  }

  @Roles('superadmin')
  @Patch('settings')
  update(@Body() dto: UpdatePlatformSettingsDto) {
    return this.settings.updateSettings(dto);
  }
}
