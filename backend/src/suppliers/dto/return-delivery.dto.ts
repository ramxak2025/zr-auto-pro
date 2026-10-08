import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReturnDeliveryItemDto {
  @IsUUID('4') deliveryItemId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
}
export class ReturnDeliveryDto {
  @IsOptional() @IsUUID() requestId?: string;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  /** Omit to return all outstanding source quantities. Empty arrays are invalid. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnDeliveryItemDto)
  items?: ReturnDeliveryItemDto[];
}

export class SupplierReturnsQueryDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() deliveryId?: string;
}
