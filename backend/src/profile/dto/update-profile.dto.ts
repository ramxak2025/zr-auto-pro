import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for PATCH /profile — self profile edit of ФИО / телефон / аватар.
 *
 * Every field is OPTIONAL: the client sends only what changed (a partial PATCH).
 * The global ValidationPipe runs with `whitelist: true`, so any field without a
 * decorator here is stripped — password can NEVER ride in on this endpoint (it
 * has its own self-service path, POST /profile/password).
 *
 * Role branching (enforced in ProfileService, NOT here):
 *   • director / superadmin → applied directly to `users`.
 *   • admin / master        → creates a profile_change_request for owner review.
 *
 * `avatar`: a URL (after /uploads) or empty string to clear. We keep it as a
 * plain optional string and treat '' as "clear to NULL" in the service. No
 * MaxLength cap — an inline data-URL avatar can be large and the body limit
 * (50 MB, main.ts) already bounds it.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}
