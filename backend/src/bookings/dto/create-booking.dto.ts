import { IsBoolean, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Write DTO for POST /bookings. */
export class CreateBookingDto {
  /** Client the appointment is for — must exist in the caller's tenant. */
  @IsUUID('4', { message: 'Некорректный клиент' })
  clientId!: string;

  /** Optional car of that client. */
  @IsOptional()
  @IsUUID('4', { message: 'Некорректный автомобиль' })
  carId?: string;

  /**
   * Master the booking is on. If the caller is a master and this is omitted,
   * the server defaults it to the caller. Admin/owner may pass any tenant
   * master or omit/null to leave it unassigned.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Некорректный мастер' })
  masterId?: string | null;

  /** Date + time of the appointment (ISO 8601, timestamptz). */
  @IsISO8601({}, { message: 'Некорректная дата записи' })
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Комментарий слишком длинный' })
  comment?: string;

  /** Whether to send the client a confirmation message on create (default true). */
  @IsOptional()
  @IsBoolean()
  notifyOnCreate?: boolean;
}
