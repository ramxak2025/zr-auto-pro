/**
 * numberInput.ts — разбор числового ввода из форм (деньги + количества).
 *
 * Зачем отдельный модуль: на iOS цифровая клавиатура в русской локали даёт
 * ЗАПЯТУЮ как десятичный разделитель, а `Number('12,5')` = NaN. Раньше формы
 * писали `Number(costPrice) || 0`, поэтому «1250,50» молча превращалось в 0 —
 * товар терял себестоимость без единого сообщения. Количества этот случай уже
 * закрывали через `parseQtyInput` (units.ts) — здесь то же правило для денег,
 * плюс единая точка чтения поля формы.
 *
 * Деньги в БД — NUMERIC(12,2) (миграция 001: products.cost_price/sell_price),
 * поэтому округляем до 2 знаков. Количества — NUMERIC(12,3), их считает
 * `parseQtyInput`, который здесь и переиспользуется (не дублируем правило).
 */

import { parseQtyInput } from './units';

/** Пробелы-разделители разрядов, которые может дать вставка из буфера. */
const SPACE_CHARS = /\s/g;

/**
 * Разбор денежного ввода: запятая → точка, пробелы-разряды убираются,
 * результат округляется до 2 знаков (NUMERIC(12,2)). Пустая строка и мусор —
 * `null` (вызывающий решает, это «не трогать» или ошибка формы).
 */
export function parseMoneyInput(raw: string): number | null {
  const normalized = String(raw ?? '')
    .replace(SPACE_CHARS, '')
    .replace(',', '.');
  if (normalized === '') return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export type NumericFieldKind = 'money' | 'qty';

/**
 * Чтение числового поля формы:
 *   • пустое поле  → 0 (пользователь очистил цену/остаток — это ноль);
 *   • корректное число → значение (запятая и точка равнозначны);
 *   • мусор → `null` — форма обязана показать ошибку, а НЕ отправлять 0.
 *
 * Последнее и есть защита от старого поведения `Number(x) || 0`, которое
 * незаметно обнуляло поле.
 */
export function readNumericField(raw: string, kind: NumericFieldKind): number | null {
  if (String(raw ?? '').trim() === '') return 0;
  return kind === 'money' ? parseMoneyInput(raw) : parseQtyInput(raw);
}
