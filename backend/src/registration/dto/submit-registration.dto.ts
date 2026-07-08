import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PUBLIC body of POST /registration-requests — a prospective autoservice owner's
 * self-service registration request, submitted UNAUTHENTICATED from the login
 * screen.
 *
 * The owner CHOOSES their password here (phone + password). It is bcrypt-hashed
 * in the service and stored ONLY as a hash; on approve the created owner account
 * reuses that hash so the person logs in immediately with the same credentials.
 *
 * Lengths are capped to blunt spam / oversized-payload abuse. `password` is
 * capped at 72 bytes because bcrypt silently truncates beyond 72 — a longer
 * value would give a false sense of strength and make the stored/verified prefix
 * ambiguous. Phone is validated only for shape here (non-empty, bounded); the
 * service normalizes it to the canonical +7XXXXXXXXXX form.
 */
export class SubmitRegistrationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  companyName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  ownerName!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(32)
  phone!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
