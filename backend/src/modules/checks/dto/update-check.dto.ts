import { IsString, IsOptional, IsNumber, IsEnum, IsBoolean } from 'class-validator';
import { PaymentMethod } from '../entities/check.entity';

export class UpdateCheckDto {
  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsNumber()
  mileage?: number;

  @IsOptional()
  @IsBoolean()
  isDeferred?: boolean;
}
