import { IsString, IsOptional, IsArray, IsIn, IsUrl, ValidateNested, MaxLength, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

// Canonical user-facing notification categories. Kept in lock-step with the
// shared `NotificationCategory` union (shared/types/index.ts). Silent
// cache-invalidation pushes (sendDataToTenant) and superadmin broadcasts are
// intentionally NOT in this set — they're never user-mutable.
export const NOTIFICATION_CATEGORIES = ['salary', 'penalty', 'check_assigned', 'check_closed', 'knowledge'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

// ─── Preferences ─────────────────────────────────────────────────────────────

/**
 * PUT /notifications/preferences body — the FULL set of MUTED categories.
 * Replace-semantics: whatever is sent becomes the user's complete mute list
 * (anything omitted is unmuted). Unknown categories are rejected by @IsIn so a
 * stale client can't write garbage rows.
 */
export class UpdatePreferencesDto {
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_CATEGORIES.length)
  @IsIn(NOTIFICATION_CATEGORIES as unknown as string[], { each: true })
  muted!: NotificationCategory[];
}

// ─── Broadcasts ──────────────────────────────────────────────────────────────

export class BroadcastButtonDto {
  @IsString()
  @MaxLength(60)
  label!: string;

  @IsIn(['dismiss', 'link'])
  action!: 'dismiss' | 'link';

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}

/**
 * POST /admin/broadcast body — superadmin only (guarded in the controller).
 */
export class CreateBroadcastDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => BroadcastButtonDto)
  buttons?: BroadcastButtonDto[];
}
