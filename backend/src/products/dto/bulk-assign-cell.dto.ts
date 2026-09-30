import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID, ValidateIf } from 'class-validator';

/**
 * POST /products/bulk-assign-cell — массово положить товары в одну ячейку хранения
 * (или снять адрес), транзакционно. Mirrors shared BulkAssignCellRequest.
 *
 *   • productIds    → какие товары (≤2000, тот же потолок, что у bulk-move/bulk-delete);
 *   • storageCellId → uuid ячейки либо null — снять адрес у всех перечисленных.
 */
export class BulkAssignCellDto {
  // Порядок снизу вверх: фильтр отдаёт клиенту только первое сообщение, «не список» должен идти первым.
  @IsUUID('all', { each: true, message: 'Некорректный товар' })
  @ArrayMaxSize(2000, { message: 'Слишком много товаров за раз' })
  @ArrayNotEmpty({ message: 'Не выбраны товары' })
  @IsArray({ message: 'Товары должны быть списком' })
  productIds!: string[];

  // null — законное значение («снять адрес»); а вот ОТСУТСТВИЕ поля — ошибка клиента,
  // а не молчаливое снятие адреса у всей выборки, поэтому @IsOptional() здесь нельзя.
  @ValidateIf((o: BulkAssignCellDto) => o.storageCellId !== null)
  @IsUUID('all', { message: 'Некорректная ячейка хранения' })
  storageCellId!: string | null;
}
