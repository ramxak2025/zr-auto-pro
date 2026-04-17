import { IsString, IsNotEmpty, MinLength, IsOptional, IsNumber, IsEnum, IsObject, IsBoolean } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsNumber()
  @IsOptional()
  salaryPercent?: number;

  @IsObject()
  @IsOptional()
  permissions?: Record<string, boolean>;
}
