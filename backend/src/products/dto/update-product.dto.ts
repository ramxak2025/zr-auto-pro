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

  // Сообщения валидации — по-русски: клиенты показывают текст сервера
  // пользователю дословно (mobile utils/apiError.ts, web toast'ы), английский
  // дефолт class-validator владельцу ничего не объясняет.
  @IsNumber({}, { message: 'Себестоимость должна быть числом' })
  @IsOptional()
  costPrice?: number;

  @IsNumber({}, { message: 'Цена продажи должна быть числом' })
  @IsOptional()
  sellPrice?: number;

  // Дробные остатки (120): 12.5 м / 0.75 кг; не глубже 3 знаков — NUMERIC(12,3).
  //
  // @Min(0) СНЯТ сознательно. Товар, проданный «в минус» (оверселл разрешён
  // продуктово — checks.service «сток уходит в МИНУС»), хранится с stock < 0, и
  // GET отдаёт это значение клиенту. Схемная проверка @Min(0) отклоняла ВЕСЬ
  // PATCH, когда форма редактирования возвращала тот же минус обратно, — из-за
  // этого не сохранялась себестоимость такого товара. Запрет минуса живёт в
  // ProductsService.update/applyStockPatch, где виден ТЕКУЩИЙ остаток: эхо
  // существующего минуса проходит как no-op, попытка увести остаток в минус
  // отклоняется с русским сообщением.
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
