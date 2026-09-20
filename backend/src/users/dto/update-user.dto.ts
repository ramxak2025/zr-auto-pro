import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsUUID, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  fullName?: string;

  // 8, а не 6. Политика в проекте — восемь (profile/change-password,
  // registration, auth.service), и users.service тоже проверяет >= 8. Здесь же
  // годами стояло 6: пароль из 6–7 символов проходил DTO и отлетал уже в
  // сервисе, а клиенты при этом писали человеку «минимум 6 символов». Явный
  // message обязателен — без него class-validator отвечает по-английски
  // («password must be longer than or equal to 8 characters»), и этот текст
  // фильтр исключений отдаёт прямо в интерфейс.
  @IsString()
  @MinLength(8, { message: 'Пароль должен быть не менее 8 символов' })
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
