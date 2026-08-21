import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body DTO для DELETE /suppliers/deliveries/:id — soft-delete поставки (154).
 * Причина опциональна, пишется в deliveries.delete_reason.
 */
export class DeleteDeliveryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Причина слишком длинная' })
  reason?: string;
}
