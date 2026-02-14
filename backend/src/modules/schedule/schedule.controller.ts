import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

@Controller('schedule')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  // ─── Work Modes ─────────────────────────────────────────────

  @Get('work-modes')
  getWorkModes(@TenantId() tenantId: string) {
    return this.scheduleService.getWorkModes(tenantId);
  }

  @Post('work-modes')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user_management')
  createWorkMode(@TenantId() tenantId: string, @Body() dto: any) {
    return this.scheduleService.createWorkMode(tenantId, dto);
  }

  @Patch('work-modes/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user_management')
  updateWorkMode(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.scheduleService.updateWorkMode(tenantId, id, dto);
  }

  @Delete('work-modes/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user_management')
  deleteWorkMode(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.scheduleService.deleteWorkMode(tenantId, id);
  }

  // ─── Schedule ───────────────────────────────────────────────

  @Get()
  getSchedule(
    @TenantId() tenantId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('userId') userId?: string,
  ) {
    return this.scheduleService.getSchedule(tenantId, dateFrom, dateTo, userId);
  }

  @Post('generate')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user_management')
  generateSchedule(
    @TenantId() tenantId: string,
    @Body() dto: {
      userId: string;
      workModeId: string;
      dateFrom: string;
      dateTo: string;
      startOffset?: number;
    },
  ) {
    return this.scheduleService.generateSchedule(
      tenantId,
      dto.userId,
      dto.workModeId,
      dto.dateFrom,
      dto.dateTo,
      dto.startOffset,
    );
  }

  @Post('entry')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user_management')
  createEntry(
    @TenantId() tenantId: string,
    @Body() dto: {
      userId: string;
      date: string;
      isDayOff?: boolean;
      shiftStart?: string;
      shiftEnd?: string;
      note?: string;
    },
  ) {
    return this.scheduleService.createScheduleEntry(tenantId, dto);
  }

  @Patch('entry/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('user_management')
  updateEntry(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.scheduleService.updateScheduleEntry(tenantId, id, dto);
  }

  // ─── Dashboard ──────────────────────────────────────────────

  @Get('today-status')
  getTodayStatus(@TenantId() tenantId: string) {
    return this.scheduleService.getTodayStatus(tenantId);
  }
}
