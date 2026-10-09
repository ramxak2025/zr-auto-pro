import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  validateSync,
} from 'class-validator';

export class BookingOperationDto {
  @IsUUID('4') requestId!: string;
}
export class OptionalBookingOperationDto {
  @IsOptional() @IsUUID('4') requestId?: string;
}
export class PublicServiceSelectionDto {
  @IsUUID('4') serviceId!: string;
  @IsOptional() @IsInt() @Min(5) @Max(720) durationMinutes?: number;
}
export class BookingOperatorDto {
  @IsString() @MaxLength(200) @Matches(/^[^<>]*$/) name!: string;
  @IsString() @MaxLength(500) @Matches(/^[^<>]*$/) requisites!: string;
  @IsString() @MaxLength(300) @Matches(/^[^<>]*$/) contact!: string;
}
export class PublicBookingLinksDto {
  @IsOptional() @IsString() @MaxLength(32) @Matches(/^[+()\d\s-]{10,32}$/) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) instagram?: string;
  @IsOptional() @IsString() @MaxLength(500) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(500) vk?: string;
  @IsOptional() @IsString() @MaxLength(500) telegram?: string;
}
export type BookingHours = Record<string, { start: string; end: string } | null>;
export class PublicBookingSettingsDto extends BookingOperationDto {
  @IsInt() @Min(0) revision!: number;
  /** Accepted for old clients. New owner flows let the server generate it. */
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{2,63}$/) slug?: string;
  @IsString() @MaxLength(160) @Matches(/^[^<>]*$/) displayName!: string;
  @IsString() @MaxLength(500) @Matches(/^[^<>]*$/) address!: string;
  @IsString() @MaxLength(300) @Matches(/^[^<>]*$/) contacts!: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => PublicBookingLinksDto) links?: PublicBookingLinksDto;
  @IsBoolean() showPrices!: boolean;
  @IsIn(['instant', 'approval']) mode!: 'instant' | 'approval';
  @IsOptional() @IsInt() @Min(5) @Max(120) slotStepMinutes?: number;
  @IsOptional() @IsObject() openingHours?: BookingHours;
  /** Legacy inputs remain accepted; the server always supplies legal documents. */
  @IsOptional() @ValidateNested() @Type(() => BookingOperatorDto) operator?: BookingOperatorDto;
  @IsOptional() @IsString() @MaxLength(20000) @Matches(/^[^<>]*$/) policyText?: string;
  @IsOptional() @IsString() @MaxLength(20000) @Matches(/^[^<>]*$/) consentText?: string;
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PublicServiceSelectionDto)
  services!: PublicServiceSelectionDto[];
  @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4', { each: true }) resourceIds!: string[];
}
export class PublicBookingSubmitDto extends BookingOperationDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) recoveryToken!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @IsUUID('4', { each: true }) serviceIds!: string[];
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsOptional() @IsString() @Matches(/^[a-f0-9]{32}$/) resourceKey?: string;
  @IsString() @MinLength(1) @MaxLength(100) @Matches(/^[^<>\p{Cc}]*$/u) name!: string;
  @IsString() @Matches(/^[+()\d\s-]{10,32}$/) phone!: string;
  @IsOptional() @IsString() @MaxLength(1000) @Matches(/^[^<>]*$/) comment?: string;
  @IsUUID() consentVersion!: string;
  @Equals(true) consentAccepted!: true;
}
export class ApprovePublicBookingDto extends BookingOperationDto {
  @IsOptional() @IsUUID('4') resourceId?: string;
}
export class LinkBookingClientDto extends BookingOperationDto {
  @IsUUID('4') clientId!: string;
}
export function validatedBookingDto<T extends object>(type: new () => T, value: T): T {
  const dto = plainToInstance(type, value);
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length)
    throw new BadRequestException({
      code: 'INVALID_REQUEST',
      message: 'Проверьте поля формы',
      fields: errors.map((e) => e.property),
    });
  return dto;
}
