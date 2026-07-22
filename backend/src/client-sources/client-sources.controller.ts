import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ClientSourcesService } from './client-sources.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('client-sources')
export class ClientSourcesController {
  constructor(private clientSources: ClientSourcesService) {}

  @Get()
  get(@CurrentUser() user: JwtPayload) {
    return this.clientSources.get(user.tenantID);
  }

  // Справочник источников — часть настроек тенанта: 'settings_manage'
  // (миграция 136); owner-class (director/superadmin) обходит через PermissionsGuard.
  @RequirePermission('settings_manage')
  @Post()
  update(@CurrentUser() user: JwtPayload, @Body() dto: { sources: string[] }) {
    return this.clientSources.update(user.tenantID, dto?.sources);
  }
}
