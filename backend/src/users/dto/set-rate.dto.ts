import { IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * Round 14 (150) — смена ставки мастера «за месяц» (PATCH /users/:id/rate).
 * `month` — 'YYYY-MM' (прошлый / текущий / будущий); хотя бы один процент
 * обязателен (проверяет сервис). Прошлый месяц пересчитывается новой ставкой
 * (только он); текущий — дополнительно обновляет users.* (источник запекания
 * новых чеков); будущий — фиксируется в истории и применится cron-ом, когда
 * месяц наступит.
 */
export class SetRateDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  /** Процент за работы (services), 0..100. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  salaryPercent?: number;

  /** Процент с маржи товаров, 0..100. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  productSalaryPercent?: number;
}
