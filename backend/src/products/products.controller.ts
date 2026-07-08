import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { StockUpdateDto } from './dto/stock-update.dto';
import { BulkAdjustPriceDto } from './dto/bulk-adjust-price.dto';

// Reads stay open to every authenticated user (a master needs to browse
// products to build a check). MUTATIONS are gated per-method to
// director/admin/superadmin via @Roles below — a master must not be able to
// delete products, rewrite prices, adjust stock, empty the trash or bulk-import
// by hitting the API directly (the UI hiding those is not a security boundary).
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.productsService.getAll(user.tenantID, query);
  }

  @Get('low-stock')
  getLowStock(@CurrentUser() user: JwtPayload) {
    return this.productsService.getLowStock(user.tenantID);
  }

  @Get('movements')
  getMovements(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.productsService.getMovements(user.tenantID, query);
  }

  @Get('warehouse-stats')
  getWarehouseStats(@CurrentUser() user: JwtPayload) {
    return this.productsService.getWarehouseStats(user.tenantID);
  }

  @Get('export-csv')
  async exportCsv(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const csv = await this.productsService.exportCsv(user.tenantID);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    res.send('\uFEFF' + csv);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('import-csv')
  importCsv(@CurrentUser() user: JwtPayload, @Body() dto: { items: any[] }) {
    return this.productsService.importCsv(user.tenantID, dto.items);
  }

  // Mass sell-price change (raise / lower by a percent, optional rounding).
  // Money-sensitive: owner-class only (director/admin/superadmin) — same gate
  // as the single-product price mutations (update, sell-price). A master must
  // not be able to rewrite many prices at once. `dryRun: true` returns a
  // «было → стало» preview without writing; otherwise applied transactionally.
  // Literal path — no collision with :id routes (registered before them anyway).
  @Roles('director', 'admin', 'superadmin')
  @Post('bulk-adjust-price')
  bulkAdjustPrice(@CurrentUser() user: JwtPayload, @Body() dto: BulkAdjustPriceDto) {
    return this.productsService.bulkAdjustPrice(user.tenantID, dto);
  }

  // ── Trash bin ──────────────────────────────────────────────────────────
  // Routes are registered before the catch-all `:id` route so that
  // /products/trash and /products/trash/empty don't get swallowed as ids.

  @Get('trash')
  getTrash(@CurrentUser() user: JwtPayload) {
    return this.productsService.getTrash(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('trash/empty')
  emptyTrash(@CurrentUser() user: JwtPayload) {
    return this.productsService.emptyTrash(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.restore(id, user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete(':id/hard')
  hardDelete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.hardDelete(id, user.tenantID);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.getById(id, user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
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
    return this.productsService.getProductPriceHistory(id, user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, user.tenantID, dto, user.userID);
  }

  // Set just the sell price on an existing product. Designed for the
  // used-purchase flow — the owner intake doesn't always know the future
  // sell price, so the product is initially created with sell_price equal
  // to purchasePrice and updated later when the owner sets the markup.
  @Roles('director', 'admin', 'superadmin')
  @Patch(':id/sell-price')
  setSellPrice(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() body: { sellPrice: number }) {
    return this.productsService.setSellPrice(id, user.tenantID, body?.sellPrice, user.userID);
  }

  // Soft-delete (move to Корзина). Gated by the grantable `warehouse_delete`
  // permission (#60) instead of a flat role check: owner-class (director/admin/
  // superadmin) always allowed via PermissionsGuard bypass; a master may delete
  // only if the owner explicitly granted the right. Restore / hard-delete /
  // empty-trash below stay owner-only (`@Roles`).
  @RequirePermission('warehouse_delete')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.remove(id, user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/stock')
  updateStock(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: StockUpdateDto) {
    return this.productsService.updateStock(id, user.tenantID, dto, user.userID);
  }
}
