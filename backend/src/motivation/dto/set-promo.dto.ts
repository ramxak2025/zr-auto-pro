import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean, Min, Max, IsDateString } from 'class-validator';

/**
 * Upsert a product into the «акционные товары» motivation programme. Keyed by
 * (tenant, productId) server-side — calling it again for the same product updates
 * the existing promo. `percent` is the bonus rate applied to the sale MARGIN.
 */
export class SetPromoDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  /** Bonus percent of margin (0..100). 0 effectively disables the bonus. */
  @IsNumber()
  @Min(0)
  @Max(100)
  percent!: number;

  /** Pause without deleting. Defaults to true (active) on first set. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Optional promo window start (ISO). NULL/omitted = no lower bound. */
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  /** Optional promo window end (ISO). NULL/omitted = no upper bound. */
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
