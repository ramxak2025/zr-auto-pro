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
  IsDateString,
  Min,
  MaxLength,
  ArrayMaxSize,
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

  /**
   * Attachment kind. Optional + backward-compatible: legacy attachments without
   * `type` are kept as-is (the service treats them as document/image). Only
   * `type: 'video'` triggers the video-URL whitelist check in the service.
   */
  @IsOptional()
  @IsIn(['image', 'video', 'document'])
  type?: 'image' | 'video' | 'document';

  /** For `type: 'video'` — how the `url` is embedded/played. */
  @IsOptional()
  @IsIn(['youtube', 'vk', 'embed'])
  videoType?: 'youtube' | 'vk' | 'embed';
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

  // ─── Регламенты+ extras ─────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  mandatory?: boolean;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  /** Optional car-make tag for contextual KB (e.g. 'Lada'). null = all makes. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  carMake?: string | null;
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

  // ─── Регламенты+ extras ─────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  mandatory?: boolean;

  // null clears the due date.
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  carMake?: string | null;

  /**
   * When true (or when the body actually changes), bump the regulation's
   * version — which re-requires every user to acknowledge the new version.
   */
  @IsOptional()
  @IsBoolean()
  bumpVersion?: boolean;
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

  /**
   * Optional facet: keep only articles whose attachments contain at least one
   * attachment of this kind (e.g. 'video' for "статьи с видео"). Purely
   * additive — omitting it leaves the existing title+body search untouched.
   */
  @IsOptional()
  @IsIn(['image', 'video', 'document'])
  hasAttachmentType?: 'image' | 'video' | 'document';
}

// ─── A. Учебный центр — courses, lessons, quizzes ─────────────────────────────

export class CreateCourseDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverImage?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverImage?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class QuizQuestionDto {
  @IsString()
  @MaxLength(500)
  question!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  options!: string[];

  @IsInt()
  @Min(0)
  correctIndex!: number;
}

export class CreateLessonDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  quiz?: QuizQuestionDto[] | null;
}

export class UpdateLessonDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // null clears the quiz.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  quiz?: QuizQuestionDto[] | null;
}

export class CompleteLessonDto {
  /** Answer index per quiz question. Required only when the lesson has a quiz. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  answers?: number[];
}

// ─── B. Article feedback ──────────────────────────────────────────────────────

export class ArticleFeedbackDto {
  @IsBoolean()
  helpful!: boolean;
}

// ─── C. Troubleshooting (типовые неисправности) ───────────────────────────────

export class CreateTroubleshootingDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  system?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  carMake?: string | null;

  @IsOptional()
  @IsString()
  symptom?: string;

  @IsOptional()
  @IsString()
  cause?: string;

  @IsOptional()
  @IsString()
  solution?: string;

  @IsOptional()
  @IsIn(['low', 'med', 'high'])
  severity?: 'low' | 'med' | 'high' | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  tags?: string[];
}

export class UpdateTroubleshootingDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  system?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  carMake?: string | null;

  @IsOptional()
  @IsString()
  symptom?: string;

  @IsOptional()
  @IsString()
  cause?: string;

  @IsOptional()
  @IsString()
  solution?: string;

  @IsOptional()
  @IsIn(['low', 'med', 'high'])
  severity?: 'low' | 'med' | 'high' | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  tags?: string[];
}

export class ListTroubleshootingQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  system?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  carMake?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  tag?: string;
}

// ─── D. Contextual KB (for a check/car) ───────────────────────────────────────

export class ForCarQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;
}
