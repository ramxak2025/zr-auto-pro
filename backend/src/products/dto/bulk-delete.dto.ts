import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * POST /products/bulk-delete — mass SOFT-delete (move to Корзина) for the
 * warehouse. Never hard-deletes; every product/folder is stamped `deleted_at`
 * so the owner can restore. The three inputs are additive and applied inside a
 * single transaction; any combination may be sent.
 *
 *   • productIds  → soft-delete these live products (≤2000 to keep the ANY(...)
 *                   array + param count sane).
 *   • categoryIds → soft-delete these folders AND their contents/subfolders,
 *                   reusing the exact WarehouseService folder cascade.
 *   • deleteAll   → «удалить весь товар»: soft-delete every live product of the
 *                   tenant, scoped to `warehouseId` when provided (the UI passes
 *                   the current warehouse so Б/У + брак are NOT touched).
 */
export class BulkDeleteDto {
  /** Explicit product ids to trash (≤2000). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000, { message: 'Слишком много товаров за раз' })
  @IsUUID('all', { each: true, message: 'Некорректный товар' })
  productIds?: string[];

  /** warehouse_categories ids to trash — cascades to contents + subfolders (≤2000). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000, { message: 'Слишком много папок за раз' })
  @IsUUID('all', { each: true, message: 'Некорректная папка' })
  categoryIds?: string[];

  /** true → trash all live products of the tenant (scoped to warehouseId if set). */
  @IsOptional()
  @IsBoolean()
  deleteAll?: boolean;

  /** Optional warehouse scope for deleteAll. When set, only this warehouse is affected. */
  @IsOptional()
  @IsUUID('all', { message: 'Некорректный склад' })
  warehouseId?: string;
}
