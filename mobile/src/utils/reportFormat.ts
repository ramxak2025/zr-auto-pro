/**
 * reportFormat — форматирование и сортировка ячеек конструктора отчётов
 * (`ReportResult`, shared/types «КОНСТРУКТОР ОТЧЁТОВ», 2026-09-25).
 *
 * ЧИСТЫЙ модуль: ни react-native, ни навигации — его делят экран отчёта
 * (ReportRunScreen / ReportTable) и генератор PDF (reportPdf.ts), и он
 * гоняется в node-jest. Тип колонки (`ReportColumnType`) — единственный
 * источник правды о том, как показать число: деньги, проценты, счётчики и
 * даты форматируются здесь один раз и одинаково на экране и в PDF.
 */
import type { ReportCell, ReportColumn, ReportColumnType, ReportRow } from '../../../shared/types';
import { formatDateTime as formatSharedDateTime } from '../../../shared/utils/formatters';

/** Типографский минус — на экране и в PDF отрицательные числа читаются как числа, а не как дефис. */
const MINUS = '−';
const RUB = '₽';
const EMPTY = '—';

const NUMERIC_TYPES: ReadonlySet<ReportColumnType> = new Set(['money', 'number', 'int', 'percent']);

export function isNumericType(type: ReportColumnType): boolean {
  return NUMERIC_TYPES.has(type);
}

/** Выравнивание ячейки: явное из колонки, иначе числа — справа, текст — слева. */
export function cellAlign(column: Pick<ReportColumn, 'type' | 'align'>): 'left' | 'right' | 'center' {
  if (column.align) return column.align;
  return isNumericType(column.type) ? 'right' : 'left';
}

/** Колонки, которые выводятся в таблицу: служебные ключи (`_id`, `_href`, `_tone`) отфильтрованы. */
export function visibleColumns(columns: ReportColumn[]): ReportColumn[] {
  return columns.filter((c) => !c.key.startsWith('_'));
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Число → «1 234,5» с русской запятой, без хвостовых нулей, максимум `maxFraction` знаков. */
function formatDecimal(value: number, maxFraction: number): string {
  const abs = Math.abs(value);
  const fixed = abs.toFixed(maxFraction);
  const [intPart, fracPart = ''] = fixed.split('.');
  const frac = fracPart.replace(/0+$/, '');
  const sign = value < 0 && Number(fixed) !== 0 ? MINUS : '';
  return `${sign}${groupThousands(intPart)}${frac ? `,${frac}` : ''}`;
}

/** Деньги: «1 234 ₽», копейки показываем только когда они есть («1 234,50 ₽»). */
export function formatReportMoney(value: number): string {
  const kopecks = Math.round(value * 100);
  const rub = kopecks / 100;
  if (Number.isInteger(rub)) {
    const sign = rub < 0 ? MINUS : '';
    return `${sign}${groupThousands(String(Math.abs(rub)))} ${RUB}`;
  }
  const abs = Math.abs(rub).toFixed(2);
  const [intPart, frac] = abs.split('.');
  return `${rub < 0 ? MINUS : ''}${groupThousands(intPart)},${frac} ${RUB}`;
}

export function formatReportInt(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? MINUS : ''}${groupThousands(String(Math.abs(rounded)))}`;
}

export function formatReportNumber(value: number): string {
  return formatDecimal(value, 2);
}

/** Проценты приходят числом 0–100: «12,5%», «0%». */
export function formatReportPercent(value: number): string {
  return `${formatDecimal(value, 1)}%`;
}

/** 'YYYY-MM-DD' (или ISO с временем) → 'DD.MM.YYYY'; нераспознанное — как есть (сервер может прислать «неделя 12»). */
export function formatReportDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** ISO-момент → 'DD.MM.YY HH:mm' в поясе автосервиса (без пояса — время устройства). */
export function formatReportDateTime(value: string, timeZone?: string | null): string {
  if (Number.isNaN(new Date(value).getTime())) return value;
  return formatSharedDateTime(value, timeZone);
}

/** Числовое значение ячейки для сортировки и знака; строки-числа тоже принимаем. */
export function cellNumber(value: ReportCell): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Единственная точка форматирования значения по типу колонки/KPI. null → «—».
 * Если под числовым типом пришла нечисловая строка (например, «н/д»), выводим её как есть.
 */
export function formatCell(
  value: ReportCell | undefined,
  type: ReportColumnType,
  opts?: { timeZone?: string | null },
): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  switch (type) {
    case 'money':
    case 'number':
    case 'int':
    case 'percent': {
      const n = cellNumber(value);
      if (n === null) return String(value);
      if (type === 'money') return formatReportMoney(n);
      if (type === 'int') return formatReportInt(n);
      if (type === 'percent') return formatReportPercent(n);
      return formatReportNumber(n);
    }
    case 'date':
      return formatReportDate(String(value));
    case 'datetime':
      return formatReportDateTime(String(value), opts?.timeZone);
    default:
      return String(value);
  }
}

export type SignedTone = 'positive' | 'negative' | 'default';

/** Знак значения для `signed`-колонок: минус — красный, плюс — зелёный, ноль/пусто — обычный. */
export function signedTone(value: ReportCell | undefined): SignedTone {
  const n = cellNumber(value ?? null);
  if (n === null || n === 0) return 'default';
  return n > 0 ? 'positive' : 'negative';
}

// ── Сортировка по тапу на заголовок ─────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string;
  dir: SortDir;
}

/**
 * Цикл тапов по заголовку: числа — сначала по убыванию (самое большое
 * интереснее), текст — по алфавиту; второй тап переворачивает, третий
 * возвращает порядок сервера.
 */
export function nextSortState(current: SortState | null, key: string, type: ReportColumnType): SortState | null {
  const first: SortDir = isNumericType(type) ? 'desc' : 'asc';
  if (!current || current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === 'desc' ? 'asc' : 'desc' };
  return null;
}

/** Сравнение двух ячеек одного типа; пустые значения всегда в конце независимо от направления. */
export function compareCells(a: ReportCell | undefined, b: ReportCell | undefined, type: ReportColumnType): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (isNumericType(type)) {
    const na = cellNumber(a);
    const nb = cellNumber(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
  }
  return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
}

/** Стабильная сортировка строк; `sort === null` возвращает исходный массив (порядок сервера). */
export function sortRows(rows: ReportRow[], columns: ReportColumn[], sort: SortState | null): ReportRow[] {
  if (!sort) return rows;
  const column = columns.find((c) => c.key === sort.key);
  if (!column) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const cmp = compareCells(x.row[sort.key], y.row[sort.key], column.type);
      // Пустые остаются в конце и при обратном порядке.
      const xEmpty = x.row[sort.key] === null || x.row[sort.key] === undefined || x.row[sort.key] === '';
      const yEmpty = y.row[sort.key] === null || y.row[sort.key] === undefined || y.row[sort.key] === '';
      if (xEmpty !== yEmpty) return cmp;
      return cmp !== 0 ? cmp * dir : x.index - y.index;
    })
    .map((x) => x.row);
}

// ── Переходы по строкам (`_href` — маршрут web, mobile маппит сам) ─────────

export interface ReportRowRoute {
  name: string;
  params: Record<string, string>;
}

const HREF_ROUTES: Array<{ prefix: string; name: string; param: string }> = [
  { prefix: '/clients/', name: 'ClientDetail', param: 'id' },
  { prefix: '/suppliers/', name: 'SupplierDetail', param: 'id' },
  { prefix: '/products/', name: 'ProductDetail', param: 'productId' },
  { prefix: '/employees/', name: 'EmployeeDetail', param: 'id' },
  { prefix: '/users/', name: 'EmployeeDetail', param: 'id' },
  { prefix: '/cars/', name: 'CarDetail', param: 'carId' },
];

/** '/clients/abc?tab=x' → ClientDetail { id: 'abc' }; неизвестный путь → null (строка не кликабельна). */
export function mapReportHref(href: ReportCell | undefined): ReportRowRoute | null {
  if (typeof href !== 'string' || !href) return null;
  const path = href.split(/[?#]/)[0];
  for (const route of HREF_ROUTES) {
    if (!path.startsWith(route.prefix)) continue;
    const id = path.slice(route.prefix.length).split('/')[0];
    if (!id) return null;
    return { name: route.name, params: { [route.param]: id } };
  }
  return null;
}

// ── Подписи ────────────────────────────────────────────────────────────────

/** «Мастера: Иванов, Петров · По папкам» — для шапки экрана и PDF. Пусто, если фильтров нет. */
export function describeReportFilters(
  filters: { entityLabels?: string[]; entityIds?: string[]; groupByLabel?: string | null } | undefined,
  entityLabel?: string | null,
): string {
  if (!filters) return '';
  const parts: string[] = [];
  const labels = filters.entityLabels?.filter(Boolean) ?? [];
  if (labels.length > 0) {
    parts.push(`${entityLabel ? `${entityLabel}: ` : ''}${labels.join(', ')}`);
  } else if (entityLabel && (filters.entityIds?.length ?? 0) > 0) {
    parts.push(`${entityLabel}: выбрано ${filters.entityIds!.length}`);
  }
  if (filters.groupByLabel) parts.push(filters.groupByLabel);
  return parts.join(' · ');
}

/** «01.09.2026 — 25.09.2026»; одинаковые даты схлопываются в одну. */
export function formatPeriodRange(from: string, to: string): string {
  const a = formatReportDate(from);
  const b = formatReportDate(to);
  return a === b ? a : `${a} ${EMPTY} ${b}`;
}
