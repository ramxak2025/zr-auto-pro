import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: any) {
    return this.productsService.findAll(user.tenantId, query);
  }

  @Get('low-stock')
  findLowStock(@CurrentUser() user: any) {
    return this.productsService.findLowStockRaw(user.tenantId);
  }

  @Get('movements')
  getMovements(@CurrentUser() user: any, @Query() query: any) {
    return this.productsService.getMovements(user.tenantId, query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.productsService.create(body, user.tenantId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.productsService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Post(':id/stock')
  updateStock(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.productsService.updateStock(id, body, user.tenantId);
  }
}
