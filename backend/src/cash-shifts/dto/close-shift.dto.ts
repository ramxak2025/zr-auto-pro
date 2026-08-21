import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Одна строка сдачи при закрытии смены (155): сотрудник и фактически сданная
 * им сумма. userId=null — «не распределено» (чеки без атрибуции).
 */
export class ShiftSettlementDto {
  @ValidateIf((o: ShiftSettlementDto) => o.userId !== null)
  @IsUUID('all', { message: 'Некорректный сотрудник в строке сдачи' })
  userId!: string | null;

  @IsNumber({}, { message: 'Сумма сдачи должна быть числом' })
  @Min(0, { message: 'Сумма сдачи не может быть отрицательной' })
  actualAmount!: number;
}

/** Write DTO for POST /cash-shifts/:id/close. */
export class CloseShiftDto {
  /** Фактический нал, пересчитанный кассиром при закрытии смены. >= 0. */
  @IsNumber({}, { message: 'Сумма должна быть числом' })
  @Min(0, { message: 'Сумма не может быть отрицательной' })
  closingAmount!: number;

  /**
   * 155 — сколько перевести в СЕЙФ (0..closingAmount). Остаток
   * (closingAmount − toSafeAmount) — размен, с которого стартует следующая
   * смена. Старые клиенты поле не шлют — всё остаётся в кассе.
   */
  @IsOptional()
  @IsNumber({}, { message: 'Сумма в сейф должна быть числом' })
  @Min(0, { message: 'Сумма в сейф не может быть отрицательной' })
  toSafeAmount?: number;

  /**
   * 155 — сдача по сотрудникам: Σ actualAmount должна сходиться с
   * closingAmount (допуск 1 копейка). Отсутствует — смена закрыта одной
   * общей суммой, таблица сдач остаётся пустой.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShiftSettlementDto)
  settlements?: ShiftSettlementDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Примечание слишком длинное' })
  note?: string;
}
