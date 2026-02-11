import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(100)
  password?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  salaryPercent?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
