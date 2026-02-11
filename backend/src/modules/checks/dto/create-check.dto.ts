import {
  IsString,
  IsUUID,
  IsOptional,
  IsNumber,
  IsEnum,
  IsArray,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../entities/check.entity';

export class CreateCheckServiceDto {
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsString()
  name: string;

  @IsNumber()
  price: number;

  @IsNumber()
  quantity: number;
}

export class CreateCheckProductDto {
  @IsUUID()
  productId: string;

  @IsString()
  name: string;

  @IsNumber()
  sellPrice: number;

  @IsNumber()
  costPrice: number;

  @IsNumber()
  quantity: number;
}

export class CreateCheckDto {
  @IsUUID()
  masterId: string;

  @IsUUID()
  clientId: string;

  @IsUUID()
  carId: string;

  @IsOptional()
  @IsNumber()
  mileage?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCheckServiceDto)
  services: CreateCheckServiceDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCheckProductDto)
  products: CreateCheckProductDto[];

  @IsOptional()
  @IsString()
  comment?: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsDateString()
  date?: string;
}
