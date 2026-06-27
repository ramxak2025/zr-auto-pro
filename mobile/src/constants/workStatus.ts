/**
 * Канбан work-status — визуальный хелпер для доски заказ-нарядов.
 *
 * Раньше (board 082) колонки были захардкожены (приёмка → в работе → готов →
 * выдан) в `WORK_STATUS_META`. С миграции 091 колонки стали ДАННЫМИ
 * (owner-configurable, `WorkBoardColumn`): владелец сам задаёт подпись, цвет,
 * порядок, видимость и флаг «уведомлять клиента». Поэтому здесь больше нет
 * фиксированного словаря — есть только хелперы, выводящие подпись/цвет/мягкую
 * подложку из переданного списка колонок.
 *
 * `check.workStatus` хранит KEY колонки (slug). NULL = заказ-наряд не на доске.
 * Для неизвестного / удалённого ключа — нейтральный fallback-цвет, чтобы чип не
 * становился пустым (бэкенд обнуляет ключ удалённой колонки, так что это
 * переходное состояние).
 *
 * Статус ОРТОГОНАЛЕН оплате/отложенности — это чистый board-флаг, он не
 * смешивается с бейджами «оплачено / отложен».
 */
import type { WorkBoardColumn } from '../../../shared/types';
import { colors } from '../theme';

/** Нейтральный акцент для колонок без цвета и для неизвестных ключей. */
export const NEUTRAL_WORK_COLOR = colors.slate[500];

/**
 * ~8 пресет-цветов для «Настройки колонок». Hex — формат, который ждёт бэкенд
 * (`work_board_columns.color`). Держим список здесь, чтобы и доска, и настройки
 * читали цвета из одного места.
 */
export const WORK_COLUMN_PRESETS: string[] = [
  colors.blue[600], // #2563eb
  colors.amber[600], // #d97706
  colors.green[600], // #16a34a
  colors.violet[600], // #7c3aed
  colors.rose[600], // #e11d48
  colors.cyan[600], // #0891b2
  colors.orange[600], // #ea580c
  colors.slate[600], // #475569
];

export interface WorkColumnVisual {
  key: string;
  /** Подпись колонки / чипа. */
  label: string;
  /** Сплошной акцент (точка, текст активного чипа, рамка). */
  color: string;
  /** Мягкая полупрозрачная подложка, выведенная из акцента (фон чипа). */
  bg: string;
}

/**
 * hex (#RGB / #RRGGBB) → `rgba(r,g,b,alpha)`. Для не-hex значений возвращает
 * исходную строку без изменений (на случай готовых rgba-токенов). Подложка
 * с alpha читается одинаково на светлой и тёмной теме.
 */
export function colorWithAlpha(color: string, alpha: number): string {
  if (typeof color !== 'string' || color[0] !== '#') return color;
  let hex = color.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return color;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Визуал одной колонки: подпись + акцент (с fallback) + мягкая подложка. */
export function columnVisual(col: WorkBoardColumn): WorkColumnVisual {
  const color = col.color || NEUTRAL_WORK_COLOR;
  return { key: col.key, label: col.label, color, bg: colorWithAlpha(color, 0.15) };
}

/**
 * Визуал по ключу work-status внутри списка колонок.
 *  - `key == null` → `null` (заказ-наряд не на доске).
 *  - ключ найден → визуал колонки.
 *  - ключ есть, но колонки нет (удалена / список ещё не загружен) → нейтральный
 *    fallback с подписью = сам ключ, чтобы чип не оставался пустым.
 */
export function workStatusVisual(
  key: string | null | undefined,
  columns: WorkBoardColumn[] | undefined,
): WorkColumnVisual | null {
  if (!key) return null;
  const col = columns?.find((c) => c.key === key);
  if (col) return columnVisual(col);
  return { key, label: key, color: NEUTRAL_WORK_COLOR, bg: colorWithAlpha(NEUTRAL_WORK_COLOR, 0.15) };
}
