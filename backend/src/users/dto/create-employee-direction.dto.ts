import { IsString, MaxLength, MinLength } from 'class-validator';

export const MAX_EMPLOYEE_DIRECTION_NAME_LENGTH = 64;

export class CreateEmployeeDirectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_EMPLOYEE_DIRECTION_NAME_LENGTH)
  name!: string;
}
