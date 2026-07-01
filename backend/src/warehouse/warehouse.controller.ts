import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private warehouseService: WarehouseService) {}

  // Reading the category tree is fine for any authenticated user — the cash
  // screen / product picker needs it. Writes (create / rename / reorder /
  // delete with bulk soft-delete or move) are admin / director only.
  //
  // After 032_warehouse_categories_per_warehouse.sql the tree is
  // warehouse-scoped: omitting `warehouseId` falls back to the tenant's
  // main warehouse (preserves legacy callers); passing `warehouseId=…`
  // returns only that warehouse's folders.
  @Get('categories')
  getCategories(@CurrentUser() user: JwtPayload, @Query('warehouseId') warehouseId?: string) {
    return this.warehouseService.getCategories(user.tenantID, warehouseId);
  }

  @Roles('director', 'admin', 'superadmin')
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

  @Roles('director', 'admin', 'superadmin')
  @Patch('categories/order')
  updateOrder(@CurrentUser() user: JwtPayload, @Body('orderedIds') orderedIds: string[]) {
    return this.warehouseService.updateOrder(user.tenantID, orderedIds);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('categories/:id/rename')
  renameCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body('newPath') newPath: string) {
    return this.warehouseService.renameCategory(id, user.tenantID, newPath);
  }
}
