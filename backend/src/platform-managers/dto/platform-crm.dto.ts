import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { NoNulBytes } from './no-nul-bytes';

export class CreatePlatformTenantNoteDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @NoNulBytes()
  text!: string;

  @IsUUID()
  requestId!: string;
}

export class SetPlatformTenantFollowUpDto {
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsDefined()
  @IsISO8601({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/i, { message: 'Укажите дату и время с часовым поясом' })
  nextContactAt!: string | null;
}

export class PlatformReminderSettingsDto {
  @IsBoolean()
  expiryEnabled!: boolean;

  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(30, { each: true })
  daysBefore!: number[];

  @IsBoolean()
  pushEnabled!: boolean;
}
