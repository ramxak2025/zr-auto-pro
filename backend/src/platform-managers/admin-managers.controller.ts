import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AllowNoTenant } from '../common/decorators/allow-no-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { ParseUuidParam } from '../common/parse-uuid.pipe';
import { AuditActor, AuditService } from '../tenants/audit.service';
import { AdminManagersService } from './admin-managers.service';
import {
  CreateManagerDto,
  CreateSettlementDto,
  TransferTenantManagerDto,
  UpdateManagerDto,
} from './dto/admin-managers.dto';

/**
 * Кабинет СУПЕРАДМИНА: менеджеры платформы, их доля и взаиморасчёты.
 *
 * Каждый маршрут — строго `@Roles('superadmin')`. Менеджер (роль `manager`) сюда не
 * проходит: RolesGuard пропускает только перечисленные роли (плюс суперадмина).
 * `@AllowNoTenant()` — суперадмин пишет без тенанта, это штатный режим (блокировка
 * записей без тенанта его не касается, но метка нужна для единообразия с TenantsController).
 */
@AllowNoTenant()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/managers')
export class AdminManagersController {
  constructor(
    private managers: AdminManagersService,
    private audit: AuditService,
  ) {}

  private async actor(user: JwtPayload): Promise<AuditActor> {
    return { userId: user.userID, name: await this.audit.resolveActorName(user.userID) };
  }

  /** Все менеджеры со сводкой: клиенты, оплаты и доля за месяц, баланс. */
  @Roles('superadmin')
  @Get()
  list() {
    return this.managers.list();
  }

  /** Завести менеджера. Телефон занят → 409 `{ message, code: 'PHONE_TAKEN' }`. */
  @Roles('superadmin')
  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateManagerDto) {
    return this.managers.create(dto, await this.actor(user));
  }

  @Roles('superadmin')
  @Get(':id')
  get(@Param('id', ParseUuidParam) id: string) {
    return this.managers.get(id);
  }

  @Roles('superadmin')
  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUuidParam) id: string,
    @Body() dto: UpdateManagerDto,
  ) {
    return this.managers.update(id, dto, await this.actor(user));
  }

  /** Платежи (со снимком доли) и расчёты менеджера; `months` — окно лент 1..36 (по умолчанию 12), баланс — за всё время. */
  @Roles('superadmin')
  @Get(':id/ledger')
  ledger(@Param('id', ParseUuidParam) id: string, @Query('months') months?: string) {
    return this.managers.ledger(id, months);
  }

  @Roles('superadmin')
  @Post(':id/settlements')
  async addSettlement(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUuidParam) id: string,
    @Body() dto: CreateSettlementDto,
  ) {
    return this.managers.addSettlement(id, dto, await this.actor(user));
  }

  @Roles('superadmin')
  @Delete(':id/settlements/:settlementId')
  async removeSettlement(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUuidParam) id: string,
    @Param('settlementId', ParseUuidParam) settlementId: string,
  ) {
    return this.managers.removeSettlement(id, settlementId, await this.actor(user));
  }
}

/**
 * PATCH /admin/tenants/:tenantId/manager — передача автосервиса другому менеджеру
 * (или снятие с менеджера, `managerId: null`). Отдельный контроллер: маршрут лежит под
 * `/admin/tenants`, а не `/admin/managers`, и это единственная его ручка.
 */
@AllowNoTenant()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/tenants')
export class AdminTenantManagerController {
  constructor(
    private managers: AdminManagersService,
    private audit: AuditService,
  ) {}

  @Roles('superadmin')
  @Patch(':tenantId/manager')
  async transfer(
    @CurrentUser() user: JwtPayload,
    @Param('tenantId', ParseUuidParam) tenantId: string,
    @Body() dto: TransferTenantManagerDto,
  ) {
    const actor: AuditActor = { userId: user.userID, name: await this.audit.resolveActorName(user.userID) };
    return this.managers.transferTenant(tenantId, dto.managerId, actor);
  }
}
