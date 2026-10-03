import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ENTITY_TYPES, EntityType } from './one-c.types';
export class CreateConnectionDto {
  @IsUUID() pointId!: string;
}
export class ConfigureConnectionDto {
  @IsOptional() @IsUUID() pointId?: string;
  @IsOptional() @IsIn(['paused', 'active']) status?: 'paused' | 'active';
  @IsOptional() @IsBoolean() mappingConfirmed?: boolean;
  @IsOptional() @IsObject() capabilities?: Record<string, unknown>;
}
export class ImportEventDto {
  @IsString() @MinLength(1) @MaxLength(200) eventId!: string;
  @IsIn(ENTITY_TYPES) entityType!: EntityType;
  @IsString() @MinLength(1) @MaxLength(200) externalId!: string;
  @IsOptional() @Matches(/^[a-f0-9]{64}$/) baseRevision?: string;
  @IsObject() payload!: Record<string, unknown>;
}
export class AckItemDto {
  @IsUUID() autexaId!: string;
  @IsString() @MinLength(1) @MaxLength(200) externalId!: string;
  @Matches(/^[a-f0-9]{64}$/) revision!: string;
}
export class AckDto {
  @IsIn(ENTITY_TYPES) entityType!: EntityType;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AckItemDto)
  items!: AckItemDto[];
}
