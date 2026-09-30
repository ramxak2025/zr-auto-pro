import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { NoNulBytes } from './no-nul-bytes';

// Тела запросов кабинета МЕНЕДЖЕРА (`/manager/*`). Контракт — shared/api/types.ts
// (CreateManagerTenantRequest / ExtendSubscriptionRequest / ResetOwnerPasswordRequest).
// AssignPlanDto и SuspendTenantDto берём у tenants (тела те же).
//
// `whitelist: true` вырезает поля без декораторов. Это и есть «менеджерский
// `creditManager` игнорируется»: в ManagerExtendDto его нет намеренно — флаг
// суперадмина «оплату получил менеджер» менеджеру недоступен, его платные продления
// ВСЕГДА несут долю владельца (решает сервис по актору, а не по телу запроса).

/** Владелец (первый директор) создаваемого автосервиса. */
export class ManagerTenantDirectorDto {
  @IsString({ message: 'Укажите имя владельца автосервиса' })
  @IsNotEmpty({ message: 'Укажите имя владельца автосервиса' })
  @MaxLength(120, { message: 'Имя владельца слишком длинное' })
  @NoNulBytes()
  name!: string;

  /** Логин; формат проверяется в сервисе после normalizePhone. */
  @IsString({ message: 'Укажите телефон владельца' })
  @MaxLength(40, { message: 'Телефон слишком длинный' })
  phone!: string;

  @IsString({ message: 'Укажите пароль владельца' })
  @MinLength(6, { message: 'Пароль — не короче 6 символов' })
  @MaxLength(128, { message: 'Пароль слишком длинный' })
  password!: string;
}

/** POST /manager/tenants */
export class CreateManagerTenantDto {
  @IsString({ message: 'Укажите название автосервиса' })
  @IsNotEmpty({ message: 'Укажите название автосервиса' })
  @MaxLength(200, { message: 'Название слишком длинное' })
  @NoNulBytes()
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: 'Телефон слишком длинный' })
  @NoNulBytes()
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Адрес слишком длинный' })
  @NoNulBytes()
  address?: string;

  @IsString({ message: 'Выберите тариф' })
  @IsUUID('all', { message: 'Неверный идентификатор тарифа' })
  planId!: string;

  // ValidateNested молча пропускает undefined — IsDefined/IsObject закрывают «директор не передан».
  @IsDefined({ message: 'Укажите владельца автосервиса' })
  @IsObject({ message: 'Укажите владельца автосервиса' })
  @ValidateNested()
  @Type(() => ManagerTenantDirectorDto)
  director!: ManagerTenantDirectorDto;

  /**
   * Пробный доступ, дней. Верхний предел — `platform_settings.manager_max_free_days`
   * (настройка живёт в БД), его проверяет сервис; здесь — только «целое, ≥ 1» и
   * страховка от абсурда. Не передан — сервис выдаёт min(14, maxFreeDays).
   */
  @IsOptional()
  @IsInt({ message: 'Пробный период — целое число дней' })
  @Min(1, { message: 'Пробный период — не меньше 1 дня' })
  @Max(3650, { message: 'Слишком длинный пробный период' })
  trialDays?: number;

  /** Заметка менеджера об автосервисе → tenants.subscription_note. */
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Заметка слишком длинная' })
  @NoNulBytes()
  note?: string;
}

/**
 * POST /manager/tenants/:id/extend. В отличие от суперадминского тела `type`
 * ОБЯЗАТЕЛЕН: старой формы «просто дни» (она молча создавала бесплатную строку
 * без типа) в кабинете менеджера нет. Что ещё обязательно — зависит от типа и
 * проверяется в сервисе: free → `days` ≤ maxFreeDays, `until` запрещён; paid →
 * `amount > 0`.
 */
export class ManagerExtendDto {
  @IsIn(['paid', 'free'], { message: 'Укажите тип продления: платное или бесплатное' })
  type!: 'paid' | 'free';

  @IsOptional()
  @IsInt({ message: 'Срок — целое число дней' })
  @IsPositive({ message: 'Срок должен быть больше нуля' })
  @Max(3650, { message: 'Слишком длинный срок' })
  days?: number;

  /** Сумма оплаты, ₽ (NUMERIC(10,2)). Для paid обязательна и > 0 — это проверяет TenantsService.extend. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Сумма — число не более чем с двумя знаками после запятой' })
  @Min(0, { message: 'Сумма не может быть отрицательной' })
  @Max(99999999, { message: 'Слишком большая сумма' })
  amount?: number;

  /** Точная дата окончания (только paid). Для free сервис отвечает 400. */
  @IsOptional()
  @IsISO8601({}, { message: 'Дата окончания — в формате ГГГГ-ММ-ДД' })
  until?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Комментарий слишком длинный' })
  @NoNulBytes()
  note?: string;
}

/**
 * POST /manager/tenants/:id/{suspend,unsuspend}. Тело то же, что у tenants/SuspendTenantDto
 * (`reason?`), но с защитой от NUL: «причина» пишется в text-колонку, и NUL давал бы 500.
 * Свой класс, а не правка чужого DTO: суперадминский POST /tenants/:id/suspend не трогаем.
 */
export class ManagerSuspendDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @NoNulBytes()
  reason?: string;
}

/** POST /manager/tenants/:id/reset-owner-password */
export class ResetOwnerPasswordDto {
  @IsString({ message: 'Укажите новый пароль' })
  @MinLength(6, { message: 'Пароль — не короче 6 символов' })
  @MaxLength(128, { message: 'Пароль слишком длинный' })
  password!: string;
}
