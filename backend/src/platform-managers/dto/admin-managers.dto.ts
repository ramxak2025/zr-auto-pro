import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { NoNulBytes } from './no-nul-bytes';

// Тела запросов кабинета СУПЕРАДМИНА (`/admin/managers*`). Контракт — shared/api/types.ts
// (CreateManagerRequest / UpdateManagerRequest / CreateSettlementRequest /
// TransferTenantManagerRequest). Глобальный ValidationPipe работает с
// `whitelist: true`: поле без декоратора вырезается из тела, поэтому каждое
// поле контракта объявлено здесь. Формат телефона и «пустое после trim» проверяет
// сервис (после normalizePhone/trim) — из декораторов этого не выразить.

/** POST /admin/managers */
export class CreateManagerDto {
  @IsString({ message: 'Укажите имя менеджера' })
  @IsNotEmpty({ message: 'Укажите имя менеджера' })
  @MaxLength(120, { message: 'Имя слишком длинное' })
  @NoNulBytes()
  fullName!: string;

  /** Логин; формат проверяется в сервисе после normalizePhone. */
  @IsString({ message: 'Укажите телефон' })
  @MaxLength(40, { message: 'Телефон слишком длинный' })
  phone!: string;

  @IsString({ message: 'Укажите пароль' })
  @MinLength(6, { message: 'Пароль — не короче 6 символов' })
  @MaxLength(128, { message: 'Пароль слишком длинный' })
  password!: string;

  /** Доля владельца, % (0–100, NUMERIC(5,2)). Не передан — 60. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Доля владельца — число не более чем с двумя знаками после запятой' })
  @Min(0, { message: 'Доля владельца — от 0 до 100 %' })
  @Max(100, { message: 'Доля владельца — от 0 до 100 %' })
  ownerSharePercent?: number;

  /** Заметка суперадмина (users.owner_notes). */
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Заметка слишком длинная' })
  @NoNulBytes()
  note?: string;
}

/**
 * PATCH /admin/managers/:id — передаются только изменяемые поля.
 *
 * ПОЧЕМУ `ValidateIf(value !== undefined)`, А НЕ `IsOptional`. `IsOptional` пропускает и
 * `null`, а для этих полей `null` не значит ничего осмысленного: `ownerSharePercent: null`
 * молча сбрасывал бы долю в NULL (= 60 %), `fullName/phone/password: null` роняли бы сервис
 * (500), `isActive: null` упирался бы в NOT NULL. Поэтому «не передано» — только undefined,
 * а null получает честный 400. Исключение — `note`: null там и есть «очистить заметку».
 */
export class UpdateManagerDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: 'Укажите имя менеджера' })
  @MaxLength(120, { message: 'Имя слишком длинное' })
  @NoNulBytes()
  fullName?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: 'Укажите телефон' })
  @MaxLength(40, { message: 'Телефон слишком длинный' })
  phone?: string;

  /** Новый пароль; в журнал действий не пишется. */
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: 'Укажите пароль' })
  @MinLength(6, { message: 'Пароль — не короче 6 символов' })
  @MaxLength(128, { message: 'Пароль слишком длинный' })
  password?: string;

  /** Действует на БУДУЩИЕ платежи: у проведённых доля — снимок. */
  @ValidateIf((_, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Доля владельца — число не более чем с двумя знаками после запятой' })
  @Min(0, { message: 'Доля владельца — от 0 до 100 %' })
  @Max(100, { message: 'Доля владельца — от 0 до 100 %' })
  ownerSharePercent?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean({ message: 'Признак активности — true или false' })
  isActive?: boolean;

  /** null или пустая строка — очистить заметку (IsOptional пропускает null). */
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Заметка слишком длинная' })
  @NoNulBytes()
  note?: string | null;
}

/** POST /admin/managers/:id/settlements */
export class CreateSettlementDto {
  /**
   * ≠ 0 (ноль и «отрицательный без причины» проверяет сервис — там точные
   * тексты). NUMERIC(10,2): максимум 99 999 999.99.
   */
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Сумма — число не более чем с двумя знаками после запятой' })
  @Min(-99999999, { message: 'Слишком большая сумма' })
  @Max(99999999, { message: 'Слишком большая сумма' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Комментарий слишком длинный' })
  @NoNulBytes()
  note?: string;

  /** 'YYYY-MM-DD'; не передан — сегодня. Существование даты в календаре проверяет сервис. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Дата расчёта — в формате ГГГГ-ММ-ДД' })
  settledOn?: string;
}

/** PATCH /admin/tenants/:tenantId/manager — `managerId: null` снимает клиента с менеджера. */
export class TransferTenantManagerDto {
  // Не передан (undefined) — 400; null — легитимное «снять с менеджера»: ValidateIf
  // отключает проверку только для null.
  @ValidateIf((_, value) => value !== null)
  @IsUUID('all', { message: 'Неверный идентификатор менеджера' })
  managerId!: string | null;
}
