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

  // Target tenant for the new user. Declared here so the global whitelisting
  // ValidationPipe does not strip it. Only a superadmin caller may target
  // another tenant (enforced in the controller); ignored for everyone else.
  @IsString()
  @IsOptional()
  tenantId?: string;
}
