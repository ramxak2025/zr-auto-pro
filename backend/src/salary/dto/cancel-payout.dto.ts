import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Round 15 (153) — отмена выплаты владельцем (pending И accepted).
 * Причина необязательна, но показывается сотруднику (пуш) и в зачёркнутой
 * строке выплаты; пишется в аудит.
 */
export class CancelPayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
