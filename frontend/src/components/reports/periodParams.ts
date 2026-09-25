/**
 * Период страницы в URL (?from=YYYY-MM-DD&to=YYYY-MM-DD) и календарные месяцы.
 *
 * Правило визуальной системы: состояние фильтров живёт в query-параметрах,
 * чтобы F5, «Назад» и пересылка ссылки («отчёт за август») работали. Здесь —
 * чистые функции без React: их делят Зарплата, Расходы, Движение денег и
 * раздел «Отчёты».
 */
import { endOfMonth, format, startOfMonth } from 'date-fns';

export interface Period {
  from: string;
  to: string;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: string | null | undefined): value is string {
  return typeof value === 'string' && DAY_KEY_RE.test(value);
}

/** Период из URL; при отсутствии/мусоре — запасной (обычно текущий месяц автосервиса). */
export function readPeriod(params: URLSearchParams, fallback: Period): Period {
  const from = params.get('from');
  const to = params.get('to');
  if (isDayKey(from) && isDayKey(to)) return { from, to };
  return fallback;
}

/** CSV-список из параметра (?ids=a,b) → массив без пустых. */
export function readList(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Новый URLSearchParams с патчем: null/пусто — удалить ключ, иначе записать. */
export function patchParams(prev: URLSearchParams, patch: Record<string, string | null | undefined>): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') next.delete(key);
    else next.set(key, value);
  }
  return next;
}

/** «01.09.2026 — 30.09.2026» (или одна дата, если день один). */
export function periodLabel(p: Period): string {
  const f = (k: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : k;
  };
  return p.from === p.to ? f(p.from) : `${f(p.from)} — ${f(p.to)}`;
}

// ── Календарные месяцы ──────────────────────────────────────────────────────

export const RU_MONTHS_NOM = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

export interface MonthKey {
  year: number;
  /** 0–11 */
  month0: number;
}

/** Первое…последнее число месяца как 'yyyy-MM-dd'. Только календарная арифметика. */
export function monthRange(m: MonthKey): Period {
  const d = new Date(m.year, m.month0, 1);
  return { from: format(startOfMonth(d), 'yyyy-MM-dd'), to: format(endOfMonth(d), 'yyyy-MM-dd') };
}

/** Месяц дня 'YYYY-MM-DD'. */
export function monthOfDay(dayKey: string): MonthKey {
  const [y, m] = dayKey.split('-').map(Number);
  return { year: y || 1970, month0: (m || 1) - 1 };
}

/** Месяц, если период — ровно календарный месяц; иначе null. */
export function periodMonth(p: Period): MonthKey | null {
  if (!isDayKey(p.from) || !isDayKey(p.to)) return null;
  const candidate = monthOfDay(p.from);
  const r = monthRange(candidate);
  return r.from === p.from && r.to === p.to ? candidate : null;
}

export function shiftMonth(m: MonthKey, delta: number): MonthKey {
  const d = new Date(m.year, m.month0 + delta, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

/** Сквозной индекс месяца для сравнений. */
export function monthIndex(m: MonthKey): number {
  return m.year * 12 + m.month0;
}

/** «Сентябрь 2026». */
export function monthTitle(m: MonthKey): string {
  return `${RU_MONTHS_NOM[m.month0]} ${m.year}`;
}
