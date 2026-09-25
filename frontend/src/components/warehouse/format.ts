/**
 * Мелкие форматтеры страниц склада и поставщиков. Деньги — только через
 * `Money`/`formatMoney` (shared), здесь — счётчики, проценты и разбор ввода.
 */

/** Русское склонение: pluralRu(5, ['товар', 'товара', 'товаров']) → 'товаров'. */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/** «12 товаров». */
export function countLabel(n: number, forms: [string, string, string]): string {
  return `${n} ${pluralRu(n, forms)}`;
}

const percentFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** «12,5 %» — проценты через Intl, а не toFixed («12.5%»). */
export function formatPercent(value: number): string {
  return `${percentFmt.format(value)} %`;
}

/**
 * Число из пользовательского ввода: пробелы-разряды убираются, запятая — такой же
 * десятичный разделитель, что и точка (русская локаль и в форме, и в Excel).
 * Невалидный/пустой ввод → null.
 */
export function parseNumberInput(raw: string): number | null {
  const n = parseFloat(
    String(raw ?? '')
      .replace(/\s/g, '')
      .replace(',', '.'),
  );
  return Number.isFinite(n) ? n : null;
}

/** То же, но пустое/непарсящееся → 0 (форма товара, импорт из XLSX/CSV). */
export function toNumberOrZero(raw: string): number {
  return parseNumberInput(raw) ?? 0;
}

/** dd.mm.yy — короткая дата для подписей «проверено» на плитках склада. */
export function formatDayShort(dateStr: string): string {
  const d = new Date(dateStr);
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const yy = d.getFullYear().toString().slice(-2);
  return `${dd}.${mm}.${yy}`;
}

/** Дата и время dd.mm.yy hh:mm по часам устройства (история движений/цен). */
export function formatDayTime(dateStr: string): string {
  const dt = new Date(dateStr);
  return (
    dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' +
    dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  );
}

/** Дата в пределах последних 24 часов. */
export function isWithin24h(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < 24 * 60 * 60 * 1000;
}
