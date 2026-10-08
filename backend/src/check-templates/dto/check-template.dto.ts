import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Тело POST /check-templates и PUT /check-templates/:id (правка «услуги в Кассе
 * без количества», 2026-09-30).
 *
 * Проектные ограничения (живой тенант — легитимный запрос отвергать нельзя):
 *   • Объявлены ВСЕ поля, которые шлют клиенты (web CheckTemplatesModals, mobile
 *     TemplateEditorScreen): глобальный ValidationPipe работает с `whitelist: true`,
 *     необъявленное поле молча вырезается — потеряли бы `shared` или `folderId`.
 *   • Строки услуг валидируются вложенным DTO (`serviceId?`, `name`, `price ≥ 0`).
 *     Внутри строки остаются только эти поля и `quantity`: клиенты читают ровно их.
 *   • `quantity` услуги принимается, но НЕ используется: у услуги нет количества,
 *     сервис (normalizeTemplateServices) сохраняет 1 при любом входе. Старые версии
 *     приложений всё ещё шлют 2-3 — их запрос остаётся валидным.
 *   • Товары шаблона — как раньше, содержимое не проверяется и не меняется
 *     (у товара количество важно, в том числе дробное).
 *   • `services` / `products` необязательны, как и раньше (`dto.services || []`).
 *   • Сообщения по-русски: HttpExceptionFilter отдаёт клиенту первое из них. Ошибка
 *     во вложенной строке приходит с префиксом пути («services.0. …») — так Nest
 *     собирает ошибки вложенных DTO, как и у строк чека в checks/dto.
 *   • ПОРЯДОК ДЕКОРАТОРОВ ВАЖЕН. class-validator регистрирует их снизу вверх, и первым в
 *     ответе идёт сообщение нижнего: на отсутствующее название или цену-«abc» сработали бы
 *     все правила поля сразу, а клиент увидел бы «слишком длинный текст» / «не больше
 *     10 000 000». Поэтому «базовая» проверка (текст / число) стоит ближе всех к полю,
 *     а граничные (длина, min, max) — выше неё.
 */

/** Верхняя граница цены услуги — как MONEY_MAX в checks/dto/check-line.dto.ts (10 млн). */
const PRICE_MAX = 10_000_000;

/** Строка услуги в теле запроса. */
export class CheckTemplateServiceDto {
  @IsOptional()
  @IsString()
  serviceId?: string;

  @MaxLength(2000, { message: 'Название услуги: слишком длинный текст (максимум 2000 символов)' })
  @IsString({ message: 'Название услуги: укажите текст' })
  name!: string;

  @Max(PRICE_MAX, { message: 'Цена услуги: не больше 10 000 000' })
  @Min(0, { message: 'Цена услуги: значение не может быть отрицательным' })
  @IsNumber({}, { message: 'Цена услуги: введите число' })
  @Type(() => Number)
  price!: number;

  /**
   * Принимается и игнорируется: шаблон всегда хранит `quantity: 1`. Намеренно без
   * проверки типа — значение не используется, а старому клиенту с «×2» или «2»
   * отказывать не за что.
   */
  @IsOptional()
  quantity?: number;
}

export class CreateCheckTemplateDto {
  @MaxLength(2000, { message: 'Название шаблона: слишком длинный текст (максимум 2000 символов)' })
  @IsString({ message: 'Название шаблона: укажите текст' })
  name!: string;

  @IsOptional()
  @IsArray({ message: 'Услуги шаблона: ожидается список' })
  @ValidateNested({ each: true })
  @Type(() => CheckTemplateServiceDto)
  services?: CheckTemplateServiceDto[];

  /** Товары шаблона: содержимое не трогаем — у товара `quantity` значим. */
  @IsOptional()
  @IsArray({ message: 'Товары шаблона: ожидается список' })
  products?: unknown[];

  /** Личная папка автора; null/отсутствие — без папки. Владение папкой проверяет сервис. */
  @IsOptional()
  @IsString()
  folderId?: string | null;

  /** true — опубликовать шаблон (нужно templates_shared_manage). */
  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class UpdateCheckTemplateDto {
  @IsOptional()
  @MaxLength(2000, { message: 'Название шаблона: слишком длинный текст (максимум 2000 символов)' })
  @IsString({ message: 'Название шаблона: укажите текст' })
  name?: string;

  @IsOptional()
  @IsArray({ message: 'Услуги шаблона: ожидается список' })
  @ValidateNested({ each: true })
  @Type(() => CheckTemplateServiceDto)
  services?: CheckTemplateServiceDto[];

  @IsOptional()
  @IsArray({ message: 'Товары шаблона: ожидается список' })
  products?: unknown[];

  /** null — вернуть шаблон в корень; отсутствие поля — не трогать. */
  @IsOptional()
  @IsString()
  folderId?: string | null;

  /** true — опубликовать личный шаблон; false для общего отклоняется. */
  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class CreateCheckTemplateFolderDto {
  @MaxLength(200, { message: 'Название папки: максимум 200 символов' })
  @IsString({ message: 'Укажите название папки' })
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsNumber()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}

export class UpdateCheckTemplateFolderDto {
  @IsOptional()
  @MaxLength(200, { message: 'Название папки: максимум 200 символов' })
  @IsString({ message: 'Укажите название папки' })
  name?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsNumber()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}

/** Строка услуги в том виде, в каком она лежит в check_templates.services. */
export interface TemplateServiceLine {
  serviceId?: string;
  name: string;
  price: number;
  quantity: 1;
}

/**
 * Строки услуг шаблона перед записью в JSONB.
 *
 * У услуги нет количества, поэтому `quantity` всегда 1 — что бы ни прислал клиент.
 * Поле не выбрасываем, а пишем явно: клиенты, которые ещё не обновились, читают
 * `s.quantity` при применении шаблона (`price × quantity`), и без поля сумма строки
 * стала бы NaN. Сохраняются только `serviceId` / `name` / `price` / `quantity` —
 * других полей клиенты не читают. Старые шаблоны с `quantity > 1` в БД не правятся:
 * клиенты разворачивают их в строки при загрузке (`expandServiceQuantities`).
 *
 * Чистая функция, без БД: вызывается из сервиса на create и на update.
 */
export function normalizeTemplateServices(services: unknown): TemplateServiceLine[] {
  if (!Array.isArray(services)) return [];
  const lines: TemplateServiceLine[] = [];
  for (const raw of services) {
    if (raw === null || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const price = Number(s.price);
    lines.push({
      ...(typeof s.serviceId === 'string' && s.serviceId ? { serviceId: s.serviceId } : {}),
      name: typeof s.name === 'string' ? s.name : '',
      price: Number.isFinite(price) ? price : 0,
      quantity: 1,
    });
  }
  return lines;
}
