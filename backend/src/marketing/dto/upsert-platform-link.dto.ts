import { IsBoolean, IsIn, IsOptional, IsUrl, MaxLength } from 'class-validator';

// Mirrors the CHECK constraint on review_platform_links.platform (007 + 054).
export const REVIEW_PLATFORMS = ['google', 'yandex', '2gis', 'avito'] as const;

/** Write DTO for POST /marketing/platform-links. */
export class UpsertPlatformLinkDto {
  @IsIn(REVIEW_PLATFORMS, { message: 'Неизвестная платформа отзывов' })
  platform!: string;

  // require_tld:false — same relaxation as SubmitReviewDto (short local URLs).
  @IsUrl({ require_tld: false }, { message: 'Некорректная ссылка' })
  @MaxLength(500, { message: 'Ссылка слишком длинная' })
  url!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
