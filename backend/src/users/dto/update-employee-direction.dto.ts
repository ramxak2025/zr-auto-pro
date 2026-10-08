import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_EMPLOYEE_DIRECTION_NAME_LENGTH } from './create-employee-direction.dto';

export class UpdateEmployeeDirectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_EMPLOYEE_DIRECTION_NAME_LENGTH)
  @IsOptional()
  name?: string;
}
