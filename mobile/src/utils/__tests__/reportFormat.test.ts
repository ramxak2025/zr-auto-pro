/**
 * reportFormat + reportPeriod tests — форматирование ячеек, сортировка,
 * маппинг `_href` и пресеты периода конструктора отчётов.
 */
import type { ReportColumn, ReportRow } from '../../../../shared/types';
import {
  compareCells,
  describeReportFilters,
  formatCell,
  formatPeriodRange,
  mapReportHref,
  nextSortState,
  signedTone,
  sortRows,
  visibleColumns,
} from '../reportFormat';
import {
  formatPeriodLabel,
  getDateRange,
  monthRange,
  periodError,
  rangeDays,
} from '../../screens/reports/reportPeriod';

describe('formatCell', () => {
  test('деньги: целые без копеек, дробные — с двумя знаками, минус типографский', () => {
    expect(formatCell(1234567, 'money')).toBe('1 234 567 ₽');
    expect(formatCell(1234.5, 'money')).toBe('1 234,50 ₽');
    expect(formatCell(-300, 'money')).toBe('−300 ₽');
    expect(formatCell(0, 'money')).toBe('0 ₽');
    // Копейки округляем, а не обрезаем.
    expect(formatCell(99.999, 'money')).toBe('100 ₽');
  });

  test('счётчики, числа и проценты', () => {
    expect(formatCell(12000, 'int')).toBe('12 000');
    expect(formatCell(3.7, 'int')).toBe('4');
    expect(formatCell(1234.567, 'number')).toBe('1 234,57');
    expect(formatCell(2.5, 'number')).toBe('2,5');
    expect(formatCell(12.5, 'percent')).toBe('12,5%');
    expect(formatCell(0, 'percent')).toBe('0%');
    expect(formatCell(33.333, 'percent')).toBe('33,3%');
  });

  test('даты: date → ДД.ММ.ГГГГ, datetime — в поясе автосервиса, нераспознанное — как есть', () => {
    expect(formatCell('2026-09-25', 'date')).toBe('25.09.2026');
    expect(formatCell('2026-09-25T10:00:00.000Z', 'date')).toBe('25.09.2026');
    expect(formatCell('2026-W38', 'date')).toBe('2026-W38');
    expect(formatCell('2026-09-25T11:32:00.000Z', 'datetime', { timeZone: 'Europe/Moscow' })).toBe('25.09.26 14:32');
    expect(formatCell('2026-09-25T11:32:00.000Z', 'datetime', { timeZone: 'Asia/Vladivostok' })).toBe('25.09.26 21:32');
  });

  test('пусто → прочерк; текст — как есть; нечисловая строка под числовым типом не ломает вывод', () => {
    expect(formatCell(null, 'money')).toBe('—');
    expect(formatCell(undefined, 'text')).toBe('—');
    expect(formatCell('', 'int')).toBe('—');
    expect(formatCell('Иванов', 'text')).toBe('Иванов');
    expect(formatCell('н/д', 'money')).toBe('н/д');
    // Числа строкой (сервер отдал numeric как text) тоже форматируем.
    expect(formatCell('1500', 'money')).toBe('1 500 ₽');
  });
});

describe('signedTone', () => {
  test('плюс — positive, минус — negative, ноль и пусто — default', () => {
    expect(signedTone(10)).toBe('positive');
    expect(signedTone(-0.01)).toBe('negative');
    expect(signedTone(0)).toBe('default');
    expect(signedTone(null)).toBe('default');
  });
});

describe('сортировка', () => {
  const columns: ReportColumn[] = [
    { key: 'name', title: 'Имя', type: 'text' },
    { key: 'sum', title: 'Сумма', type: 'money' },
  ];
  const rows: ReportRow[] = [
    { name: 'Борис', sum: 100 },
    { name: 'анна', sum: null },
    { name: 'Ёлкин', sum: 300 },
    { name: 'Виктор', sum: 100 },
  ];

  test('цикл тапов: число — desc → asc → сброс; текст — asc → desc → сброс; смена колонки сбрасывает', () => {
    const s1 = nextSortState(null, 'sum', 'money');
    expect(s1).toEqual({ key: 'sum', dir: 'desc' });
    const s2 = nextSortState(s1, 'sum', 'money');
    expect(s2).toEqual({ key: 'sum', dir: 'asc' });
    expect(nextSortState(s2, 'sum', 'money')).toBeNull();

    const t1 = nextSortState(null, 'name', 'text');
    expect(t1).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSortState(t1, 'name', 'text')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSortState(t1, 'sum', 'money')).toEqual({ key: 'sum', dir: 'desc' });
  });

  test('числа: пустые всегда в конце, равные сохраняют порядок сервера', () => {
    const desc = sortRows(rows, columns, { key: 'sum', dir: 'desc' }).map((r) => r.name);
    expect(desc).toEqual(['Ёлкин', 'Борис', 'Виктор', 'анна']);
    const asc = sortRows(rows, columns, { key: 'sum', dir: 'asc' }).map((r) => r.name);
    expect(asc).toEqual(['Борис', 'Виктор', 'Ёлкин', 'анна']);
  });

  test('текст: русская локаль, без учёта регистра', () => {
    const asc = sortRows(rows, columns, { key: 'name', dir: 'asc' }).map((r) => r.name);
    expect(asc).toEqual(['анна', 'Борис', 'Виктор', 'Ёлкин']);
  });

  test('без сортировки — тот же массив; неизвестный ключ — без изменений', () => {
    expect(sortRows(rows, columns, null)).toBe(rows);
    expect(sortRows(rows, columns, { key: 'nope', dir: 'asc' })).toBe(rows);
  });

  test('compareCells: пустое всегда после значения', () => {
    expect(compareCells(null, 5, 'int')).toBeGreaterThan(0);
    expect(compareCells(5, null, 'int')).toBeLessThan(0);
    expect(compareCells(null, null, 'int')).toBe(0);
  });
});

describe('visibleColumns / describeReportFilters / formatPeriodRange', () => {
  test('служебные ключи не попадают в таблицу', () => {
    const cols: ReportColumn[] = [
      { key: '_id', title: 'id', type: 'text' },
      { key: 'name', title: 'Имя', type: 'text' },
      { key: '_tone', title: 't', type: 'text' },
    ];
    expect(visibleColumns(cols).map((c) => c.key)).toEqual(['name']);
  });

  test('подпись фильтров', () => {
    expect(describeReportFilters({ entityLabels: ['Иванов', 'Петров'], groupByLabel: 'По папкам' }, 'Мастера')).toBe(
      'Мастера: Иванов, Петров · По папкам',
    );
    expect(describeReportFilters({ entityIds: ['a', 'b'] }, 'Поставщики')).toBe('Поставщики: выбрано 2');
    expect(describeReportFilters({}, 'Мастера')).toBe('');
    expect(describeReportFilters(undefined)).toBe('');
  });

  test('диапазон дат схлопывается для одного дня', () => {
    expect(formatPeriodRange('2026-09-25', '2026-09-25')).toBe('25.09.2026');
    expect(formatPeriodRange('2026-09-01', '2026-09-25')).toBe('01.09.2026 — 25.09.2026');
  });
});

describe('mapReportHref', () => {
  test('известные пути web → экраны mobile', () => {
    expect(mapReportHref('/clients/abc?tab=cars')).toEqual({ name: 'ClientDetail', params: { id: 'abc' } });
    expect(mapReportHref('/suppliers/s1')).toEqual({ name: 'SupplierDetail', params: { id: 's1' } });
    expect(mapReportHref('/products/p1')).toEqual({ name: 'ProductDetail', params: { productId: 'p1' } });
    expect(mapReportHref('/employees/u1')).toEqual({ name: 'EmployeeDetail', params: { id: 'u1' } });
    expect(mapReportHref('/cars/c1')).toEqual({ name: 'CarDetail', params: { carId: 'c1' } });
  });

  test('неизвестное / пустое — null (строка не кликабельна)', () => {
    expect(mapReportHref('/reports/summary')).toBeNull();
    expect(mapReportHref('/clients/')).toBeNull();
    expect(mapReportHref(null)).toBeNull();
    expect(mapReportHref(undefined)).toBeNull();
    expect(mapReportHref(42)).toBeNull();
  });
});

describe('пресеты периода', () => {
  // Пятница 25 сентября 2026, 15:00 локального времени.
  const now = new Date(2026, 8, 25, 15, 0, 0);

  test('сегодня / вчера / неделя (с понедельника) / месяц / квартал / год', () => {
    expect(getDateRange('today', now)).toEqual({ from: '2026-09-25', to: '2026-09-25' });
    expect(getDateRange('yesterday', now)).toEqual({ from: '2026-09-24', to: '2026-09-24' });
    expect(getDateRange('week', now)).toEqual({ from: '2026-09-21', to: '2026-09-25' });
    expect(getDateRange('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-25' });
    expect(getDateRange('quarter', now)).toEqual({ from: '2026-07-01', to: '2026-09-25' });
    expect(getDateRange('year', now)).toEqual({ from: '2026-01-01', to: '2026-09-25' });
  });

  test('воскресенье относится к неделе, начавшейся в понедельник', () => {
    const sunday = new Date(2026, 8, 27, 10, 0, 0);
    expect(getDateRange('week', sunday)).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });

  test('пейджер месяцев: прошлый месяц — целиком, текущий — по сегодня', () => {
    expect(monthRange(new Date(2026, 7, 1), now)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(monthRange(new Date(2026, 1, 1), now)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange(new Date(2026, 8, 1), now)).toEqual({ from: '2026-09-01', to: '2026-09-25' });
  });

  test('подписи периода', () => {
    expect(formatPeriodLabel('month', { from: '2026-09-01', to: '2026-09-25' })).toBe('Сентябрь 2026');
    expect(formatPeriodLabel('quarter', { from: '2026-07-01', to: '2026-09-25' })).toBe('3 квартал 2026');
    expect(formatPeriodLabel('year', { from: '2026-01-01', to: '2026-09-25' })).toBe('2026 год');
    expect(formatPeriodLabel('custom', { from: '2026-09-01', to: '2026-09-25' })).toBe('1 — 25 сентября 2026');
    expect(formatPeriodLabel('custom', { from: '2026-08-30', to: '2026-09-02' })).toBe('30 августа — 2 сентября 2026');
    expect(formatPeriodLabel('custom', { from: '2026-09-25', to: '2026-09-25' })).toBe('25 сентября 2026');
    expect(formatPeriodLabel('today', { from: '2026-09-25', to: '2026-09-25' })).toBe('Сегодня · 25 сентября');
  });

  test('валидация как у сервера: начало ≤ конец, ≤ 366 дней', () => {
    expect(rangeDays({ from: '2026-09-25', to: '2026-09-25' })).toBe(1);
    expect(periodError({ from: '2026-09-01', to: '2026-09-25' })).toBeNull();
    expect(periodError({ from: '2026-09-26', to: '2026-09-25' })).toBe('Дата начала позже даты конца');
    expect(periodError({ from: '2025-01-01', to: '2026-01-02' })).toMatch(/не длиннее 366 дней/);
    // Ровно 366 дней (високосный год) — допустимо.
    expect(periodError({ from: '2024-01-01', to: '2024-12-31' })).toBeNull();
    expect(periodError({ from: '', to: '2026-09-25' })).toBe('Укажите обе даты периода');
  });
});
