import { IsString, IsOptional, IsNumber, IsObject, IsBoolean, IsArray, MinLength } from 'class-validator';

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

  @IsObject()
  @IsOptional()
  permissions?: Record<string, boolean>;

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
}
