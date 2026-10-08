import { IsString, IsNotEmpty, MinLength, IsOptional, IsNumber, IsUUID } from 'class-validator';

export class CreateUserDto {
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
  role?: string;

  @IsNumber()
  @IsOptional()
  salaryPercent?: number;

  // ROLE-ONLY (консолидация 2026-07): персональные users.permissions удалены.
  // Права нового сотрудника задаёт назначенная роль (roleId, опционально); без
  // неё сотрудник получает легаси-дефолты своей строковой роли (master и т.д.).
  @IsUUID()
  @IsOptional()
  roleId?: string;

  /** Tenant-owned grouping; the service allows assignment only for owner-class actors. */
  @IsUUID()
  @IsOptional()
  directionId?: string | null;

  // Target tenant for the new user. Declared here so the global whitelisting
  // ValidationPipe does not strip it. Only a superadmin caller may target
  // another tenant (enforced in the controller); ignored for everyone else.
  @IsString()
  @IsOptional()
  tenantId?: string;
}
