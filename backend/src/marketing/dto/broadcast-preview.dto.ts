import { IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BroadcastSegmentDto } from './segment-broadcast.dto';

/**
 * DTO для POST /marketing/broadcast/preview — dry-run ручной рассылки.
 * Тот же выбор сегмента и канала, что у SegmentBroadcastDto, но БЕЗ message
 * (текст на предпросмотр числа получателей не влияет) и без idempotencyKey
 * (ничего не отправляется — нечего делать идемпотентным).
 */
export class BroadcastPreviewDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BroadcastSegmentDto)
  segment?: BroadcastSegmentDto;

  @IsOptional()
  @IsUUID()
  integrationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  providerType?: string;
}
