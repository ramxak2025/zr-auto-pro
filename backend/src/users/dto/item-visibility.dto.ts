import { IsArray, IsBoolean, IsString, MaxLength, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

// 073 — canonical item-key set, grouped by the same five buckets as
// SECTION_KEYS. MUST stay in sync with shared/types/index.ts (`ITEM_KEYS`) and
// the «Ещё» menu rows in mobile/src/screens/MoreScreen.tsx. The backend keeps no
// DB CHECK on item_key (set may grow); this is the source of truth used to
// materialize defaults on read.
export const ITEM_KEYS_BY_SECTION = {
  work: ['schedule', 'clients', 'knowledge-base'],
  finance: ['cashflow', 'salary', 'expenses', 'reports'],
  warehouse: ['services', 'suppliers', 'equipment', 'warehouse-analytics'],
  marketing: ['marketing', 'calls', 'mailings', 'integrations'],
  other: ['employees', 'users', 'company-settings', 'subscription'],
} as const;

export const ALL_ITEM_KEYS: readonly string[] = Object.values(ITEM_KEYS_BY_SECTION).flat();

// Items an owner-class account (director / superadmin) can NEVER lose — the
// access floor that prevents self-lockout. Mirrors the section-visibility rule
// that keeps the «work» group visible for owners.
export const OWNER_PROTECTED_ITEM_KEYS: readonly string[] = ['users', 'company-settings', 'subscription'];

// 073 — per-employee ITEM (sub-section) visibility. Unlike section-visibility,
// there is NO fixed enum of keys: the «Ещё» menu set grows over time, so the
// canonical set lives in the application layer (shared ITEM_KEYS / ALL_ITEM_KEYS)
// and the DB has no CHECK constraint. We still validate shape (non-empty string,
// bounded length) so a forged payload can't write garbage keys.
export class ItemVisibilityItemDto {
  @IsString()
  @MaxLength(64)
  itemKey!: string;

  @IsBoolean()
  isVisible!: boolean;
}

export class UpdateItemVisibilityDto {
  @IsArray()
  // Bound the body well above the current ~19 known keys to reject obviously
  // forged payloads without being brittle as the menu grows.
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemVisibilityItemDto)
  items!: ItemVisibilityItemDto[];
}
