import { ArrayMaxSize, IsArray, IsString, IsUUID } from 'class-validator';
import { MAX_BULK_CELLS } from '../storage-cells.helpers';

/**
 * POST /storage-cells/bulk — mirrors shared BulkCreateStorageCellsRequest. Коды
 * генерирует клиент; сервис нормализует каждый, выбрасывает пустые и повторы.
 */
export class BulkCreateStorageCellsDto {
  @IsUUID('all', { message: 'Некорректный склад' })
  warehouseId!: string;

  // Порядок снизу вверх: фильтр отдаёт клиенту только первое сообщение, «не список» должен идти первым.
  @IsString({ each: true, message: 'Код ячейки должен быть строкой' })
  @ArrayMaxSize(MAX_BULK_CELLS, { message: `Слишком много ячеек за раз: максимум ${MAX_BULK_CELLS}` })
  @IsArray({ message: 'Коды ячеек должны быть списком' })
  codes!: string[];
}
