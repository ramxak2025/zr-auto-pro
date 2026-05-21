import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsIn } from 'class-validator';
import { StockMovementsService, StockMovementType } from './stock-movements.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

const TYPES: StockMovementType[] = [
  'inventory',
  'writeoff',
  'income',
  'expense',
  'defect_transfer',
  'used_transfer',
  'defect_return_to_supplier',
];

class CreateStockMovementDto {
  @IsString()
  @IsIn(TYPES)
  type!: StockMovementType;

  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  purchasePrice?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  sourceWarehouseId?: string;

  @IsOptional()
  @IsString()
  targetWarehouseId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsBoolean()
  recordAsExpense?: boolean;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stock-movements')
export class StockMovementsController {
  constructor(private movementsService: StockMovementsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.movementsService.list(user.tenantID, {
      warehouseId: query.warehouseId,
      productId: query.productId,
      type: query.type,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }

  // Director / admin / superadmin only — masters use the per-product
  // `/products/:id/stock` endpoint which is locked to the simple income /
  // expense / writeoff / inventory set on the "main" warehouse.
  @Roles('director', 'admin', 'superadmin')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateStockMovementDto) {
    return this.movementsService.create(user.tenantID, user.userID, dto);
  }
}
