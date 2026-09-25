import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query GET /reports/builder/:reportId. Здесь только форма (whitelist +
 * длина): содержательная валидация — период, формат дат, лимит 366 дней,
 * uuid в `ids`, `groupBy` по каталогу — в ReportBuilderService с русскими
 * сообщениями (HttpExceptionFilter показывает их пользователю дословно).
 */
export class ReportQueryDto {
  @IsOptional()
  @IsString({ message: 'Дата начала: формат ГГГГ-ММ-ДД' })
  @MaxLength(10, { message: 'Дата начала: формат ГГГГ-ММ-ДД' })
  dateFrom?: string;

  @IsOptional()
  @IsString({ message: 'Дата окончания: формат ГГГГ-ММ-ДД' })
  @MaxLength(10, { message: 'Дата окончания: формат ГГГГ-ММ-ДД' })
  dateTo?: string;

  /** CSV выбранных сущностей (uuid через запятую). Пусто = все. */
  @IsOptional()
  @IsString({ message: 'Фильтр: неверный формат' })
  @MaxLength(20_000, { message: 'Фильтр: слишком много выбранных значений' })
  ids?: string;

  @IsOptional()
  @IsString({ message: 'Группировка: неверный формат' })
  @MaxLength(64, { message: 'Группировка: неверный формат' })
  groupBy?: string;
}
