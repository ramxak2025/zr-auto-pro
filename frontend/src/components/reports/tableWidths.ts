/**
 * Ширины числовых колонок для DataTable.
 *
 * Заголовок DataTable обрезается многоточием, а его минимальная ширина — ноль
 * (overflow hidden), поэтому при нехватке места Chrome сжимает колонку, и
 * «Себестоимость товаров» превращается в «Себ…», даже если у ячейки задан
 * `width` (в auto-layout это лишь предпочтительная ширина). Честный минимум даёт
 * `min-width` на `<th>` — тогда широкая таблица уходит в горизонтальный скролл
 * контейнера, а заголовки остаются читаемыми. Классы — литералы, чтобы их
 * увидел JIT Tailwind.
 */
const MIN_WIDTH_CLASSES: Array<[number, string]> = [
  [80, 'min-w-[5rem]'],
  [96, 'min-w-[6rem]'],
  [112, 'min-w-[7rem]'],
  [128, 'min-w-[8rem]'],
  [144, 'min-w-[9rem]'],
  [160, 'min-w-[10rem]'],
  [176, 'min-w-[11rem]'],
  [192, 'min-w-[12rem]'],
  [208, 'min-w-[13rem]'],
  [224, 'min-w-[14rem]'],
];

/** Ширина колонки под заголовок: ~8 px на знак (Onest 12/600) + иконка сортировки + отступы. */
export function headerWidth(title: string, min = 88, max = 224): number {
  return Math.max(min, Math.min(max, Math.round(title.length * 8) + 44));
}

/** Класс `min-w-[…]` для `<th>`, не меньше нужной ширины. */
export function minWidthClass(px: number): string {
  for (const [w, cls] of MIN_WIDTH_CLASSES) if (px <= w) return cls;
  return 'min-w-[14rem]';
}

/** `width` + `headerClassName` для числовой колонки DataTable по её заголовку. */
export function numericColumnSizing(title: string): { width: number; headerClassName: string } {
  const width = headerWidth(title);
  return { width, headerClassName: minWidthClass(width) };
}
