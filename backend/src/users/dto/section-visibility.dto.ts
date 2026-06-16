import { IsArray, IsBoolean, IsIn, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

// 071 — per-employee top-level section visibility. The five stable keys mirror
// the CHECK constraint in 071_section_visibility.sql and the union in
// shared/types/index.ts (`SectionVisibility.sectionKey`). Keep all three in sync.
export const SECTION_KEYS = ['work', 'finance', 'warehouse', 'marketing', 'other'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export class SectionVisibilityItemDto {
  @IsIn(SECTION_KEYS as unknown as string[])
  sectionKey!: SectionKey;

  @IsBoolean()
  isVisible!: boolean;
}

export class UpdateSectionVisibilityDto {
  @IsArray()
  // Body can carry at most one entry per known key; cap well above 5 to reject
  // obviously forged payloads without being brittle if the key set grows.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SectionVisibilityItemDto)
  sections!: SectionVisibilityItemDto[];
}
