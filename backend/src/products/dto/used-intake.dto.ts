import { IsNumber, IsUUID, Min } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class UsedIntakeDto extends CreateProductDto {
  @IsUUID('4')
  requestId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;
}
