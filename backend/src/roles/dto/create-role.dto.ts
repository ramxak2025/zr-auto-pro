import { IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /roles — создать кастомную роль тенанта.
 *
 * `matrix` — матрица «секция × действие × охват» (см. common/role-matrix.ts);
 * валидация ключей намеренно мягкая (@IsObject) — сервис прогоняет матрицу
 * через sanitizeRoleMatrix, так что неизвестные секции/действия и не-boolean
 * значения в jsonb не попадают (та же позиция, что у permission-templates).
 *
 * `copyFromRoleId` — источник копии (системная роль ИЛИ своя роль тенанта):
 * матрица источника берётся базой, `matrix` из body двухуровнево сливается
 * ПОВЕРХ — «копия Мастера, но checks.view='all'» одним запросом.
 */
export class CreateRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsObject()
  @IsOptional()
  matrix?: Record<string, Record<string, unknown>>;

  @IsUUID()
  @IsOptional()
  copyFromRoleId?: string;

  @IsInt()
  @IsOptional()
  sort?: number;
}
