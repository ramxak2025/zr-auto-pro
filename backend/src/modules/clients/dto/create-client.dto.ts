import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  comment?: string;
}
