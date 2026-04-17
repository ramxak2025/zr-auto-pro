import { IsString, IsNotEmpty, IsNumber, IsOptional, IsIn } from 'class-validator';

export class CreateSalaryPaymentDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsNumber()
  amount!: number;

  @IsString()
  @IsNotEmpty()
  monthYear!: string;

  @IsString()
  @IsOptional()
  @IsIn(['salary', 'advance'])
  type?: string;

  @IsString()
  @IsOptional()
  comment?: string;
}
