import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { BaseCheckDto, CheckProductLineDto, CheckServiceLineDto } from './check-line.dto';

/**
 * PATCH /checks/:id body (item 2). Covers all three service paths that read
 * it: the plain field update (date/payment/cash/card/paymentStatus), the
 * deferred activation (bare `isDeferred:false`) and fullUpdate/editClosedCheck
 * (services/products line rewrite). Everything optional — partial edits are
 * the norm here (e.g. `{ isDeferred: false }` from the check detail screens).
 */
export class UpdateCheckDto extends BaseCheckDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentStatus?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CheckServiceLineDto)
  services?: CheckServiceLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CheckProductLineDto)
  products?: CheckProductLineDto[];
}
