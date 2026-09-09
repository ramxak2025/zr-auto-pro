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

  // Сообщения валидации — по-русски (см. UpdateProductDto): клиент показывает
  // текст сервера пользователю дословно.
  @IsNumber({}, { message: 'Себестоимость должна быть числом' })
  @IsOptional()
  costPrice?: number;

  @IsNumber({}, { message: 'Цена продажи должна быть числом' })
  @IsOptional()
  sellPrice?: number;

  // Дробные остатки (120): 12.5 м / 0.75 кг; не глубже 3 знаков — NUMERIC(12,3).
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Остаток должен быть числом (не более 3 знаков после запятой)' })
  @IsOptional()
  stock?: number;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Мин. остаток должен быть числом (не более 3 знаков после запятой)' })
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
