import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// Матрица ролей АВТОРИТЕТНА (волна «права как в Битрикс24», 2026-07):
//   • 'schedule_view' (schedule.view) — чтение графика команды. Сид true у
//     всех трёх системных ролей (мастер видит расписание — не запирается).
//   • 'schedule_manage' (schedule.manage) — все мутации (прежний
//     @Roles(director, admin, superadmin); сид: Директор/Админ true, миграция 136).
// my-stats / work-modes GET / settings GET — открыты (self / справочники для
// отображения графика).
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(private scheduleService: ScheduleService) {}

  @RequirePermission('schedule_view')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.scheduleService.getAll(user.tenantID, query);
  }

  @RequirePermission('schedule_view')
  @Get('today')
  getToday(@CurrentUser() user: JwtPayload) {
    return this.scheduleService.getToday(user.tenantID);
  }

  @Get('my-stats')
  getMyStats(@CurrentUser() user: JwtPayload, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.scheduleService.getMyStats(user.tenantID, user.userID, dateFrom, dateTo);
  }

  @Get('work-modes')
  getWorkModes(@CurrentUser() user: JwtPayload) {
    return this.scheduleService.getWorkModes(user.tenantID);
  }

  // ── Per-tenant schedule settings (which statuses count as a shift) ─────
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.scheduleService.getSettings(user.tenantID);
  }

  @RequirePermission('schedule_manage')
  @Post('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() body: { shiftStatuses?: string[] }) {
    return this.scheduleService.updateSettings(user.tenantID, body);
  }

  @RequirePermission('schedule_manage')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.scheduleService.create(user.tenantID, dto);
  }

  @RequirePermission('schedule_manage')
  @Post('work-modes')
  createWorkMode(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.scheduleService.createWorkMode(user.tenantID, dto);
  }

  @RequirePermission('schedule_manage')
  @Post('apply-work-mode')
  applyWorkMode(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.scheduleService.applyWorkMode(user.tenantID, dto);
  }

  @RequirePermission('schedule_manage')
  @Patch('work-modes/:id')
  updateWorkMode(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.scheduleService.updateWorkMode(id, user.tenantID, dto);
  }

  @RequirePermission('schedule_manage')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.scheduleService.update(id, user.tenantID, dto);
  }

  @RequirePermission('schedule_manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.scheduleService.remove(id, user.tenantID);
  }
}
