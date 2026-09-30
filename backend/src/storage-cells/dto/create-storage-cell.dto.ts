import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { MAX_CELL_NAME_LENGTH } from '../storage-cells.helpers';

/**
 * POST /storage-cells — mirrors shared CreateStorageCellRequest. Код нормализует
 * сервис (trim / пробелы / верхний регистр) и проверяет длину уже после этого.
 */
export class CreateStorageCellDto {
  @IsUUID('all', { message: 'Некорректный склад' })
  warehouseId!: string;

  @IsString({ message: 'Код ячейки должен быть строкой' })
  @IsNotEmpty({ message: 'Укажите код ячейки' })
  code!: string;

  /** Необязательная подпись; null / '' = без подписи. */
  @IsOptional()
  @IsString({ message: 'Подпись должна быть строкой' })
  @MaxLength(MAX_CELL_NAME_LENGTH, { message: `Подпись не длиннее ${MAX_CELL_NAME_LENGTH} символов` })
  name?: string | null;
}
