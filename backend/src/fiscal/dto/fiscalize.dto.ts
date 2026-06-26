import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Write DTO for POST /fiscal/fiscalize.
 *
 * The receipt itself is built SERVER-SIDE from the tenant-scoped check (`checkId`);
 * the client only supplies where to send the electronic receipt. At least one of
 * email/phone must resolve (here or from the check's client phone) — enforced in
 * the service, since either is acceptable to 54-ФЗ.
 */
export class FiscalizeDto {
  /** The заказ-наряд (check) to fiscalize. Must belong to the caller's tenant. */
  @IsUUID('4', { message: 'Некорректный идентификатор чека' })
  checkId!: string;

  /** Client email for the electronic receipt (optional if a phone is available). */
  @IsOptional()
  @IsEmail({}, { message: 'Некорректный email' })
  @MaxLength(255)
  email?: string;

  /** Client phone for the electronic receipt (optional if an email is available). */
  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'Некорректный телефон' })
  phone?: string;
}
