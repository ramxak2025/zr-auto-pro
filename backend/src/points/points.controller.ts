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
   * Переключить СВОЮ текущую точку (pointId: null = сбросить). Мастера —
   * только на назначенные им точки; проверка в сервисе.
   */
  @Post('switch')
  switch(@CurrentUser() user: JwtPayload, @Body() dto: { pointId?: string | null }) {
    return this.pointsService.switchPoint(user, dto?.pointId ?? null);
  }

  /** Заменить состав сотрудников точки — управление персоналом. */
  @RequirePermission('user_management')
  @Put(':id/members')
  setMembers(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { userIds?: string[] }) {
    return this.pointsService.setMembers(user.tenantID, id, dto?.userIds ?? []);
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
