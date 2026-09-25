import { IsString, MaxLength } from 'class-validator';

/**
 * POST /vin/decode { vin }. Сырой ввод пользователя — сервер сам нормализует
 * (кириллица → латиница, I/O/Q → цифры). Некорректный VIN — это НЕ 400, а
 * 200 { valid:false }: поле ввода дёргает расшифровку на лету.
 */
export class DecodeVinDto {
  @IsString({ message: 'Укажите VIN' })
  @MaxLength(64, { message: 'VIN слишком длинный' })
  vin!: string;
}
