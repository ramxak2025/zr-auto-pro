import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// ROLE-ONLY (консолидация 2026-07). Дерево категорий склада:
//   • view   — чтение дерева (нужно кассе / product picker) → 'warehouse_access';
//   • manage — create / rename / reorder → 'warehouse_manage';
//   • delete — удаление папки (soft, каскад в корзину) → 'warehouse_delete'.
// Owner-class (director/admin/superadmin) обходит гейты через PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private warehouseService: WarehouseService) {}

  // Чтение дерева категорий — 'warehouse_access' (просмотр склада). Нужно кассе /
  // product picker. После 032_warehouse_categories_per_warehouse.sql дерево
  // warehouse-scoped: без `warehouseId` — основной склад тенанта (легаси-совместимо).
  @RequirePermission('warehouse_access')
  @Get('categories')
  getCategories(@CurrentUser() user: JwtPayload, @Query('warehouseId') warehouseId?: string) {
    return this.warehouseService.getCategories(user.tenantID, warehouseId);
  }

  @RequirePermission('warehouse_manage')
  @Post('categories')
  createCategory(
    @CurrentUser() user: JwtPayload,
    @Body('path') path: string,
    @Body('warehouseId') warehouseId?: string,
  ) {
    return this.warehouseService.createCategory(user.tenantID, path, warehouseId);
  }

  // Delete a folder — EMPTY or FULL. Soft-delete only (reversible): the category
  // row is stamped with deleted_at (never hard-deleted), and with
  // `deleteContents=true` the products inside cascade to the Корзина. Gated by
  // the grantable `warehouse_delete` permission (#60): owner-class always
  // allowed; a master only if the owner granted it.
  @RequirePermission('warehouse_delete')
  @Delete('categories/:id')
  removeCategory(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('moveTo') moveTo?: string,
    @Query('deleteContents') deleteContents?: string,
  ) {
    return this.warehouseService.removeCategory(
      id,
      user.tenantID,
      moveTo,
      deleteContents === 'true' || deleteContents === '1',
    );
  }

  @RequirePermission('warehouse_manage')
  @Patch('categories/order')
  updateOrder(@CurrentUser() user: JwtPayload, @Body('orderedIds') orderedIds: string[]) {
    return this.warehouseService.updateOrder(user.tenantID, orderedIds);
  }

  @RequirePermission('warehouse_manage')
  @Patch('categories/:id/rename')
  renameCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body('newPath') newPath: string) {
    return this.warehouseService.renameCategory(id, user.tenantID, newPath);
  }
}
