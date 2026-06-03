import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  IsUUID,
  IsArray,
  ValidateNested,
  IsNumber,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Categories ─────────────────────────────────────────────────────────────

export class CreateCategoryDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

// ─── Attachments ────────────────────────────────────────────────────────────

export class AttachmentDto {
  @IsString()
  @MaxLength(2000)
  url!: string;

  @IsString()
  @MaxLength(300)
  name!: string;

  @IsOptional()
  @IsNumber()
  size?: number;
}

// ─── Articles ───────────────────────────────────────────────────────────────

export class CreateArticleDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsIn(['article', 'regulation'])
  type?: 'article' | 'regulation';

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverImage?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

export class UpdateArticleDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsIn(['article', 'regulation'])
  type?: 'article' | 'regulation';

  // categoryId may be explicitly cleared by sending null — allow null through
  // class-validator so the service can move the article to "no category".
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverImage?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

// ─── Query params for the list endpoint ──────────────────────────────────────

export class ListArticlesQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(['article', 'regulation'])
  type?: 'article' | 'regulation';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  // Sent as the string "true"/"false" over the wire — kept as a plain string
  // so the service can interpret it without ValidationPipe rejecting a boolean
  // query string.
  @IsOptional()
  @IsString()
  pinned?: string;
}
