import { IsUUID } from 'class-validator';

/**
 * Write DTO for POST /bookings/:id/convert. Called by the mobile app AFTER a
 * check has been saved from the «приход» flow — links that check to the
 * booking and flips status to 'converted'. The checks create contract is NOT
 * touched; conversion is decoupled here.
 */
export class ConvertBookingDto {
  /** The check created from this booking — must belong to the caller's tenant. */
  @IsUUID('4', { message: 'Некорректный чек' })
  checkId!: string;
}
