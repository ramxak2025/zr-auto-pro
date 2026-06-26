import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Write DTO for POST /cash-shifts/:id/collect (инкассация). */
export class CollectCashDto {
  /** Cash pulled from the drawer (handed to owner / banked). Must be positive. */
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0.01, { message: 'Сумма инкассации должна быть положительной' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Примечание слишком длинное' })
  note?: string;
}
