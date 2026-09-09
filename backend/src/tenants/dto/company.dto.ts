import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SUPPORTED_TIMEZONE_IDS } from '../../common/timezone';

/**
 * PATCH /my-company body — реквизиты собственного тенанта (ключ company_manage).
 *
 * ВАЖНО ПРО whitelist. Глобальный `ValidationPipe({ whitelist: true })` вырезает
 * из тела всё, что здесь не объявлено. До появления этого DTO хендлер принимал
 * `any` и полагался на явные `if (dto.X !== undefined)` в
 * TenantsService.updateMyCompany. Поэтому список полей ниже — ЗЕРКАЛО того
 * метода: добавляя туда новое поле, объяви его и здесь, иначе оно тихо
 * потеряется по дороге.
 *
 * Валидация намеренно мягкая (строка + разумная длина): существующие клиенты
 * шлют реквизиты как есть, ужесточение формата (email/ИНН) сломало бы
 * сохранение уже заведённых данных. Единственное строгое поле — `timezone`:
 * неизвестный пояс ломает расчёт «сегодня», поэтому он проверяется по белому
 * списку.
 */
export class UpdateMyCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  kpp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  ogrn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  receiptFooter?: string;

  /** 070 — тумблер подсистемы «Смены». */
  @IsOptional()
  @IsBoolean()
  shiftsEnabled?: boolean;

  /** 092 — тумблер режима кассовой смены (дублирует PATCH /checks/pos-settings). */
  @IsOptional()
  @IsBoolean()
  shiftModeEnabled?: boolean;

  /** 156 — мульти-точки: общая (true) или раздельная (false) база клиентов. */
  @IsOptional()
  @IsBoolean()
  pointsSharedClients?: boolean;

  /**
   * 157 — часовой пояс автосервиса (IANA-id). Только из белого списка
   * российских поясов: от значения зависят «сегодня», смены и отчёты, и
   * произвольная строка сделала бы эти расчёты неопределёнными.
   */
  @IsOptional()
  @IsIn(SUPPORTED_TIMEZONE_IDS, { message: 'Неизвестный часовой пояс' })
  timezone?: string;
}
