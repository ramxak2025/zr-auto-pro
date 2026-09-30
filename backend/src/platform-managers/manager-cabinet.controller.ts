import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AllowNoTenant } from '../common/decorators/allow-no-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { ParseUuidParam } from '../common/parse-uuid.pipe';
import { AssignPlanDto } from '../tenants/dto/subscription.dto';
import {
  CreateManagerTenantDto,
  ManagerExtendDto,
  ManagerSuspendDto,
  ResetOwnerPasswordDto,
} from './dto/manager-cabinet.dto';
import { ManagerCabinetService } from './manager-cabinet.service';
import { cabinetActor } from './manager-scope';

/**
 * Кабинет МЕНЕДЖЕРА платформы: только его клиенты, его деньги, его журнал.
 *
 * ГРАНИЦА ДОСТУПА держится в трёх местах, и каждое достаточно само по себе:
 *   1. `@Roles('manager', 'superadmin')` на КАЖДОМ методе (тест managers-scope.test.cjs
 *      проверяет это регуляркой по исходнику). Без `@Roles` RolesGuard пропускает всех
 *      залогиненных — поэтому метод без декоратора здесь недопустим;
 *   2. `cabinetActor(user)` в каждом методе — «второй замок»: роль вне {manager,
 *      superadmin} и невалидный userID дают 403 даже если декоратор кто-то потеряет;
 *   3. `actor.scope.managerId` уходит в сервис: каждый запрос к `tenants` получает
 *      `manager_id = $N`, чужой клиент — 404.
 *
 * `@AllowNoTenant()` — менеджер живёт без тенанта (tenant_id NULL), его записи в кабинете
 * (создание клиента, продления, расчёты) — легитимные записи без тенанта.
 */
@AllowNoTenant()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('manager')
export class ManagerCabinetController {
  constructor(private cabinet: ManagerCabinetService) {}

  /** Клиенты по статусам, оплаты месяца, моя доля, долг владельцу, потолок бесплатных дней. */
  @Roles('manager', 'superadmin')
  @Get('summary')
  summary(@CurrentUser() user: JwtPayload) {
    return this.cabinet.summary(cabinetActor(user));
  }

  /** Свои клиенты; `status` — active | expired | suspended. */
  @Roles('manager', 'superadmin')
  @Get('tenants')
  listTenants(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.cabinet.listTenants(cabinetActor(user), status);
  }

  /** Завести автосервис (тенант + владелец + пробный период) за собой. */
  @Roles('manager', 'superadmin')
  @Post('tenants')
  createTenant(@CurrentUser() user: JwtPayload, @Body() dto: CreateManagerTenantDto) {
    return this.cabinet.createTenant(cabinetActor(user), dto);
  }

  @Roles('manager', 'superadmin')
  @Get('tenants/:id')
  getTenant(@CurrentUser() user: JwtPayload, @Param('id', ParseUuidParam) id: string) {
    return this.cabinet.getTenant(cabinetActor(user), id);
  }

  @Roles('manager', 'superadmin')
  @Get('tenants/:id/cabinet')
  getCabinet(@CurrentUser() user: JwtPayload, @Param('id', ParseUuidParam) id: string) {
    return this.cabinet.getCabinet(cabinetActor(user), id);
  }

  @Roles('manager', 'superadmin')
  @Post('tenants/:id/extend')
  extend(@CurrentUser() user: JwtPayload, @Param('id', ParseUuidParam) id: string, @Body() dto: ManagerExtendDto) {
    return this.cabinet.extend(cabinetActor(user), id, dto);
  }

  @Roles('manager', 'superadmin')
  @Post('tenants/:id/assign-plan')
  assignPlan(@CurrentUser() user: JwtPayload, @Param('id', ParseUuidParam) id: string, @Body() dto: AssignPlanDto) {
    return this.cabinet.assignPlan(cabinetActor(user), id, dto.planId);
  }

  @Roles('manager', 'superadmin')
  @Post('tenants/:id/suspend')
  suspend(@CurrentUser() user: JwtPayload, @Param('id', ParseUuidParam) id: string, @Body() dto: ManagerSuspendDto) {
    return this.cabinet.suspend(cabinetActor(user), id, dto.reason);
  }

  @Roles('manager', 'superadmin')
  @Post('tenants/:id/unsuspend')
  unsuspend(@CurrentUser() user: JwtPayload, @Param('id', ParseUuidParam) id: string, @Body() dto: ManagerSuspendDto) {
    return this.cabinet.unsuspend(cabinetActor(user), id, dto.reason);
  }

  /** Вход под владельцем своего клиента: обычный токен директора на 30 минут, действие пишется в журнал. */
  @Roles('manager', 'superadmin')
  @Post('tenants/:id/impersonate')
  impersonate(@CurrentUser() user: JwtPayload, @Param('id', ParseUuidParam) id: string) {
    return this.cabinet.impersonate(cabinetActor(user), id);
  }

  @Roles('manager', 'superadmin')
  @Post('tenants/:id/reset-owner-password')
  resetOwnerPassword(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUuidParam) id: string,
    @Body() dto: ResetOwnerPasswordDto,
  ) {
    return this.cabinet.resetOwnerPassword(cabinetActor(user), id, dto.password);
  }

  /** Мои платежи (со снимком доли) и расчёты с владельцем; `months` — окно лент 1..36, баланс — за всё время. */
  @Roles('manager', 'superadmin')
  @Get('ledger')
  ledger(@CurrentUser() user: JwtPayload, @Query('months') months?: string) {
    return this.cabinet.ledger(cabinetActor(user), months);
  }

  /** Журнал моих действий (записи, где актор — я). */
  @Roles('manager', 'superadmin')
  @Get('audit-log')
  auditLog(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.cabinet.auditLog(cabinetActor(user), limit, offset);
  }
}
