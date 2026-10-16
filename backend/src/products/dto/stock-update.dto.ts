import { IsString, IsOptional, IsIn, IsBoolean, IsUUID, Min, Equals, ValidateBy, ValidateIf } from 'class-validator';

// products.stock and stock_movements quantities are NUMERIC(12,3).
export const MAX_STOCK_QUANTITY = 999999999.999;
export const isStockNumber = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Math.abs(value) <= MAX_STOCK_QUANTITY &&
  /^-?\d+(?:\.\d{1,3})?$/.test(String(value));

// Check the decimal representation without rounding. IsNumber(maxDecimalPlaces)
// in the installed validator throws for scientific notation such as 1e-7.
const IsStockNumber = () =>
  ValidateBy({
    name: 'isStockNumber',
    validator: {
      validate: isStockNumber,
      defaultMessage: () => 'Количество должно быть числом в пределах 999999999.999, не более 3 знаков после запятой',
    },
  });

export const hasInventoryGuard = (dto: StockUpdateDto): boolean =>
  dto.requestId !== undefined || dto.expectedStock !== undefined || dto.expectedWarehouseId !== undefined;

export class StockUpdateDto {
  // Per-product stock endpoint stays on the simple 4-type set. Compound
  // operations (defect/used transfer + supplier return) go through the
  // dedicated /stock-movements endpoint so the body shape stays predictable.
  @IsString()
  @IsIn(['income', 'expense', 'writeoff', 'inventory'])
  @ValidateBy({
    name: 'inventoryGuardType',
    validator: {
      validate: (value, args) => !hasInventoryGuard(args!.object as StockUpdateDto) || value === 'inventory',
      defaultMessage: () => 'Параметры сверки допустимы только для инвентаризации',
    },
  })
  type!: string;

  // Дробные количества (120): 0.5 м шланга — валидно; не глубже 3 знаков,
  // ровно как NUMERIC(12,3) у stock_movements.quantity.
  // @Min(0): отрицательное quantity раньше проходило и давало минусовой
  // остаток / скрытый приход через writeoff / отрицательный расход в expenses.
  // Ноль допустим только для inventory (сервис дожимает qty > 0 для остальных).
  @IsStockNumber()
  @Min(0)
  quantity!: number;

  // Either the entire guard is supplied or none of it (legacy /stock callers).
  // Explicit null is invalid; it must not silently turn a guarded write into a
  // legacy write. expectedStock may be negative after a legitimate oversale.
  @ValidateIf(hasInventoryGuard)
  @IsUUID()
  requestId?: string;

  @ValidateIf(hasInventoryGuard)
  @IsStockNumber()
  expectedStock?: number;

  @ValidateIf(hasInventoryGuard)
  @IsUUID()
  expectedWarehouseId?: string;

  @IsString()
  @IsOptional()
  reason?: string | null;

  @IsOptional()
  @IsBoolean()
  recordAsExpense?: boolean | null;
}

// A distinct route fails closed on older servers that whitelist away unknown
// guard fields on /stock. No unguarded inventory is accepted on this route.
export class InventoryUpdateDto extends StockUpdateDto {
  @Equals('inventory')
  @ValidateBy({
    name: 'requiredInventoryGuard',
    validator: {
      validate: (_value, args) => hasInventoryGuard(args!.object as StockUpdateDto),
      defaultMessage: () => 'Для инвентаризации обязательны requestId, expectedStock и expectedWarehouseId',
    },
  })
  type!: 'inventory';
}
