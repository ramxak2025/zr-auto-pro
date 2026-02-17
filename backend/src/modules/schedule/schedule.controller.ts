import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('schedule')
@UseGuards(JwtAuthGuard)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  async getSchedule(
    @Req() req: any,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.scheduleService.getSchedule(tenantId, dateFrom, dateTo);
  }

  @Post()
  async createEntry(@Req() req: any, @Body() dto: any) {
    dto.tenantId = req.user.tenantId;
    return this.scheduleService.createEntry(dto);
  }

  @Get('work-modes')
  async getWorkModes(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.scheduleService.getWorkModes(tenantId);
  }

  @Post('work-modes')
  async createWorkMode(@Req() req: any, @Body() dto: any) {
    dto.tenantId = req.user.tenantId;
    return this.scheduleService.createWorkMode(dto);
  }

  @Patch('work-modes/:id')
  async updateWorkMode(@Param('id') id: string, @Body() dto: any) {
    return this.scheduleService.updateWorkMode(id, dto);
  }

  @Get('today')
  async getTodayStatus(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.scheduleService.getTodayStatus(tenantId);
  }

  @Patch(':id')
  async updateEntry(@Param('id') id: string, @Body() dto: any) {
    return this.scheduleService.updateEntry(id, dto);
  }

  @Delete(':id')
  async deleteEntry(@Param('id') id: string) {
    await this.scheduleService.deleteEntry(id);
    return { message: 'Schedule entry deleted successfully' };
  }
}
