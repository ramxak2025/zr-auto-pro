import { IsString, IsNotEmpty, IsNumber, IsOptional, IsIn, Matches, MaxLength } from 'class-validator';

/**
 * Premium awarded by the owner. Either `amount` (for type='cash') or
 * `bonusPercent` (for type='rate_bonus') must be set; service validates
 * the conjunction.
 */
export class CreatePremiumDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsIn(['cash', 'rate_bonus'])
  type!: 'cash' | 'rate_bonus';

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsNumber()
  bonusPercent?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  // Round 16 (баг 2) — месяц-отнесение премии решает АТРИБУЦИЮ по месяцам
  // (getAll / getEmployeeMonth / listPremiums), поэтому формат жёсткий:
  // 'YYYY-MM' (единственный клиент — мобильная помесячная карточка — шлёт
  // ровно monthKey). Мусорный период молча уводил бы премию в fallback-месяц.
  @IsOptional()
  @IsString()
  @MaxLength(7)
  @Matches(/^\d{4}-\d{2}$/, { message: 'periodMonthYear должен быть в формате YYYY-MM' })
  periodMonthYear?: string;
}
