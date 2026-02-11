import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultPrice?: number;
}
