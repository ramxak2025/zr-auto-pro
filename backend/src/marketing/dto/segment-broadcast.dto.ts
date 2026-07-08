import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Segment criteria for a manual «Рассылки» broadcast. Criteria AND-combine and
 * are all optional — an empty segment resolves to every messageable (non-retail,
 * has-phone) client of the tenant, capped server-side.
 */
export class BroadcastSegmentDto {
  /** Last non-deferred visit older than N days (or never visited). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  lastVisitDays?: number;

  /** Acquisition source tag (clients.source) exact match. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  /** Only clients that currently owe money (client_debts balance > 0 OR open installment). */
  @IsOptional()
  @IsBoolean()
  hasDebt?: boolean;

  /** Explicit client id allow-list (still filtered to messageable clients). */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  clientIds?: string[];
}

/**
 * Write DTO for POST /marketing/broadcast/send. Choose the channel with
 * `integrationId` (a specific connected integration) or `providerType`; omit
 * both to use the tenant's default active channel. `idempotencyKey` makes a
 * retried request perfectly idempotent (no client double-charged).
 */
export class SegmentBroadcastDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BroadcastSegmentDto)
  segment?: BroadcastSegmentDto;

  @IsString()
  @MinLength(1, { message: 'Сообщение не может быть пустым' })
  @MaxLength(2000, { message: 'Сообщение слишком длинное' })
  message!: string;

  @IsOptional()
  @IsUUID()
  integrationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  providerType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}
