import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** PATCH /storage-cells/order — новый порядок ячеек: id в нужной последовательности. */
export class UpdateStorageCellsOrderDto {
  // Порядок снизу вверх: фильтр отдаёт клиенту только первое сообщение, «не список» должен идти первым.
  @IsUUID('all', { each: true, message: 'Некорректная ячейка' })
  @ArrayMaxSize(10000, { message: 'Слишком много ячеек за раз' })
  @IsArray({ message: 'Порядок ячеек должен быть списком' })
  orderedIds!: string[];
}
