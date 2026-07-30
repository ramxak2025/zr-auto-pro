import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Write DTO for POST /installments/:planId/guarantors — добавить поручителя
 * (Round 13 #6). Обязательно только ФИО; «кем приходится» и телефон опциональны
 * (R12: пустой телефон легален — тогда кнопки «Позвонить»/WhatsApp просто
 * не активны).
 */
export class CreateGuarantorDto {
  @IsString()
  @IsNotEmpty({ message: 'Укажите имя поручителя' })
  @MaxLength(200, { message: 'Имя поручителя слишком длинное' })
  fullName!: string;

  /** «Кем приходится» должнику: брат / сосед / коллега… */
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Поле «кем приходится» слишком длинное' })
  relation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32, { message: 'Телефон слишком длинный' })
  phone?: string;
}
