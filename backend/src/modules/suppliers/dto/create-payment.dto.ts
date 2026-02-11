import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsDateString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
  @IsNotEmpty()
  supplierId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsDateString()
  @IsOptional()
  date?: Date;
}
