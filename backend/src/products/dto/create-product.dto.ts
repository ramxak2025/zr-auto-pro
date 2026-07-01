import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsArray, IsInt, Min } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  category?: string;

  // #63 — nullable for parity with UpdateProductDto; null / '' store no photo.
  @IsString()
  @IsOptional()
  photo?: string | null;

  @IsNumber()
  @IsOptional()
  costPrice?: number;

  @IsNumber()
  @IsOptional()
  sellPrice?: number;

  @IsNumber()
  @IsOptional()
  stock?: number;

  @IsNumber()
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
