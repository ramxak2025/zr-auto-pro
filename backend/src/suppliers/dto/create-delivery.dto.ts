import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsInt,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateDeliveryItemDto {
  @IsUUID('4') productId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) sellPrice?: number;
}
export class CreateDeliveryDto {
  @IsUUID('4') supplierId!: string;
  /** Private scanned-invoice confirmation; linked atomically with this receipt. */
  @IsOptional() @IsUUID('4') invoiceDocumentId?: string;
  @IsOptional() @IsDateString() invoiceDocumentDate?: string;
  @IsOptional() @IsInt() @Min(1) expectedInvoiceVersion?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) invoiceLineIds?: string[];
  @IsOptional() @IsUUID() requestId?: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryItemDto)
  items!: CreateDeliveryItemDto[];
}
