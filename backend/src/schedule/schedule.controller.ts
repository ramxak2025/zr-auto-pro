import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(private scheduleService: ScheduleService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.scheduleService.getAll(user.tenantID, query);
  }

  @Get('today')
  getToday(@CurrentUser() user: JwtPayload) {
    return this.scheduleService.getToday(user.tenantID);
  }

  @Get('my-stats')
  getMyStats(@CurrentUser() user: JwtPayload) {
    return this.scheduleService.getMyStats(user.tenantID, user.userID);
  }

  @Get('work-modes')
  getWorkModes(@CurrentUser() user: JwtPayload) {
    return this.scheduleService.getWorkModes(user.tenantID);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.scheduleService.create(user.tenantID, dto);
  }

  @Post('work-modes')
  createWorkMode(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.scheduleService.createWorkMode(user.tenantID, dto);
  }

  @Patch('work-modes/:id')
  updateWorkMode(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.scheduleService.updateWorkMode(id, user.tenantID, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.scheduleService.update(id, user.tenantID, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.scheduleService.remove(id, user.tenantID);
  }
}
