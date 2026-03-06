import { IsString, IsOptional, IsNumber, IsObject, IsBoolean, IsArray, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsNumber()
  @IsOptional()
  salaryPercent?: number;

  @IsNumber()
  @IsOptional()
  productSalaryPercent?: number;

  @IsObject()
  @IsOptional()
  permissions?: Record<string, boolean>;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsOptional()
  daysOff?: number[];
}
