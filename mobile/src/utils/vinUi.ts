/**
 * VIN — чистые помощники UI (171, 2026-09-25).
 *
 * Всё, что решает «что показать» по данным расшифровки (`VinDecodeResult`) и
 * по ошибкам сервера (409 VIN_DUPLICATE), живёт здесь без зависимостей от
 * react-native — и покрыто тестами `__tests__/vinUi.test.ts`. Компонент
 * `VinInput`, формы авто и Касса эти функции только вызывают.
 *
 * Нормализация/валидация самого номера — `shared/utils/vin.ts` (общая с web
 * и байт-в-байт с backend).
 */
import type { Car, VinDecodeResult, VinDecodeSource } from '../../../shared/types';
import { VIN_LENGTH, isValidVin, normalizeVin, vinCheckDigitOk, vinNeedsCheckDigit } from '../../../shared/utils/vin';

/**
 * `Car` с полем VIN. Контракт `shared/types` объявляет `vin` у
 * `CarLookupResult` и в запросах create/update, но не у самого `Car`
 * (зафиксировано в отчёте для backend-engineer). Пока поле не объявлено,
 * читаем его мягко через {@link carVin} — при появлении в контракте этот
 * алиас схлопнется в `Car` без правок экранов.
 */
export type CarWithVin = Car & { vin?: string | null };

/**
 * Нормализованный VIN машины или null (нет / пустой / мусор). Принимает и
 * `Car` без поля vin (id даёт пересечение типов), и `CarLookupResult`.
 */
export function carVin(car: { id?: string; vin?: string | null } | null | undefined): string | null {
  if (!car || !car.vin) return null;
  const v = normalizeVin(car.vin);
  return v.length > 0 ? v : null;
}

/** Счётчик набранных символов под полем: «12/17». */
export function vinCounter(vin: string): string {
  return `${vin.length}/${VIN_LENGTH}`;
}

/** Подписи источников расшифровки — для настроек («Проверить») и подсказок. */
export const VIN_SOURCE_LABELS: Record<VinDecodeSource, string> = {
  paid: 'Платный сервис',
  nhtsa: 'Справочник NHTSA',
  wmi: 'Таблица производителей (WMI)',
  none: 'Не определено',
};

export function vinSourceLabel(source: VinDecodeSource | null | undefined): string {
  return (source && VIN_SOURCE_LABELS[source]) || VIN_SOURCE_LABELS.none;
}

/**
 * Подпись под полем VIN после расшифровки (спека, раздел 4.2):
 *   • марка и модель найдены → «Определено по VIN»;
 *   • только марка (типично для офлайн-таблицы WMI) → «Марка по справочнику,
 *     модель допишите»;
 *   • корректный VIN, но ничего не нашли → подсказка заполнить руками;
 *   • некорректный VIN → null (счётчик/ошибка формата уже видны).
 */
export function vinDecodeCaption(result: VinDecodeResult | null | undefined): string | null {
  if (!result || !result.valid) return null;
  if (result.make && result.model) return 'Определено по VIN';
  if (result.make) return 'Марка по справочнику, модель допишите';
  return 'Марку по VIN определить не удалось — заполните вручную';
}

/**
 * Предупреждение о контрольной цифре. Обязательна только у североамериканских
 * VIN (первый символ 1–5); для остальных рынков не считается — там null всегда.
 * Не блокирует сохранение: у части реэкспортных машин цифра действительно не
 * сходится, а мастеру важнее записать номер.
 */
export function vinCheckDigitWarning(vin: string): string | null {
  if (!isValidVin(vin) || !vinNeedsCheckDigit(vin)) return null;
  return vinCheckDigitOk(vin) ? null : 'Контрольная цифра не сходится — проверьте VIN';
}

function normalizeMakeModel(s: string | null | undefined): string {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Поле «Марка и модель» пусто, а расшифровка дала строку → подставляем молча. */
export function shouldAutofillMakeModel(current: string | null | undefined, result: VinDecodeResult): boolean {
  return !!result.makeModel && normalizeMakeModel(current).length === 0;
}

/**
 * Текст для чипа «По VIN: Kia Rio · Заменить»: поле уже заполнено ЧЕМ-ТО
 * ДРУГИМ, и мы не переписываем его молча. null — чип не нужен (поле пусто —
 * сработала автоподстановка; совпадает — заменять нечего; расшифровки нет).
 */
export function vinSuggestion(
  current: string | null | undefined,
  result: VinDecodeResult | null | undefined,
): string | null {
  if (!result || !result.makeModel) return null;
  const cur = normalizeMakeModel(current);
  if (cur.length === 0) return null;
  if (cur === normalizeMakeModel(result.makeModel)) return null;
  return result.makeModel;
}

/** Строка результата в настройках: «Kia Rio · 2015», «Lada · 2019», «Не определено». */
export function vinDecodeSummary(result: VinDecodeResult): string {
  const parts = [result.makeModel, result.year ? String(result.year) : null].filter(Boolean);
  return parts.join(' · ') || 'Не определено';
}

/** Разобранный 409 VIN_DUPLICATE (спека, раздел 1). */
export interface VinDuplicateInfo {
  carId: string | null;
  clientId: string | null;
  clientName: string | null;
  /** Готовый текст для пользователя — с именем клиента, когда сервер его отдал. */
  message: string;
}

/**
 * Ошибка axios → данные дубликата VIN, либо null для любой другой ошибки.
 * Текст берём серверный (он уже с именем клиента); если сервер прислал только
 * код — собираем сами из clientName.
 */
export function vinDuplicateError(err: unknown): VinDuplicateInfo | null {
  const e = err as { response?: { status?: number; data?: any } } | null | undefined;
  const data = e?.response?.data;
  if (e?.response?.status !== 409 || !data || data.code !== 'VIN_DUPLICATE') return null;
  const clientName = typeof data.clientName === 'string' && data.clientName.trim() ? data.clientName.trim() : null;
  const serverMessage = typeof data.message === 'string' && data.message.trim() ? data.message.trim() : null;
  const message =
    serverMessage ||
    (clientName ? `Автомобиль с таким VIN уже есть у клиента ${clientName}` : 'Автомобиль с таким VIN уже есть');
  return {
    carId: typeof data.carId === 'string' && data.carId ? data.carId : null,
    clientId: typeof data.clientId === 'string' && data.clientId ? data.clientId : null,
    clientName,
    message,
  };
}

/** Понятное сообщение для 409 VIN_DUPLICATE, либо null. */
export function vinDuplicateMessage(err: unknown): string | null {
  return vinDuplicateError(err)?.message ?? null;
}
