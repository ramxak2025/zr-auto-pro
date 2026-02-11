import {
  IsString,
  IsOptional,
  IsEmail,
  IsInt,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsers?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(50)
  ownerUsername: string;

  @IsString()
  @MinLength(6)
  @MaxLength(100)
  ownerPassword: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  ownerFullName: string;
}
