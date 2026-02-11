import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  IsDateString,
  IsUUID,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DeliveryItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  price: number;
}

export class CreateDeliveryDto {
  @IsUUID()
  @IsNotEmpty()
  supplierId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryItemDto)
  items: DeliveryItemDto[];

  @IsString()
  @IsOptional()
  comment?: string;

  @IsDateString()
  @IsOptional()
  date?: Date;
}
