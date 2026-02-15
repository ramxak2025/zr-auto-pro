import {
  IsString,
  IsUUID,
  IsOptional,
  IsNumber,
  IsEnum,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../entities/check.entity';

export class CreateCheckServiceDto {
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @IsUUID()
  masterId?: string;

  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CreateCheckProductDto {
  @IsUUID()
  productId: string;

  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  sellPrice: number;

  @IsNumber()
  @Min(0)
  costPrice: number;

  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CreateCheckDto {
  @IsUUID()
  masterId: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  carId?: string;

  @IsOptional()
  @IsString()
  clientName?: string;

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

  @IsOptional()
  @IsBoolean()
  isDeferred?: boolean;

  @IsOptional()
  @IsNumber()
  discount?: number;
}
