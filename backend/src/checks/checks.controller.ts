import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ChecksService } from './checks.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('checks')
export class ChecksController {
  constructor(private checksService: ChecksService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    // Pass the actor so the service can apply the checks_view_all rule: a master
    // without that permission sees only their own checks (master_id = self).
    // Owner-class roles see every check in the tenant. Response shape unchanged.
    return this.checksService.getAll(user.tenantID, query, user);
  }

  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.checksService.getDashboard(user.tenantID);
  }

  @Get('dashboard/chart')
  getDashboardChart(@CurrentUser() user: JwtPayload, @Query('period') period: string, @Query('offset') offset: string) {
    return this.checksService.getDashboardChart(user.tenantID, period, parseInt(offset) || 0);
  }

  @Get('ranking')
  getRanking(@CurrentUser() user: JwtPayload) {
    return this.checksService.getRanking(user.tenantID);
  }

  /**
   * Last visit (most recent check) for a given client and / or car. Used by
   * the cash screen to surface "Последний визит: ..." once a client/car is
   * selected, so the master immediately sees when the customer was here last.
   */
  @Get('last-visit')
  getLastVisit(@CurrentUser() user: JwtPayload, @Query('clientId') clientId?: string, @Query('carId') carId?: string) {
    return this.checksService.getLastVisit(user.tenantID, { clientId, carId });
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checksService.getById(id, user.tenantID);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.checksService.create(user.tenantID, user.userID, user.role, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.checksService.update(id, user.tenantID, user.role, dto, user.userID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checksService.remove(id, user.tenantID, user.role);
  }
}
