import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
export class KitComponentDto {
  @IsUUID('4') productId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity!: number;
}
export class KitRecipeDto {
  @IsString() @MaxLength(200) name!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((item: KitComponentDto) => item.productId)
  @ValidateNested({ each: true })
  @Type(() => KitComponentDto)
  components!: KitComponentDto[];
}
export class AssembleKitDto extends KitRecipeDto {
  @IsUUID('4') requestId!: string;
  @IsInt() @Min(1) @Max(10000) quantity!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) sellPrice!: number;
  @IsOptional() @IsUUID('4') warehouseId?: string;
  @IsOptional() @IsString() @MaxLength(500) category?: string;
  @IsOptional() @IsUUID('4') storageCellId?: string;
  @IsOptional() @IsUUID('4') recipeId?: string;
  @IsOptional() @IsInt() @Min(1) expectedRecipeVersion?: number;
}
export class DisassembleKitDto {
  @IsUUID('4') requestId!: string;
  @IsInt() @Min(1) expectedRevision!: number;
  @IsInt() @Min(1) @Max(10000) quantity!: number;
}
export class RecomposeKitDto extends AssembleKitDto {
  @IsInt() @Min(1) expectedRevision!: number;
}
