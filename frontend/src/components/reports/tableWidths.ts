/**
 * Ширины числовых колонок для DataTable.
 *
 * Заголовок DataTable наследует `white-space` от `<th>` (по умолчанию nowrap →
 * обрезка многоточием), а его минимальная ширина — ноль (overflow hidden),
 * поэтому при нехватке места Chrome сжимает колонку, и «Себестоимость товаров»
 * превращается в «Себ…», даже если у ячейки задан `width` (в auto-layout это
 * лишь предпочтительная ширина).
 *
 * Решение для широких денежных таблиц (отчёты, движение денег, зарплата):
 *   • `width` — предпочтительная ширина, чтобы при запасе места заголовок
 *     уместился в одну строку;
 *   • `whitespace-normal` на `<th>` — при нехватке места заголовок переносится
 *     на вторую строку («Себестоимость / товаров»), а не режется;
 *   • `min-width` по самому длинному слову + иконка сортировки — честный
 *     минимум, ниже которого колонку сжимать нельзя. Только когда сумма таких
 *     минимумов больше контейнера, таблица уходит в горизонтальный скролл.
 * Классы — литералы, чтобы их увидел JIT Tailwind.
 */
const MIN_WIDTH_CLASSES: Array<[number, string]> = [
  [64, 'min-w-[4rem]'],
  [72, 'min-w-[4.5rem]'],
  [80, 'min-w-[5rem]'],
  [88, 'min-w-[5.5rem]'],
  [96, 'min-w-[6rem]'],
  [104, 'min-w-[6.5rem]'],
  [112, 'min-w-[7rem]'],
  [120, 'min-w-[7.5rem]'],
  [128, 'min-w-[8rem]'],
  [136, 'min-w-[8.5rem]'],
  [144, 'min-w-[9rem]'],
  [152, 'min-w-[9.5rem]'],
  [160, 'min-w-[10rem]'],
  [176, 'min-w-[11rem]'],
  [192, 'min-w-[12rem]'],
  [208, 'min-w-[13rem]'],
  [224, 'min-w-[14rem]'],
];

/**
 * Замер Onest 12/600 в Chrome: кириллица 6,9–7,6 px на знак — берём верхнюю
 * границу. Плюс иконка сортировки 14 + зазор 4 + отступы ячейки 24 (≈ 44).
 */
const PX_PER_CHAR = 7.6;
const HEADER_EXTRA = 44;

/** Предпочтительная ширина колонки — заголовок в одну строку. */
export function headerWidth(title: string, min = 80, max = 208): number {
  return Math.max(min, Math.min(max, Math.ceil(title.length * PX_PER_CHAR) + HEADER_EXTRA));
}

/** Минимальная ширина — самое длинное слово заголовка не ломается и не режется. */
export function headerMinWidth(title: string, min = 72): number {
  const longest = title.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  return Math.max(min, Math.ceil(longest * PX_PER_CHAR) + HEADER_EXTRA);
}

/** Класс `min-w-[…]` для `<th>`, не меньше нужной ширины. */
export function minWidthClass(px: number): string {
  for (const [w, cls] of MIN_WIDTH_CLASSES) if (px <= w) return cls;
  return 'min-w-[14rem]';
}

/**
 * Классы `<th>` числовой колонки: перенос заголовка + минимум по длинному слову.
 * `!important` нужен: `.table th` (класс + тег) сильнее утилиты `whitespace-normal`.
 */
export function numericHeaderClass(title: string): string {
  return `!whitespace-normal ${minWidthClass(headerMinWidth(title))}`;
}

/** `width` + `headerClassName` для числовой колонки DataTable по её заголовку. */
export function numericColumnSizing(title: string): { width: number; headerClassName: string } {
  return { width: headerWidth(title), headerClassName: numericHeaderClass(title) };
}
