import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsUUID, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsNumber()
  @IsOptional()
  salaryPercent?: number;

  @IsNumber()
  @IsOptional()
  productSalaryPercent?: number;

  // ROLE-ONLY (консолидация 2026-07): персональные users.permissions удалены —
  // права меняются ТОЛЬКО через назначение роли (roleId ниже). Поле `permissions`
  // снято из контракта; ValidationPipe(whitelist) отбросит его, если пришлёт
  // старый клиент.

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsOptional()
  daysOff?: number[];

  /** 047 — gate for non-privileged users to submit expenses. */
  @IsBoolean()
  @IsOptional()
  canAddExpenses?: boolean;

  /** 047 — daily expense cap (RUB). Null → unlimited. */
  @IsNumber()
  @IsOptional()
  dailyExpenseLimit?: number | null;

  /** 055 — hide from Schedule grid + attendance Rating. */
  @IsBoolean()
  @IsOptional()
  hiddenFromSchedule?: boolean;

  /** 055 — hide everywhere (lists + cannot be chosen as master on new checks). */
  @IsBoolean()
  @IsOptional()
  hiddenEverywhere?: boolean;

  /**
   * 114 — назначенная роль (Bitrix24-style). uuid — системная роль или роль
   * своего тенанта (сервис валидирует); null — снять роль (возврат к
   * легаси-дефолтам строковой роли). @IsOptional пропускает и null, и
   * undefined — @IsUUID проверяет только реально присланную строку.
   */
  @IsUUID()
  @IsOptional()
  roleId?: string | null;
}
