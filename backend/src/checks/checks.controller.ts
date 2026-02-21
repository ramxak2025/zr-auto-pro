import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ChecksService } from './checks.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('checks')
export class ChecksController {
  constructor(private checksService: ChecksService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.checksService.getAll(user.tenantID, query);
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
    return this.checksService.update(id, user.tenantID, user.role, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checksService.remove(id, user.tenantID, user.role);
  }
}
