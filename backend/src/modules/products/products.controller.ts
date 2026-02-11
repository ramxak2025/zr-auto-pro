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
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { User } from '../users/entities/user.entity';
import { MovementType } from './entities/stock-movement.entity';

@Controller('products')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('warehouse_access')
  findAll(
    @TenantId() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('lowStock') lowStock?: boolean,
  ) {
    return this.productsService.findAll(tenantId, { page, limit, search, category, lowStock });
  }

  @Get('categories')
  @RequirePermissions('warehouse_access')
  getCategories(@TenantId() tenantId: string) {
    return this.productsService.getCategories(tenantId);
  }

  @Get('low-stock')
  @RequirePermissions('warehouse_access')
  getLowStock(@TenantId() tenantId: string) {
    return this.productsService.getLowStockProducts(tenantId);
  }

  @Get(':id')
  @RequirePermissions('warehouse_access')
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findById(tenantId, id);
  }

  @Get(':id/movements')
  @RequirePermissions('warehouse_access')
  getMovements(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.productsService.getMovements(tenantId, id, { page, limit });
  }

  @Post()
  @RequirePermissions('warehouse_access')
  create(@TenantId() tenantId: string, @Body() dto: CreateProductDto) {
    return this.productsService.create(tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('warehouse_access')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('warehouse_access')
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(tenantId, id);
  }

  @Post(':id/writeoff')
  @RequirePermissions('warehouse_access')
  writeOff(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('quantity') quantity: number,
    @Body('reason') reason: string,
    @CurrentUser() user: User,
  ) {
    return this.productsService.adjustStock(
      tenantId,
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
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('actualStock') actualStock: number,
    @Body('reason') reason: string,
    @CurrentUser() user: User,
  ) {
    return this.productsService.inventoryAdjust(tenantId, id, actualStock, user.id, reason);
  }
}
