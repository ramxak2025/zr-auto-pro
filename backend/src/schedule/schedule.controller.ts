import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(private scheduleService: ScheduleService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: any) {
    return this.scheduleService.findAll(user.tenantId, query);
  }

  @Get('work-modes')
  getWorkModes(@CurrentUser() user: any) {
    return this.scheduleService.getWorkModes(user.tenantId);
  }

  @Get('today')
  getToday(@CurrentUser() user: any) {
    return this.scheduleService.getToday(user.tenantId);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.scheduleService.create(body, user.tenantId);
  }

  @Post('work-modes')
  createWorkMode(@Body() body: any, @CurrentUser() user: any) {
    return this.scheduleService.createWorkMode(body, user.tenantId);
  }

  @Patch('work-modes/:id')
  updateWorkMode(@Param('id') id: string, @Body() body: any) {
    return this.scheduleService.updateWorkMode(id, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.scheduleService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.scheduleService.remove(id);
  }
}
