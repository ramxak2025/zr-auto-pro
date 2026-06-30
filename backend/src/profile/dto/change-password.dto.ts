import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

/**
 * Body for POST /profile/password — self-service password change for EVERY role.
 *
 * The caller proves possession of the CURRENT password (bcrypt.compare against
 * the stored hash) and supplies a NEW one. Password is NEVER part of the
 * profile-change-request / approval flow — it never leaves the user's own hands
 * and is never exposed (old or new) to a владелец. The new value is hashed with
 * bcrypt cost 12 in the service and the plaintext is never logged or returned.
 *
 * Strength (8+ chars, an uppercase letter and a digit) is re-checked in the
 * service so the rule is enforced for Cyrillic-capital passwords too — the
 * MinLength here is the cheap first gate.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
