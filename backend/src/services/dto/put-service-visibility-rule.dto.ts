import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PutServiceVisibilityRuleDto {
  @IsOptional()
  @IsUUID('all')
  serviceId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  categoryPath?: string | null;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  visibleRoleIds!: string[];
}
