import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateDeliveryItemDto } from '../suppliers/dto/create-delivery.dto';

export class PrepareInvoiceDto {
  @IsUUID('4') supplierId!: string;
  @IsOptional() @IsUUID('4') orderId?: string;
}
export class InvoiceVersionDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class InvoiceContextDto extends InvoiceVersionDto {
  @IsOptional()
  @IsUUID('4')
  orderId?: string | null;
}
export class MapInvoiceLineDto extends InvoiceVersionDto {
  @IsUUID('4') productId!: string;
  @IsOptional() @IsBoolean() remember?: boolean;
}
export class ConfirmInvoiceLineDto extends CreateDeliveryItemDto {
  @IsUUID('4') lineId!: string;
  @IsOptional() @IsUUID('4') orderItemId?: string;
}
export class ConfirmInvoiceDto extends InvoiceVersionDto {
  @IsUUID('4') requestId!: string;
  @IsISO8601({ strict: true }) date!: string;
  /** Explicit receipt backdating only; the recognized date is the document date. */
  @IsOptional() @IsISO8601({ strict: true }) receivedAt?: string;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ConfirmInvoiceLineDto)
  items!: ConfirmInvoiceLineDto[];
}
