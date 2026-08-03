import {
  IsString,
  IsOptional,
  IsArray,
  IsIn,
  IsUrl,
  IsBoolean,
  IsInt,
  IsUUID,
  IsDateString,
  Min,
  Max,
  ValidateNested,
  MaxLength,
  ArrayMaxSize,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// Canonical user-facing notification categories. Kept in lock-step with the
// shared `NotificationCategory` union (shared/types/index.ts). Silent
// cache-invalidation pushes (sendDataToTenant) and superadmin broadcasts are
// intentionally NOT in this set — they're never user-mutable.
//
// Round 14 added the six that were shipping as UNGATED sendToUser calls: the
// user saw no toggle for them and had no way to turn them off.
export const NOTIFICATION_CATEGORIES = [
  'salary',
  'penalty',
  'check_assigned',
  'check_closed',
  'knowledge',
  'order_ready',
  'order_paid',
  'booking_reminder',
  'call_incoming',
  'profile_request',
  'account',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** 'HH:MM', 24h. Quiet hours are stored as local wall-clock time. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

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

/**
 * PUT /notifications/settings body — the GLOBAL switches (151), sent WHOLE
 * (replace-semantics, same contract style as preferences above; no PATCH
 * ambiguity about "absent vs null").
 *
 *   * masterEnabled — «Все уведомления». false ⇒ no category push at all.
 *   * sound         — false ⇒ banners arrive silently.
 *   * quietFrom/To  — 'HH:MM' local wall-clock, BOTH required to arm the window;
 *                     either null ⇒ quiet hours off. from > to crosses midnight.
 *   * tzOffsetMinutes — the device's UTC offset when it saved (MSK = 180), so
 *                     the server evaluates the window in the user's own time.
 */
export class UpdateNotificationSettingsDto {
  @IsBoolean()
  masterEnabled!: boolean;

  @IsBoolean()
  sound!: boolean;

  @IsOptional()
  @Matches(HH_MM, { message: 'quietFrom должен быть в формате ЧЧ:ММ' })
  quietFrom?: string | null;

  @IsOptional()
  @Matches(HH_MM, { message: 'quietTo должен быть в формате ЧЧ:ММ' })
  quietTo?: string | null;

  @IsOptional()
  @IsInt()
  @Min(-720)
  @Max(840)
  tzOffsetMinutes?: number | null;
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

// Subscription billing state a broadcast segment can target. Kept in lock-step
// with the shared `BroadcastSubscriptionStatus` union (shared/types/index.ts):
//   trial   — active & in-window but on a free (monthly_price = 0) plan;
//   paid    — active & in-window on a paid (monthly_price > 0) plan;
//   expired — subscription_end is in the past (lapsed).
export const BROADCAST_SUBSCRIPTION_STATUSES = ['trial', 'paid', 'expired'] as const;
export type BroadcastSubscriptionStatus = (typeof BROADCAST_SUBSCRIPTION_STATUSES)[number];

/**
 * Optional recipient segment for a superadmin broadcast (096). ABSENT / empty =
 * every active tenant (back-compat). Criteria AND-combine; the statuses inside
 * `subscriptionStatuses` OR-combine. Resolved to a FROZEN tenant set at SEND
 * time (notification_broadcast_recipients).
 */
export class BroadcastSegmentDto {
  /** Match tenants whose plan is any of these plan ids. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  planIds?: string[];

  /** Match tenants in any of these billing states. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BROADCAST_SUBSCRIPTION_STATUSES.length)
  @IsIn(BROADCAST_SUBSCRIPTION_STATUSES as unknown as string[], { each: true })
  subscriptionStatuses?: BroadcastSubscriptionStatus[];

  /** 'active' = has checks within the window; 'dormant' = none. */
  @IsOptional()
  @IsIn(['active', 'dormant'])
  activity?: 'active' | 'dormant';

  /** Activity window in days (default 30). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  activityWindowDays?: number;

  /** Include manually-disabled (is_active = false) tenants too (default false). */
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}

/**
 * POST /admin/broadcast body — superadmin only (guarded in the controller).
 *
 * `scheduledAt` (096) defers delivery to a future instant; omit / a past instant
 * = send immediately. `segment` (096) narrows the audience; omit / empty = all
 * active tenants. Both are additive — a body with neither behaves exactly like
 * the pre-096 immediate broadcast-to-everyone.
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

  /** ISO 8601 instant to defer delivery to. Omit / past = send now. */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  /** Recipient segment. Omit / empty = all active tenants. */
  @IsOptional()
  @ValidateNested()
  @Type(() => BroadcastSegmentDto)
  segment?: BroadcastSegmentDto;
}
