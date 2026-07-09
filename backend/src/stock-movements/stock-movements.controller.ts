import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsIn } from 'class-validator';
import { StockMovementsService, StockMovementType } from './stock-movements.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
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

  // Дробные количества (120): не глубже 3 знаков — как NUMERIC(12,3) в БД.
  @IsNumber({ maxDecimalPlaces: 3 })
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

// ROLE-ONLY (консолидация 2026-07). Движения склада (инвентаризация, списание,
// приход, перемещения) — часть управления складом:
//   • view   — журнал движений → 'warehouse_access';
//   • manage — создание любого движения (инвентаризация и т.д.) → 'warehouse_manage'.
// Owner-class (director/admin/superadmin) обходит гейты через PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('stock-movements')
export class StockMovementsController {
  constructor(private movementsService: StockMovementsService) {}

  @RequirePermission('warehouse_access')
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

  // Инвентаризация / списание / перемещения — требуют управления складом.
  @RequirePermission('warehouse_manage')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateStockMovementDto) {
    return this.movementsService.create(user.tenantID, user.userID, dto);
  }

  // Convenience: ergonomic shortcut for "transfer to defect" so the FE
  // doesn't need to construct a full stock-movement payload with the
  // generic POST /. Body is intentionally minimal (productId, source,
  // qty, reason). Reason is required by the underlying service for
  // defect_transfer movements.
  @RequirePermission('warehouse_manage')
  @Post('transfer-to-defect')
  transferToDefect(
    @CurrentUser() user: JwtPayload,
    @Body() body: { productId: string; fromWarehouseId: string; quantity: number; reason: string },
  ) {
    return this.movementsService.create(user.tenantID, user.userID, {
      type: 'defect_transfer',
      productId: body?.productId,
      quantity: body?.quantity,
      sourceWarehouseId: body?.fromWarehouseId,
      reason: body?.reason,
    });
  }
}
