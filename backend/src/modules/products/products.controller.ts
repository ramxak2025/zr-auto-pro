import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';

import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.productsService.findAll(req.user.tenantId, search, category);
  }

  @Get('low-stock')
  async getLowStock(@Request() req: any) {
    return this.productsService.getLowStock(req.user.tenantId);
  }

  @Get('movements')
  async getStockMovements(
    @Request() req: any,
    @Query('productId') productId?: string,
  ) {
    return this.productsService.getStockMovements(req.user.tenantId, productId);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Post()
  async create(@Request() req: any, @Body() body: any) {
    return this.productsService.create({ ...body, tenantId: req.user.tenantId });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.productsService.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Post(':id/stock')
  async updateStock(
    @Param('id') id: string,
    @Body() body: { quantity: number; type: 'income' | 'expense' | 'writeoff' | 'inventory'; reason?: string },
  ) {
    return this.productsService.updateStock(id, body.quantity, body.type, body.reason);
  }
}
