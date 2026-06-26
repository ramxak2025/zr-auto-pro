import { IsIn, IsNumber, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Write DTO for POST /loyalty/adjust — owner-class manual bonus correction.
 *
 * `type='accrual'` credits, `type='redemption'` debits. A redemption that would
 * overdraw the client's balance is rejected (400) in the service. `reason` is
 * required so every manual correction carries an audit note.
 */
export class AdjustBonusDto {
  @IsUUID(undefined, { message: 'Некорректный клиент' })
  clientId!: string;

  /** Positive money amount of the correction. */
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0.01, { message: 'Сумма корректировки должна быть положительной' })
  amount!: number;

  @IsIn(['accrual', 'redemption'], { message: 'Некорректный тип корректировки' })
  type!: 'accrual' | 'redemption';

  @IsString()
  @MinLength(1, { message: 'Укажите причину корректировки' })
  @MaxLength(2000, { message: 'Причина слишком длинная' })
  reason!: string;
}
