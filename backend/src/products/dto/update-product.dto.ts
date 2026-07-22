import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsInt, Min } from 'class-validator';

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  category?: string;

  // #63 — nullable so the client can send `photo: null` (or '') to REMOVE the
  // photo. @IsOptional() skips validation for null/undefined; a non-null value
  // must still be a string. The service clears null/'' to NULL.
  @IsString()
  @IsOptional()
  photo?: string | null;

  @IsNumber()
  @IsOptional()
  costPrice?: number;

  @IsNumber()
  @IsOptional()
  sellPrice?: number;

  // Дробные остатки (120): 12.5 м / 0.75 кг; не глубже 3 знаков — NUMERIC(12,3).
  // @Min(0) — отрицательный остаток через PATCH запрещён (страж и в сервисе).
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @IsOptional()
  stock?: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsOptional()
  minStock?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsBoolean()
  @IsOptional()
  isBundle?: boolean;

  @IsArray()
  @IsOptional()
  bundleItems?: any[];

  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  warehouseId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  warrantyDays?: number;

  @IsString()
  @IsOptional()
  barcode?: string;
}
