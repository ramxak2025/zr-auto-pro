/**
 * units.ts — единицы измерения товара и форматирование дробных количеств
 * (120_fractional_quantities: «шланг метровый, 50 см = пробить 0.5»).
 *
 * Backend хранит `products.unit` как ТЕКСТ. Исторически там жили английские
 * коды ('pcs','m','l','kg'…) — миграция 120 перевела 'pcs'→'шт', новые
 * значения пишутся сразу русскими метками из UNIT_PRESETS. `unitLabel()`
 * понимает оба поколения, поэтому старые данные никогда не показываются
 * «сырым кодом».
 */

/** Пресеты выбора единицы (чипсы в формах товара). Дефолт — 'шт'. */
export const UNIT_PRESETS = ['шт', 'м', 'кг', 'л', 'уп', 'компл'] as const;

export const DEFAULT_UNIT = 'шт';

// Легаси-коды из старых данных → русские метки.
const LEGACY_UNIT_LABELS: Record<string, string> = {
  pcs: 'шт',
  pc: 'шт',
  l: 'л',
  ml: 'мл',
  kg: 'кг',
  g: 'г',
  m: 'м',
  set: 'компл',
  pack: 'уп',
  upak: 'уп',
};

/** Человекочитаемая единица: legacy-код → метка, незнакомое — как есть. */
export function unitLabel(unit?: string | null): string {
  if (!unit) return DEFAULT_UNIT;
  return LEGACY_UNIT_LABELS[unit.toLowerCase()] ?? unit;
}

/**
 * Количество без хвостовых нулей: 2.000 → «2», 0.500 → «0.5», 12.5 → «12.5».
 * NUMERIC(12,3) из БД уже распарсен сервисами в number — здесь только режем
 * артефакты float-математики (шаг 0.001).
 */
export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 1000) / 1000);
}

/** «12.5 м» / «2 шт» — количество + единица одним куском. */
export function formatQtyUnit(value: number, unit?: string | null): string {
  return `${formatQty(value)} ${unitLabel(unit)}`;
}

/**
 * Парсер пользовательского ввода количества: запятая нормализуется в точку,
 * результат округляется до 3 знаков (как NUMERIC(12,3) и DTO
 * maxDecimalPlaces:3). Невалидный/пустой ввод → null.
 */
export function parseQtyInput(v: string): number | null {
  const n = parseFloat(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

/**
 * Округление количества до 3 знаков после арифметики (степперы, комплекты):
 * float-грязь вида 1.3 − 1 = 0.30000000000000004 бэкенд отверг бы 400-кой
 * (maxDecimalPlaces: 3).
 */
export function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Минимально допустимое количество строки/операции. */
export const MIN_QTY = 0.001;
