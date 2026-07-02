import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

// Роли (Bitrix24-style, миграция 114) — управление ими эквивалентно правке
// permission-карты сотрудника, поэтому та же owner-class-гейт, что у
// PATCH /users/:id/permissions и permission-templates: director / admin /
// superadmin. Всё тенант-скоуплено в сервисе (системные роли — read-only).
const MANAGER_ROLES = ['director', 'admin', 'superadmin'] as const;

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...MANAGER_ROLES)
@Controller('roles')
export class RolesController {
  constructor(private readonly service: RolesService) {}

  /** Системные + свои роли, системные сверху. */
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.tenantID);
  }

  /** Создать кастомную роль (опционально копией: copyFromRoleId + matrix поверх). */
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRoleDto) {
    return this.service.create(user.tenantID, dto);
  }

  /** Обновить свою роль. Системная → 403 «создайте копию». */
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateRoleDto) {
    return this.service.update(id, user.tenantID, dto);
  }

  /** Удалить свою роль. С назначенными сотрудниками → 400 с count. */
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.tenantID);
  }
}
