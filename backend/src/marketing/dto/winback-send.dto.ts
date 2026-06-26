import { IsInt, IsString, Max, MaxLength, MinLength, Min } from 'class-validator';

/**
 * Write DTO for POST /marketing/winback/send — broadcast a single message to
 * every client in the «давно не приезжал» segment (last non-deferred check
 * older than `days`, or no check at all).
 */
export class WinbackSendDto {
  @IsInt({ message: 'Количество дней должно быть числом' })
  @Min(1)
  @Max(3650)
  days!: number;

  @IsString()
  @MinLength(1, { message: 'Сообщение не может быть пустым' })
  @MaxLength(2000, { message: 'Сообщение слишком длинное' })
  message!: string;
}
