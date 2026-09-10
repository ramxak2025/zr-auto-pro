import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId } from '../common/point-scope';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetRateDto } from './dto/set-rate.dto';

// Управление сотрудниками (create / update / delete / reorder /
// per-product commissions) — под матричным ключом 'user_management' (волна
// «права как в Битрикс24», 2026-07): owner-class (director/superadmin) обходит,
// admin решается матрицей его роли (системный «Администратор» — true), мастер —
// false. Update-путь — это одновременно путь эскалации роли (UpdateUserDto.role
// honoured by the service), защита от самоповышения — assertCanAssignRole в
// UsersService. Self-avatar updates go through /auth/avatar — never this
// controller. Открытые GET (/, /masters, /:id) — пикеры мастеров в Кассе и
// расписании, нужны всем аутентифицированным.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // 161 — `?scope=point` ЯВНО просит список сотрудников ТЕКУЩЕГО филиала (по
  // назначениям user_points). Без параметра список прежний, на весь тенант:
  // им резолвятся имена в журнале / расходах / зарплате и им же владелец
  // назначает людей на точки. Скоуп просит ровно тот экран, где чужой
  // сотрудник означает неверные деньги, — пикер мастера в Кассе.
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query('scope') scope?: string) {
    return this.usersService.getAll(user.tenantID, scope === 'point' ? actorPointId(user) : null);
  }

  @Get('masters')
  getMasters(@CurrentUser() user: JwtPayload, @Query('scope') scope?: string) {
    return this.usersService.getMasters(user.tenantID, scope === 'point' ? actorPointId(user) : null);
  }

  // ─── «Уволенные» (dismissed recycle bin) ────────────────────────────
  // Declared BEFORE the `:id` route so "dismissed" isn't captured as an id.

  @RequirePermission('user_management')
  @Get('dismissed')
  getDismissed(@CurrentUser() user: JwtPayload) {
    return this.usersService.listDismissed(user.tenantID);
  }

  @RequirePermission('user_management')
  @Post(':id/restore')
  async restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.restore(id, tenantID);
  }

  // "Delete completely" — keeps the row (FK/history) but hides it forever.
  @RequirePermission('user_management')
  @Post(':id/purge')
  async purge(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.purge(id, tenantID, user.userID);
  }

  @RequirePermission('user_management')
  @Post('order')
  updateOrder(@CurrentUser() user: JwtPayload, @Body() dto: { orderedIds: string[] }) {
    return this.usersService.updateOrder(user.tenantID, dto.orderedIds);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.getById(id, tenantID);
  }

  @RequirePermission('user_management')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    // Superadmin adds an employee INTO a specific tenant from the admin cabinet
    // (dto.tenantId = target). Everyone else can only create inside their own
    // tenant — dto.tenantId is ignored so a director can't seed users in other
    // tenants. Without this, a superadmin (whose own tenant is the nil-UUID
    // sentinel) hit a tenant_id FK violation → «автосервис не найден».
    const targetTenant = user.role === 'superadmin' && dto.tenantId ? dto.tenantId : user.tenantID;
    // user.permissions — эффективная (flatten) карта актора для потолка назначения
    // роли (E-6): нельзя назначить роль с правами выше своих (assertRoleAssignable).
    return this.usersService.create(targetTenant, user.role, dto, user.permissions);
  }

  @RequirePermission('user_management')
  @Patch(':id')
  async update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateUserDto) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    // user.permissions — эффективная карта актора для потолка назначения роли (E-6).
    return this.usersService.update(id, tenantID, user.role, user.userID, dto, user.permissions);
  }

  @RequirePermission('user_management')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.remove(id, tenantID, user.userID, user.role);
  }

  // ─── Ставка по месяцам (Round 14, миграция 150) ─────────────────────
  // Смена процента мастера «за месяц X»: прошлый месяц — пересчёт ТОЛЬКО его
  // начислений новой ставкой; текущий — плюс UPDATE users.* (запекание новых
  // чеков); будущий — история + cron-перенос при наступлении месяца.

  @RequirePermission('user_management')
  @Patch(':id/rate')
  async setRate(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: SetRateDto) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.setRate(id, tenantID, user.userID, dto);
  }

  @RequirePermission('user_management')
  @Get(':id/rate-history')
  async getRateHistory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.listRateHistory(id, tenantID);
  }

  // ─── Action Permissions (server-enforced, ROLE-ONLY) ───────────────
  // Персональные users.permissions удалены (консолидация 2026-07). Права
  // сотрудника задаёт назначенная роль — PATCH /users/:id { roleId }. Эндпоинты
  // GET/PATCH /users/:id/permissions (per-user override) сняты. Осталось только
  // чтение ЭФФЕКТИВНЫХ прав ниже — для UI экрана роли / карточки сотрудника.

  // ЭФФЕКТИВНЫЕ права (плоско): flatten(матрицы назначенной роли), прогнанные
  // через ту же userHasPermission, что и серверный enforcement.
  @RequirePermission('user_management')
  @Get(':id/effective-permissions')
  async getEffectivePermissions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.getEffectivePermissions(id, tenantID);
  }

  // ─── Product Commissions ────────────────────────────────────────────

  @RequirePermission('user_management')
  @Get(':id/product-commissions')
  getProductCommissions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.getProductCommissions(id, user.tenantID);
  }

  @RequirePermission('user_management')
  @Post(':id/product-commissions')
  setProductCommissions(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { productSalaryPercent: number; items: Array<{ productId: string; percent: number }> },
  ) {
    return this.usersService.setProductCommissions(id, user.tenantID, dto);
  }
}
