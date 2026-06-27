import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

/**
 * Body for POST /account/delete — the in-app, self-service account deletion
 * required by Apple Guideline 5.1.1(v) and Google Play's data-deletion policy.
 *
 * Re-confirmation is mandatory to prevent accidental or coerced deletion:
 *   - `password` — the caller's CURRENT password, verified server-side against
 *     the stored bcrypt hash. An impersonation token (superadmin acting as a
 *     director) can never satisfy this, so it cannot delete a customer account.
 *   - `confirm`  — an explicit boolean the UI sets to `true` only after the user
 *     acknowledges the destructive confirmation dialog.
 */
export class DeleteAccountDto {
  @IsString()
  @IsNotEmpty()
  password!: string;

  // Required to be `true` by the service; typed optional here so a missing flag
  // yields our clear domain error instead of a generic validation 400.
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
