import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_CELL_NAME_LENGTH } from '../storage-cells.helpers';

/**
 * PATCH /storage-cells/:id — mirrors shared UpdateStorageCellRequest.
 *   • code      — не передан / null: не меняется; иначе нормализуется, пустой → 400;
 *   • name      — не передан: не меняется; '' или null снимают подпись;
 *   • sortOrder — порядок в списке (обычно его двигает PATCH /storage-cells/order).
 */
export class UpdateStorageCellDto {
  @IsOptional()
  @IsString({ message: 'Код ячейки должен быть строкой' })
  code?: string;

  @IsOptional()
  @IsString({ message: 'Подпись должна быть строкой' })
  @MaxLength(MAX_CELL_NAME_LENGTH, { message: `Подпись не длиннее ${MAX_CELL_NAME_LENGTH} символов` })
  name?: string | null;

  // Потолок — чтобы значение не вылетело за INT (22003 → 500).
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  @Max(1_000_000, { message: 'Слишком большой порядок' })
  sortOrder?: number;
}
