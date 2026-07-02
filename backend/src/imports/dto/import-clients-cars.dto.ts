import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
  IsBoolean,
  ArrayMaxSize,
  Min,
} from 'class-validator';
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

  /** Client comment («Комментарий» column) — stored on the client card. */
  @IsString()
  @IsOptional()
  clientComment?: string | null;

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

/**
 * Per-duplicate decision. `phoneKey` is the group key from the preview
 * response (last-10-digit national phone key — same key the whole app
 * dedups on, see migration 104/108).
 */
export class ImportDecisionDto {
  @IsString()
  phoneKey!: string;

  @IsIn(['replace', 'skip'])
  action!: 'replace' | 'skip';
}

export class ImportConfirmDto extends ImportPreviewDto {
  /**
   * Global choice for duplicate-phone groups without an explicit decision.
   * When BOTH `duplicateDefault` and `decisions` are absent the endpoint
   * keeps its legacy behaviour (reuse existing client + attach new cars),
   * so an already-open older web bundle keeps working mid-deploy.
   */
  @IsOptional()
  @IsIn(['replace', 'skip'])
  duplicateDefault?: 'replace' | 'skip';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ROWS)
  @ValidateNested({ each: true })
  @Type(() => ImportDecisionDto)
  decisions?: ImportDecisionDto[];
}
