import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

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
  getMovements(@CurrentUser() user: JwtPayload) {
    return this.productsService.getMovements(user.tenantID);
  }

  @Get('warehouse-stats')
  getWarehouseStats(@CurrentUser() user: JwtPayload) {
    return this.productsService.getWarehouseStats(user.tenantID);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.getById(id, user.tenantID);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.productsService.create(user.tenantID, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.productsService.update(id, user.tenantID, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.remove(id, user.tenantID);
  }

  @Post(':id/stock')
  updateStock(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.productsService.updateStock(id, user.tenantID, dto);
  }
}
