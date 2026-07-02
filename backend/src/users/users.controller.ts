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
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.restore(id, user.tenantID);
  }

  // "Delete completely" — keeps the row (FK/history) but hides it forever.
  @Roles(...MANAGER_ROLES)
  @Post(':id/purge')
  purge(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.purge(id, user.tenantID, user.userID);
  }

  @Roles(...MANAGER_ROLES)
  @Post('order')
  updateOrder(@CurrentUser() user: JwtPayload, @Body() dto: { orderedIds: string[] }) {
    return this.usersService.updateOrder(user.tenantID, dto.orderedIds);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.getById(id, user.tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.tenantID, user.role, dto);
  }

  @Roles(...MANAGER_ROLES)
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, user.tenantID, user.role, user.userID, dto);
  }

  @Roles(...MANAGER_ROLES)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.remove(id, user.tenantID, user.userID, user.role);
  }

  // ─── Section Visibility (071) ───────────────────────────────────────
  // Only owner-class roles may read or change which top-level sections an
  // employee sees. Both routes are tenant-scoped via the JWT in the service.

  @Roles(...MANAGER_ROLES)
  @Get(':id/section-visibility')
  getSectionVisibility(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.getSectionVisibility(id, user.tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Patch(':id/section-visibility')
  updateSectionVisibility(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateSectionVisibilityDto,
  ) {
    return this.usersService.updateSectionVisibility(id, user.tenantID, dto.sections);
  }

  // ─── Item Visibility (073) ──────────────────────────────────────────
  // Granular sub-section visibility, ADDITIVE to section-visibility above.
  // Same owner-class role gate; tenant-scoped via the JWT in the service (a
  // foreign userId 404s rather than leaking another tenant's defaults).

  @Roles(...MANAGER_ROLES)
  @Get(':id/item-visibility')
  getItemVisibility(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.getItemVisibility(id, user.tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Patch(':id/item-visibility')
  updateItemVisibility(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateItemVisibilityDto) {
    return this.usersService.updateItemVisibility(id, user.tenantID, dto.items);
  }

  // ─── Action Permissions (server-enforced) ──────────────────────────
  // Owner-class roles set another user's action-permission map. Tenant-scoped
  // in the service (a foreign id 404s); self-lockout protection lives there too
  // (you can't strip your own user_management). This is ADDITIVE to the legacy
  // PATCH /users/:id which also accepts a `permissions` field.

  @Roles(...MANAGER_ROLES)
  @Get(':id/permissions')
  getPermissions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.getPermissions(id, user.tenantID);
  }

  @Roles(...MANAGER_ROLES)
  @Patch(':id/permissions')
  updatePermissions(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdatePermissionsDto) {
    return this.usersService.updatePermissions(id, user.tenantID, user.userID, dto.permissions);
  }

  // 114 — ЭФФЕКТИВНЫЕ права (плоско): flatten(матрицы назначенной роли) ⊕
  // персональные overrides, прогнанные через ту же userHasPermission, что и
  // enforcement. Для UI волны 2 (экран роли / карточка сотрудника).
  @Roles(...MANAGER_ROLES)
  @Get(':id/effective-permissions')
  getEffectivePermissions(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.getEffectivePermissions(id, user.tenantID);
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
