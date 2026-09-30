import { IsString, IsNotEmpty, IsNumber, IsOptional, IsIn, Matches } from 'class-validator';
import { MONTH_KEY_RE } from '../../common/period-membership';

export class CreateSalaryPaymentDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsNumber()
  amount!: number;

  // 'YYYY-MM' (месяц 01–12): «за какой месяц» выплата. Формат жёсткий — с
  // 2026-09-30 то же значение уходит в period_month зеркального расхода (у колонки
  // CHECK '^\d{4}-\d{2}$'), и мусор роняет бы транзакцию 500-й, а не 400-й.
  @IsString()
  @IsNotEmpty()
  @Matches(MONTH_KEY_RE, { message: 'monthYear должен быть в формате YYYY-MM' })
  monthYear!: string;

  @IsString()
  @IsOptional()
  @IsIn(['salary', 'advance'])
  type?: string;

  @IsString()
  @IsOptional()
  comment?: string;
}
