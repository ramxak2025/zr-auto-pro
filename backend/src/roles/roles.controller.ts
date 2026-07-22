import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

// Роли (Bitrix24-style, миграция 114) — управление ими эквивалентно правке
// permission-карты сотрудника, поэтому тот же матричный ключ, что у
// users-management-роутов: 'user_management' (owner-class director/superadmin
// обходит; admin — по матрице его роли, системный «Администратор» — true;
// мастер — false). Всё тенант-скоуплено в сервисе.
//
// Системные роли (миграция 121): правка «Мастера»/«Администратора» → сервис
// делает copy-on-write (тенантный override, глобальный шаблон не трогается);
// «Директор» — вечно read-only (403). Кастомные роли правятся на месте.
// Инварианты против самоэскалации (R6) живут в RolesService.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('user_management')
@Controller('roles')
export class RolesController {
  constructor(private readonly service: RolesService) {}

  /** Системные + свои роли, системные сверху. */
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.tenantID);
  }

  /** Создать кастомную роль (опционально копией: copyFromRoleId + matrix поверх).
   *  Актор прокинут для R6/E-6 (assertPrivilegeCeiling): не-owner-класс не может
   *  поднять ни одну ячейку выше собственных прав (потолок привилегий), а
   *  owner-only права (salary.payouts / equipment.permanentDelete /
   *  settings.company / employees.approveProfile) — выдать вообще. */
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRoleDto) {
    return this.service.create(user.tenantID, dto, user);
  }

  /** Обновить роль. Кастомная — на месте; «Мастер»/«Администратор» — copy-on-write
   *  (тенантный override); «Директор» → 403. См. RolesService.update.
   *  Актор прокинут для R6 — см. create(). */
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateRoleDto) {
    return this.service.update(id, user.tenantID, dto, user);
  }

  /** Удалить свою роль. С назначенными сотрудниками → 400 с count. */
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.tenantID);
  }
}
