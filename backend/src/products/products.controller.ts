import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { StockUpdateDto } from './dto/stock-update.dto';
import { BulkAdjustPriceDto } from './dto/bulk-adjust-price.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { BulkMoveDto } from './dto/bulk-move.dto';

// ROLE-ONLY (консолидация 2026-07). Reads stay open to every authenticated user
// (a master needs to browse products to build a check) — but the service STRIPS
// costPrice from the payload for anyone without 'warehouse_manage' (see
// ProductsService.mapProduct/canSeeCost). MUTATIONS (create / update / prices /
// stock / trash / import) require 'warehouse_manage'; soft-delete keeps its finer
// 'warehouse_delete' (which manage implies). Owner-class (director/admin/
// superadmin) bypasses every permission gate via PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    // ROLE-ONLY: actor threaded so the service strips costPrice from the payload
    // for anyone without 'warehouse_manage' (masters see products, not cost).
    return this.productsService.getAll(user.tenantID, query, user);
  }

  @Get('low-stock')
  getLowStock(@CurrentUser() user: JwtPayload) {
    return this.productsService.getLowStock(user.tenantID, user);
  }

  @Get('movements')
  getMovements(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.productsService.getMovements(user.tenantID, query);
  }

  // Складская сводка ВКЛЮЧАЕТ себестоимость (total_cost_value, month/lastMonth
  // product cost) → чувствительна, как и export-csv. Требует управления складом
  // ('warehouse_manage'); без гейта мастер видел суммарную себестоимость склада.
  // Owner-class (director/admin/superadmin) обходит через PermissionsGuard.
  @RequirePermission('warehouse_manage')
  @Get('warehouse-stats')
  getWarehouseStats(@CurrentUser() user: JwtPayload) {
    return this.productsService.getWarehouseStats(user.tenantID);
  }

  // CSV-\u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0430 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0430 \u0432\u043A\u043B\u044E\u0447\u0430\u0435\u0442 \u0441\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u2192 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0441\u043A\u043B\u0430\u0434\u043E\u043C
  // ('warehouse_manage'). Owner-class \u043E\u0431\u0445\u043E\u0434\u0438\u0442 \u0447\u0435\u0440\u0435\u0437 PermissionsGuard.
  @RequirePermission('warehouse_manage')
  @Get('export-csv')
  async exportCsv(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const csv = await this.productsService.exportCsv(user.tenantID);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    res.send('\uFEFF' + csv);
  }

  // Импорт каталога — управление складом ('warehouse_manage'). Owner-class обходит.
  @RequirePermission('warehouse_manage')
  @Post('import-csv')
  importCsv(@CurrentUser() user: JwtPayload, @Body() dto: { items: any[] }) {
    return this.productsService.importCsv(user.tenantID, dto.items);
  }

  // Mass sell-price change (raise / lower by a percent, optional rounding).
  // Money-sensitive: requires warehouse management ('warehouse_manage'). A user
  // without it must not be able to rewrite many prices at once. Owner-class
  // (director/admin/superadmin) bypasses via PermissionsGuard. `dryRun: true`
  // returns a «было → стало» preview without writing; else applied transactionally.
  // Literal path — no collision with :id routes (registered before them anyway).
  @RequirePermission('warehouse_manage')
  @Post('bulk-adjust-price')
  bulkAdjustPrice(@CurrentUser() user: JwtPayload, @Body() dto: BulkAdjustPriceDto) {
    return this.productsService.bulkAdjustPrice(user.tenantID, dto);
  }

  // Bulk soft-delete (move to Корзина) — products by id, folders (cascade), or
  // «удалить весь товар» (deleteAll, scoped to the current warehouseId). Gated by
  // the same grantable `warehouse_delete` as the single soft-delete (DELETE
  // /products/:id); owner-class bypasses via PermissionsGuard. NEVER hard-deletes.
  // Literal path — registered before the `:id` routes so it isn't swallowed as an id.
  @RequirePermission('warehouse_delete')
  @Post('bulk-delete')
  bulkDelete(@CurrentUser() user: JwtPayload, @Body() dto: BulkDeleteDto) {
    return this.productsService.bulkSoftDelete(user.tenantID, dto);
  }

  // Bulk move of products into another folder (targetCategory=''→ в корень),
  // transactionally and scoped to the current warehouseId (absent → main) so
  // same-named paths in Б/У / брак are never touched. Requires the same
  // 'warehouse_manage' as single-product edits (PATCH /products/:id); owner-class
  // bypasses via PermissionsGuard.
  // Literal path — registered before the `:id` routes so it isn't swallowed as an id.
  @RequirePermission('warehouse_manage')
  @Post('bulk-move')
  bulkMove(@CurrentUser() user: JwtPayload, @Body() dto: BulkMoveDto) {
    return this.productsService.bulkMove(user.tenantID, dto);
  }

  // ── Trash bin ──────────────────────────────────────────────────────────
  // Routes are registered before the catch-all `:id` route so that
  // /products/trash and /products/trash/empty don't get swallowed as ids.

  // Просмотр корзины — часть цикла удаления: тот же грантуемый ключ
  // 'warehouse_delete', что и soft-delete (manage ⇒ delete при flatten;
  // owner-class обходит через PermissionsGuard).
  @RequirePermission('warehouse_delete')
  @Get('trash')
  getTrash(@CurrentUser() user: JwtPayload) {
    return this.productsService.getTrash(user.tenantID, user);
  }

  @RequirePermission('warehouse_manage')
  @Delete('trash/empty')
  emptyTrash(@CurrentUser() user: JwtPayload) {
    return this.productsService.emptyTrash(user.tenantID);
  }

  @RequirePermission('warehouse_manage')
  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.restore(id, user.tenantID);
  }

  @RequirePermission('warehouse_manage')
  @Delete(':id/hard')
  hardDelete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.hardDelete(id, user.tenantID);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.getById(id, user.tenantID, user);
  }

  @RequirePermission('warehouse_manage')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateProductDto) {
    return this.productsService.create(user.tenantID, dto);
  }

  @Get(':id/movements')
  getProductMovements(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.getProductMovements(id, user.tenantID);
  }

  @Get(':id/price-history')
  getProductPriceHistory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.getProductPriceHistory(id, user.tenantID, user);
  }

  @RequirePermission('warehouse_manage')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, user.tenantID, dto, user.userID);
  }

  // Set just the sell price on an existing product. Designed for the
  // used-purchase flow — the owner intake doesn't always know the future
  // sell price, so the product is initially created with sell_price equal
  // to purchasePrice and updated later when the owner sets the markup.
  @RequirePermission('warehouse_manage')
  @Patch(':id/sell-price')
  setSellPrice(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() body: { sellPrice: number }) {
    return this.productsService.setSellPrice(id, user.tenantID, body?.sellPrice, user.userID);
  }

  // Soft-delete (move to Корзина). Gated by the grantable `warehouse_delete`
  // permission (#60): owner-class always allowed via PermissionsGuard bypass; a
  // role holding warehouse manage implies delete (flatten: manage ⇒ delete), or
  // the owner may grant delete alone. Restore / hard-delete / empty-trash require
  // 'warehouse_manage'.
  @RequirePermission('warehouse_delete')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.remove(id, user.tenantID);
  }

  // Инвентаризация / корректировка остатка конкретного товара — управление складом.
  @RequirePermission('warehouse_manage')
  @Post(':id/stock')
  updateStock(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: StockUpdateDto) {
    return this.productsService.updateStock(id, user.tenantID, dto, user.userID);
  }
}
