import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSectionVisibilityDto } from './dto/section-visibility.dto';
import { UpdateItemVisibilityDto } from './dto/item-visibility.dto';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';

// Roles allowed to manage other users (create / update / delete / reorder /
// edit per-product commissions). Masters and admin-light users CANNOT touch
// other accounts because the update path is also the role-escalation path
// (UpdateUserDto.role is honoured by the service). Self-avatar updates go
// through /auth/avatar — never this controller.
const MANAGER_ROLES = ['director', 'admin', 'superadmin'] as const;

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload) {
    return this.usersService.getAll(user.tenantID);
  }

  @Get('masters')
  getMasters(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMasters(user.tenantID);
  }

  // ─── «Уволенные» (dismissed recycle bin) ────────────────────────────
  // Declared BEFORE the `:id` route so "dismissed" isn't captured as an id.

  @Roles(...MANAGER_ROLES)
  @Get('dismissed')
  getDismissed(@CurrentUser() user: JwtPayload) {
    return this.usersService.listDismissed(user.tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Post(':id/restore')
  async restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.restore(id, tenantID);
  }

  // "Delete completely" — keeps the row (FK/history) but hides it forever.
  @Roles(...MANAGER_ROLES)
  @Post(':id/purge')
  async purge(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.purge(id, tenantID, user.userID);
  }

  @Roles(...MANAGER_ROLES)
  @Post('order')
  updateOrder(@CurrentUser() user: JwtPayload, @Body() dto: { orderedIds: string[] }) {
    return this.usersService.updateOrder(user.tenantID, dto.orderedIds);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.getById(id, tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    // Superadmin adds an employee INTO a specific tenant from the admin cabinet
    // (dto.tenantId = target). Everyone else can only create inside their own
    // tenant — dto.tenantId is ignored so a director can't seed users in other
    // tenants. Without this, a superadmin (whose own tenant is the nil-UUID
    // sentinel) hit a tenant_id FK violation → «автосервис не найден».
    const targetTenant = user.role === 'superadmin' && dto.tenantId ? dto.tenantId : user.tenantID;
    return this.usersService.create(targetTenant, user.role, dto);
  }

  @Roles(...MANAGER_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateUserDto) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.update(id, tenantID, user.role, user.userID, dto);
  }

  @Roles(...MANAGER_ROLES)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.remove(id, tenantID, user.userID, user.role);
  }

  // ─── Section Visibility (071) ───────────────────────────────────────
  // Only owner-class roles may read or change which top-level sections an
  // employee sees. Both routes are tenant-scoped via the JWT in the service.

  @Roles(...MANAGER_ROLES)
  @Get(':id/section-visibility')
  async getSectionVisibility(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.getSectionVisibility(id, tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Patch(':id/section-visibility')
  async updateSectionVisibility(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateSectionVisibilityDto,
  ) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.updateSectionVisibility(id, tenantID, dto.sections);
  }

  // ─── Item Visibility (073) ──────────────────────────────────────────
  // Granular sub-section visibility, ADDITIVE to section-visibility above.
  // Same owner-class role gate; tenant-scoped via the JWT in the service (a
  // foreign userId 404s rather than leaking another tenant's defaults).

  @Roles(...MANAGER_ROLES)
  @Get(':id/item-visibility')
  async getItemVisibility(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.getItemVisibility(id, tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Patch(':id/item-visibility')
  async updateItemVisibility(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateItemVisibilityDto,
  ) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.updateItemVisibility(id, tenantID, dto.items);
  }

  // ─── Action Permissions (server-enforced) ──────────────────────────
  // Owner-class roles set another user's action-permission map. Tenant-scoped
  // in the service (a foreign id 404s); self-lockout protection lives there too
  // (you can't strip your own user_management). This is ADDITIVE to the legacy
  // PATCH /users/:id which also accepts a `permissions` field.

  @Roles(...MANAGER_ROLES)
  @Get(':id/permissions')
  async getPermissions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.getPermissions(id, tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Patch(':id/permissions')
  async updatePermissions(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdatePermissionsDto) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.updatePermissions(id, tenantID, user.userID, dto.permissions);
  }

  // 114 — ЭФФЕКТИВНЫЕ права (плоско): flatten(матрицы назначенной роли) ⊕
  // персональные overrides, прогнанные через ту же userHasPermission, что и
  // enforcement. Для UI волны 2 (экран роли / карточка сотрудника).
  @Roles(...MANAGER_ROLES)
  @Get(':id/effective-permissions')
  async getEffectivePermissions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const tenantID = await this.usersService.resolveTenantForTarget(user, id);
    return this.usersService.getEffectivePermissions(id, tenantID);
  }

  // ─── Product Commissions ────────────────────────────────────────────

  @Roles(...MANAGER_ROLES)
  @Get(':id/product-commissions')
  getProductCommissions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.getProductCommissions(id, user.tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Post(':id/product-commissions')
  setProductCommissions(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { productSalaryPercent: number; items: Array<{ productId: string; percent: number }> },
  ) {
    return this.usersService.setProductCommissions(id, user.tenantID, dto);
  }
}
