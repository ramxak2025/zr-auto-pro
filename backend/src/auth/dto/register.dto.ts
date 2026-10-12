import { IsArray, ArrayMaxSize } from 'class-validator';
import { IsString, IsNotEmpty, MinLength, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  starterDirections?: string[];

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @MinLength(8, { message: 'Пароль должен быть не менее 8 символов' })
  password!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsOptional()
  tenantName?: string;
}
