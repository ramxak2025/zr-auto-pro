import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class CreateCarDto {
  @IsString()
  @IsNotEmpty()
  plateNumber: string;

  @IsString()
  @IsNotEmpty()
  makeModel: string;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsUUID()
  @IsNotEmpty()
  clientId: string;
}
