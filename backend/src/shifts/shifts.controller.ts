import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private shiftsService: ShiftsService) {}

  // Список смен ВСЕЙ команды — 'schedule_view' (сид true у всех трёх системных
  // ролей — никого не запирает; кастомная роль без ячейки — 403, fail-closed).
  @RequirePermission('schedule_view')
  @Get()
  getAll(@CurrentUser() user: JwtPayload) {
    // Актор целиком — сервису нужна его текущая точка (161).
    return this.shiftsService.getAll(user.tenantID, user);
  }

  // Self-роуты: свои смены и открытие СВОЕЙ смены — без permission-гейта
  // (мастер обязан открывать свою смену; сервис работает от user.userID).
  @Get('my')
  getMy(@CurrentUser() user: JwtPayload) {
    return this.shiftsService.getMy(user.userID, user.tenantID);
  }

  @Post('open')
  open(@CurrentUser() user: JwtPayload) {
    // Смена штампуется текущим филиалом открывающего (161).
    return this.shiftsService.open(user.userID, user.tenantID, user);
  }

  // Открытый роут: свою смену закрывает любой; ЧУЖУЮ — только держатель
  // 'schedule_manage' (проверка в сервисе по актору).
  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.shiftsService.close(id, user.tenantID, user);
  }
}
