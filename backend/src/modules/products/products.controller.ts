import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { MovementType } from './entities/stock-movement.entity';

@Controller('products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('warehouse_access')
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('lowStock') lowStock?: boolean,
  ) {
    return this.productsService.findAll({ page, limit, search, category, lowStock });
  }

  @Get('categories')
  @RequirePermissions('warehouse_access')
  getCategories() {
    return this.productsService.getCategories();
  }

  @Get('low-stock')
  @RequirePermissions('warehouse_access')
  getLowStock() {
    return this.productsService.getLowStockProducts();
  }

  @Get(':id')
  @RequirePermissions('warehouse_access')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findById(id);
  }

  @Get(':id/movements')
  @RequirePermissions('warehouse_access')
  getMovements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.productsService.getMovements(id, { page, limit });
  }

  @Post()
  @RequirePermissions('warehouse_access')
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('warehouse_access')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('warehouse_access')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }

  @Post(':id/writeoff')
  @RequirePermissions('warehouse_access')
  writeOff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('quantity') quantity: number,
    @Body('reason') reason: string,
    @CurrentUser() user: User,
  ) {
    return this.productsService.adjustStock(
      id,
      quantity,
      MovementType.WRITEOFF,
      user.id,
      reason,
    );
  }

  @Post(':id/inventory')
  @RequirePermissions('warehouse_access')
  inventoryAdjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('actualStock') actualStock: number,
    @Body('reason') reason: string,
    @CurrentUser() user: User,
  ) {
    return this.productsService.inventoryAdjust(id, actualStock, user.id, reason);
  }
}
