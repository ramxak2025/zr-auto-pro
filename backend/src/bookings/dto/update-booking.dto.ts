import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength, IsInt, Min, Max } from 'class-validator';

/**
 * Write DTO for PATCH /bookings/:id — reschedule / edit comment / reassign
 * master. All fields optional; only the provided ones are updated.
 */
export class UpdateBookingDto {
  @IsOptional() @IsUUID('4') requestId?: string;
  @IsOptional() @IsInt() @Min(5) @Max(1440) durationMinutes?: number;
  @IsOptional()
  @IsISO8601({}, { message: 'Некорректная дата записи' })
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Комментарий слишком длинный' })
  comment?: string;

  /**
   * Reassign the master. `null` clears the assignment (admin/owner only — a
   * master can only ever keep it on themselves). Use a UUID to set a specific
   * master.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Некорректный мастер' })
  masterId?: string | null;

  @IsOptional()
  @IsUUID('4', { message: 'Некорректный автомобиль' })
  carId?: string | null;
}
