import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ClientSourcesService } from './client-sources.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('client-sources')
export class ClientSourcesController {
  constructor(private clientSources: ClientSourcesService) {}

  @Get()
  get(@CurrentUser() user: JwtPayload) {
    return this.clientSources.get(user.tenantID);
  }

  // Owner / director / admin only — masters never reconfigure tenant settings.
  @Roles('director', 'admin', 'superadmin')
  @Post()
  update(@CurrentUser() user: JwtPayload, @Body() dto: { sources: string[] }) {
    return this.clientSources.update(user.tenantID, dto?.sources);
  }
}
