/**
 * Форматирование значений конструктора отчётов (shared/types → ReportResult).
 *
 * Один набор правил для экрана, Excel и PDF: деньги — через shared formatMoney
 * (целые рубли, как во всей админке), проценты — Intl ru-RU с одним знаком
 * («61,2%»), даты 'YYYY-MM-DD' — без Date (никакого сдвига пояса), моменты —
 * в поясе автосервиса.
 */
import type { ReportCell, ReportColumnType, ReportKpi, ReportTone } from '../../types';
import { formatDateTime, formatMoney } from '../../../../shared/utils/formatters';
import type { Tone } from '../../ui/tokens';

const intFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** Числовые типы колонок: выравнивание вправо, табличные цифры, числовой формат в Excel. */
export function isNumericType(type: ReportColumnType): boolean {
  return type === 'money' || type === 'number' || type === 'int' || type === 'percent';
}

/** Тон сервера → семантический тон визуальной системы. */
export function toneToUi(tone?: ReportTone | null): Tone {
  switch (tone) {
    case 'positive':
      return 'ok';
    case 'negative':
      return 'bad';
    case 'warning':
      return 'warn';
    default:
      return 'neutral';
  }
}

/** 'YYYY-MM-DD' → 'dd.MM.yyyy' строковой перестановкой — без Date и без сдвига пояса. */
export function formatDayKeyRu(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return key;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Число из ячейки или null (пусто / не число). */
export function cellNumber(value: ReportCell | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface FormatOptions {
  timeZone?: string | null;
  /** Знаковая колонка: положительные — с «+». */
  signed?: boolean;
}

/** Значение ячейки/KPI в строку по типу колонки. Пусто → «—». */
export function formatReportValue(
  value: ReportCell | undefined,
  type: ReportColumnType,
  opts: FormatOptions = {},
): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'money': {
      const n = cellNumber(value);
      if (n === null) return String(value);
      const sign = n < 0 ? '−' : opts.signed && n > 0 ? '+' : '';
      return `${sign}${formatMoney(Math.abs(n))}`;
    }
    case 'int': {
      const n = cellNumber(value);
      return n === null ? String(value) : intFormat.format(n);
    }
    case 'number': {
      const n = cellNumber(value);
      return n === null ? String(value) : numberFormat.format(n);
    }
    case 'percent': {
      const n = cellNumber(value);
      return n === null ? String(value) : `${percentFormat.format(n)}%`;
    }
    case 'date':
      return typeof value === 'string' ? formatDayKeyRu(value) : String(value);
    case 'datetime':
      return typeof value === 'string' ? formatDateTime(value, opts.timeZone) : String(value);
    default:
      return String(value);
  }
}

/** Крупная цифра KPI: те же правила, что у ячеек; текстовые KPI — как есть. */
export function formatKpiValue(kpi: ReportKpi, timeZone?: string | null): string {
  if (kpi.type === 'text') return kpi.value === null || kpi.value === '' ? '—' : String(kpi.value);
  return formatReportValue(kpi.value, kpi.type, { timeZone });
}

/** Русское склонение: 1 строка · 2 строки · 5 строк. */
export function pluralRows(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} строка`;
  if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return `${n} строки`;
  return `${n} строк`;
}
