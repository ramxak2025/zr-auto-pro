import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * POST /products/bulk-move — mass move of products into another folder
 * (category), transactionally: either ALL move or nothing. Scoped to the
 * current warehouse (`warehouseId`; absent → main) so same-named paths in
 * Б/У / брак are never touched. Mirrors shared BulkMoveRequest.
 *
 *   • productIds     → which live products to move (≤2000, same cap as bulk-delete).
 *   • targetCategory → path целевой папки («Масла/Синтетика»); '' = в корень
 *     (category=NULL). Несуществующая папка создаётся идемпотентно.
 */
export class BulkMoveDto {
  /** Explicit product ids to move (≤2000). */
  @IsArray()
  @ArrayNotEmpty({ message: 'Не выбраны товары' })
  @ArrayMaxSize(2000, { message: 'Слишком много товаров за раз' })
  @IsUUID('all', { each: true, message: 'Некорректный товар' })
  productIds!: string[];

  /** Target folder path; empty string = move to root (category=NULL). */
  @IsString({ message: 'Некорректная папка' })
  targetCategory!: string;

  /** Warehouse scope; absent → tenant's main warehouse. */
  @IsOptional()
  @IsUUID('all', { message: 'Некорректный склад' })
  warehouseId?: string;
}
