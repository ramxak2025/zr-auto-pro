/**
 * VIN — чистые помощники UI для веба (171, 2026-09-25).
 *
 * Единственная копия для всех разделов (Касса, Клиенты, Автомобили, деталка
 * чека). Всё, что решает «что показать» по данным расшифровки
 * (`VinDecodeResult`) и по ошибкам сервера (409 VIN_DUPLICATE), живёт здесь
 * без зависимостей от React. Компонент `VinInput`, формы авто и таблицы эти
 * функции только зовут.
 *
 * Нормализация/валидация самого номера — `shared/utils/vin.ts` (общая с
 * mobile и байт-в-байт с backend). Зеркало — `mobile/src/utils/vinUi.ts`;
 * держать в синхроне (тексты подписей одинаковые в обоих клиентах). Кандидат
 * на переезд в `shared/utils/vinUi.ts`, когда shared разморозят.
 */
import type { VinDecodeResult, VinDecodeSource } from '../../../../shared/types';
import {
  VIN_LENGTH,
  isValidVin,
  normalizeVin,
  vinCheckDigitOk,
  vinNeedsCheckDigit,
} from '../../../../shared/utils/vin';

/** Нормализованный VIN машины или null (нет / пустой / мусор). */
export function carVin(car: { vin?: string | null } | null | undefined): string | null {
  if (!car || !car.vin) return null;
  const v = normalizeVin(car.vin);
  return v.length > 0 ? v : null;
}

/** Счётчик набранных символов в поле: «12/17». */
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

/** Строка результата: «Kia Rio · 2015», «Lada · 2019», «Не определено». */
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
  const e = err as { response?: { status?: number; data?: Record<string, unknown> | null } } | null | undefined;
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

/**
 * Скопировать VIN в буфер обмена. Возвращает true при успехе. Clipboard API
 * есть только в secure context — на http-адресе внутри сети автосервиса
 * срабатывает запасной путь через скрытый textarea + execCommand.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // падаем в запасной путь
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
