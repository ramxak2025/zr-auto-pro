import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { StarterCatalogsService } from './starter-catalogs.service';
import { STARTER_DIRECTIONS, STARTER_VERSION } from './starter-manifest';
@Controller('starter-catalogs')
export class StarterCatalogsController {
  constructor(private readonly service: StarterCatalogsService) {}
  @Get() directions() {
    return { directions: STARTER_DIRECTIONS, version: STARTER_VERSION };
  }
  @Post('preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('director', 'superadmin')
  preview(@CurrentUser() actor: JwtPayload, @Body() body: unknown) {
    return this.service.preview(actor.tenantID, actor, body);
  }
  @Post('install')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('director', 'superadmin')
  install(@CurrentUser() actor: JwtPayload, @Body() body: unknown) {
    return this.service.install(actor.tenantID, actor, body);
  }
}
