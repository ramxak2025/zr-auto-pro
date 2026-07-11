import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * POST /cars/:id/transfer-owner — reassign a car to a different client
 * («сменить владельца»), optionally carrying the car's full check history
 * (and the debt / installment / loyalty ledger entries derived from those
 * checks) over to the new owner.
 */
export class TransferOwnerDto {
  /** New owner (client) id. Must exist in the caller's tenant. */
  @IsUUID('all', { message: 'Некорректный клиент' })
  clientId!: string;

  /**
   * Move the car's check history to the new owner too. Defaults to true
   * (full transfer). false → only the car's owner changes; past checks stay
   * attributed to the previous client.
   */
  @IsOptional()
  @IsBoolean()
  moveHistory?: boolean;
}
