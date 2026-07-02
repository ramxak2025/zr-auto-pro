import { IsInt, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for PATCH /roles/:id — частичное обновление СВОЕЙ (не системной) роли.
 * Отсутствующее поле не трогается; присланная `matrix` ЗАМЕНЯЕТ сохранённую
 * целиком (клиент волны 2 всегда держит полную матрицу с GET /roles — replace
 * детерминированнее слияния, как permissions в permission-templates.update).
 */
export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsObject()
  @IsOptional()
  matrix?: Record<string, Record<string, unknown>>;

  @IsInt()
  @IsOptional()
  sort?: number;
}
