import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { StockUpdateDto } from './dto/stock-update.dto';

@UseGuards(JwtAuthGuard)
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

  @Post('import-csv')
  importCsv(@CurrentUser() user: JwtPayload, @Body() dto: { items: any[] }) {
    return this.productsService.importCsv(user.tenantID, dto.items);
  }

  // ── Trash bin ──────────────────────────────────────────────────────────
  // Routes are registered before the catch-all `:id` route so that
  // /products/trash and /products/trash/empty don't get swallowed as ids.

  @Get('trash')
  getTrash(@CurrentUser() user: JwtPayload) {
    return this.productsService.getTrash(user.tenantID);
  }

  @Delete('trash/empty')
  emptyTrash(@CurrentUser() user: JwtPayload) {
    return this.productsService.emptyTrash(user.tenantID);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.restore(id, user.tenantID);
  }

  @Delete(':id/hard')
  hardDelete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.hardDelete(id, user.tenantID);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.getById(id, user.tenantID);
  }

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

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, user.tenantID, dto, user.userID);
  }

  // Set just the sell price on an existing product. Designed for the
  // used-purchase flow — the owner intake doesn't always know the future
  // sell price, so the product is initially created with sell_price equal
  // to purchasePrice and updated later when the owner sets the markup.
  @Patch(':id/sell-price')
  setSellPrice(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { sellPrice: number },
  ) {
    return this.productsService.setSellPrice(id, user.tenantID, body?.sellPrice, user.userID);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.remove(id, user.tenantID);
  }

  @Post(':id/stock')
  updateStock(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: StockUpdateDto) {
    return this.productsService.updateStock(id, user.tenantID, dto, user.userID);
  }
}
