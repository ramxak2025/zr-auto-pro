import { IsArray, IsInt, IsOptional, IsString, ValidateNested, IsBoolean, ArrayMaxSize, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ImportRowInputDto {
  @IsInt()
  @Min(1)
  sourceRow!: number;

  @IsString()
  @IsOptional()
  clientName?: string | null;

  @IsString()
  @IsOptional()
  phoneRaw?: string | null;

  @IsString()
  @IsOptional()
  phone?: string | null;

  @IsString()
  @IsOptional()
  carPlate?: string | null;

  @IsString()
  @IsOptional()
  carModel?: string | null;

  @IsString()
  @IsOptional()
  notes?: string | null;

  @IsString()
  @IsOptional()
  originalClientText?: string | null;
}

export class ImportOptionsDto {
  @IsBoolean()
  @IsOptional()
  allowForeignPlates?: boolean;
}

const MAX_ROWS = 30_000;

export class ImportPreviewDto {
  @IsArray()
  @ArrayMaxSize(MAX_ROWS, { message: `Слишком большой файл: максимум ${MAX_ROWS} строк за один импорт` })
  @ValidateNested({ each: true })
  @Type(() => ImportRowInputDto)
  rows!: ImportRowInputDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ImportOptionsDto)
  options?: ImportOptionsDto;
}

export class ImportConfirmDto extends ImportPreviewDto {}
