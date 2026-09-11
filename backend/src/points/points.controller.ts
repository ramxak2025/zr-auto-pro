import { Controller, Get, Post, Patch, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PointsService } from './points.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { AllowNoTenant } from '../common/decorators/allow-no-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

/**
 * Тенант-сторона мульти-точек (миграция 156): список точек своего тенанта,
 * переключение текущей точки, назначение сотрудников на точки.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('points')
export class PointsController {
  constructor(private pointsService: PointsService) {}

  /** Живые точки тенанта + назначения + моя текущая точка. Читает любой. */
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.pointsService.listForTenant(user);
  }

  /**
   * Сводка по филиалам для карточек раздела «Филиалы»: оборот дня/месяца,
   * прибыль месяца, число чеков, мастеров на работе — на каждую живую точку.
   *
   * Гейт — `financial_reports` (перекрывает классовое «читает любой»): это
   * выручка и прибыль всей сети, мастеру их видеть нельзя. Прибыль внутри
   * дополнительно закрыта `profit_view` — см. PointsService.summaryForTenant.
   */
  @RequirePermission('financial_reports')
  @Get('summary')
  summary(@CurrentUser() user: JwtPayload) {
    return this.pointsService.summaryForTenant(user);
  }

  /**
   * СМЕНА ФИЛИАЛА ДЛЯ СБОРОК 3.5/3.6 (165): ручка пишет ПОДСКАЗКУ следующего
   * входа и отвечает успехом; филиал текущей сессии не меняется — он в
   * подписанном токене. Новый UI сюда не ходит (смена филиала = выход и вход).
   * Полное обоснование — PointsService.switchPoint.
   */
  @Post('switch')
  switch(@CurrentUser() user: JwtPayload, @Body() dto: { pointId?: string | null }) {
    return this.pointsService.switchPoint(user, dto?.pointId ?? null);
  }

  /**
   * Заменить состав сотрудников филиала — управление персоналом.
   * Сторона раздела «Филиалы»; новый UI настраивает доступ в карточке
   * сотрудника (PUT /users/:id/points), но правило и последствия у обеих
   * сторон общие (PointsService.applyMembership).
   */
  @RequirePermission('user_management')
  @Put(':id/members')
  setMembers(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { userIds?: string[] }) {
    return this.pointsService.setMembers(user.tenantID, id, dto?.userIds ?? []);
  }
}

/**
 * ДОСТУП СОТРУДНИКА К ФИЛИАЛАМ СО СТОРОНЫ ЕГО КАРТОЧКИ (163) — та самая
 * «настройка, на каких филиалах они могут работать».
 *
 * Отдельный контроллер в ЭТОМ модуле, а не метод UsersController: данные —
 * user_points, правило и последствия снятия доступа живут в PointsService, и
 * второй копии этого правила в модуле пользователей быть не должно. Путь
 * при этом пользовательский, потому что экран — карточка сотрудника.
 *
 * Скоуп строго по тенанту актора: сотрудников чужого тенанта здесь не видно
 * (для суперадмина есть вход под владельцем).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('user_management')
@Controller('users/:userId/points')
export class UserPointsController {
  constructor(private pointsService: PointsService) {}

  /** Набор филиалов сотрудника. Пусто = не ограничен (доступны все живые). */
  @Get()
  list(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return this.pointsService.getUserPoints(user.tenantID, userId);
  }

  /** Заменить набор целиком. Пустой массив = снять ограничение. */
  @Put()
  replace(@Param('userId') userId: string, @CurrentUser() user: JwtPayload, @Body() dto: { pointIds?: string[] }) {
    return this.pointsService.setUserPoints(user.tenantID, userId, dto?.pointIds ?? []);
  }
}

/**
 * Суперадмин-CRUD точек в ЛК (карточка тенанта). Точки заводит ТОЛЬКО
 * суперадмин — их количество и есть «лимит точек» тенанта. Tenant-less
 * записи легитимны (@AllowNoTenant, конвенция TenantsController).
 */
@AllowNoTenant()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tenants/:tenantId/points')
export class AdminPointsController {
  constructor(private pointsService: PointsService) {}

  @Roles('superadmin')
  @Get()
  list(@Param('tenantId') tenantId: string) {
    return this.pointsService.adminList(tenantId);
  }

  @Roles('superadmin')
  @Post()
  create(@Param('tenantId') tenantId: string, @Body() dto: { name?: string; address?: string }) {
    return this.pointsService.adminCreate(tenantId, dto);
  }

  @Roles('superadmin')
  @Patch(':pointId')
  update(
    @Param('tenantId') tenantId: string,
    @Param('pointId') pointId: string,
    @Body() dto: { name?: string; address?: string; isActive?: boolean; sortOrder?: number },
  ) {
    return this.pointsService.adminUpdate(tenantId, pointId, dto);
  }

  /** «Удалить» = архив (is_active=false), паттерн 146. */
  @Roles('superadmin')
  @Delete(':pointId')
  remove(@Param('tenantId') tenantId: string, @Param('pointId') pointId: string) {
    return this.pointsService.adminArchive(tenantId, pointId);
  }
}
