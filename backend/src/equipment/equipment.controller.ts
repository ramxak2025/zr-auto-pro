import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { EquipmentService } from './equipment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId } from '../common/point-scope';

// ROLE-ONLY (консолидация 2026-07). Enforcement на сервере:
//   • view   — просмотр справочника имущества (категории, склад, кому выдано,
//     сводка, корзина) → @RequirePermission('equipment_view');
//   • manage — create/update/delete/issue/replace/trash/restore/return → 'equipment_manage'.
// ИСКЛЮЧЕНИЕ: GET /equipment/my — своё выданное имущество, доступно любому
// аутентифицированному (self-scoped по userID, как salary/my). Owner-class
// (director/admin/superadmin) обходит гейты через PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('equipment')
export class EquipmentController {
  constructor(private service: EquipmentService) {}

  // ─── Storage Categories ───────────────────────────────────────────
  @RequirePermission('equipment_view')
  @Get('categories')
  getCategories(@CurrentUser() user: JwtPayload) {
    return this.service.getCategories(user.tenantID);
  }

  @RequirePermission('equipment_manage')
  @Post('categories')
  createCategory(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.createCategory(user.tenantID, dto);
  }

  @RequirePermission('equipment_manage')
  @Delete('categories/:id')
  removeCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.removeCategory(id, user.tenantID);
  }

  // ─── Storage Items ────────────────────────────────────────────────
  @RequirePermission('equipment_view')
  @Get('storage')
  getStorageItems(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.service.getStorageItems(user.tenantID, query);
  }

  @RequirePermission('equipment_manage')
  @Post('storage')
  createStorageItem(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    // Филиал автора — для зеркального расхода «Покупка имущества» (161).
    return this.service.createStorageItem(user.tenantID, user.userID, dto, actorPointId(user));
  }

  @RequirePermission('equipment_manage')
  @Patch('storage/:id')
  updateStorageItem(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    // Автор + его филиал: резолв филиала для нового зеркального расхода
    // считает доступные точки по назначениям ИМЕННО этого пользователя (161).
    return this.service.updateStorageItem(id, user.tenantID, dto, user.userID, actorPointId(user));
  }

  // `reverseExpense=true` → also delete the linked «Имущество» expense
  // ("вернуть деньги в оборот"). Accepts the flag from query or body.
  @RequirePermission('equipment_manage')
  @Delete('storage/:id')
  removeStorageItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('reverseExpense') reverseExpenseQuery?: string,
    @Body() body?: { reverseExpense?: boolean },
  ) {
    const reverseExpense = reverseExpenseQuery === 'true' || body?.reverseExpense === true;
    // Филиал сессии — гейту зеркального расхода (161/163): «вернуть деньги в
    // оборот» можно только в том филиале, за счёт которого покупали.
    return this.service.removeStorageItem(id, user.tenantID, reverseExpense, actorPointId(user));
  }

  // ─── Employee Summary ─────────────────────────────────────────────
  @RequirePermission('equipment_view')
  @Get('summary')
  getSummary(@CurrentUser() user: JwtPayload) {
    return this.service.getEmployeeSummary(user.tenantID);
  }

  // ─── My Equipment (for masters) ───────────────────────────────────
  // Self-scoped: любой аутентифицированный видит СВОЁ выданное имущество.
  @Get('my')
  getMyEquipment(@CurrentUser() user: JwtPayload) {
    return this.service.getMyEquipment(user.tenantID, user.userID);
  }

  // ─── Issued Equipment by User ─────────────────────────────────────
  @RequirePermission('equipment_view')
  @Get('user/:userId')
  getByUser(
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.service.getIssuedByUser(user.tenantID, userId, includeInactive === 'true');
  }

  // ─── Issue to Employee ────────────────────────────────────────────
  @RequirePermission('equipment_manage')
  @Post('issue')
  issue(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.issueToEmployee(user.tenantID, dto);
  }

  // ─── Replace ──────────────────────────────────────────────────────
  @RequirePermission('equipment_manage')
  @Post(':id/replace')
  replace(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.replaceItem(id, user.tenantID, dto);
  }

  // ─── Trash ────────────────────────────────────────────────────────
  @RequirePermission('equipment_manage')
  @Post(':id/trash')
  trash(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.trashItem(id, user.tenantID, dto?.reason);
  }

  @RequirePermission('equipment_view')
  @Get('trash')
  getTrash(@CurrentUser() user: JwtPayload) {
    return this.service.getTrash(user.tenantID);
  }

  @RequirePermission('equipment_manage')
  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.restoreFromTrash(id, user.tenantID);
  }

  @RequirePermission('equipment_manage')
  @Post(':id/return-storage')
  returnToStorage(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.returnToStorage(id, user.tenantID);
  }

  // Полное удаление — строже: 'equipment_permanent_delete'
  // (equipment.permanentDelete, миграция 136). Owner-only ячейка: сид
  // «Администратора» false (сегодня @Roles(d,sa) БЕЗ admin — 1:1);
  // director/superadmin обходят через PermissionsGuard.
  @RequirePermission('equipment_permanent_delete')
  @Delete(':id')
  permanentDelete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.permanentDelete(id, user.tenantID);
  }
}
