/**
 * reportPdf tests — универсальный PDF конструктора отчётов.
 *
 * buildReportPdfHtml — чистая функция, поэтому проверяем вёрстку напрямую:
 * шапка (компания / отчёт / период / фильтры / дата), KPI с дельтой, таблица
 * с типизированным форматированием, знаковые колонки, тон строк, итог,
 * секции (в т.ч. пустая), методика + оговорки, ориентация страницы и —
 * критично — экранирование текста из данных (имена мастеров, комментарии).
 */
import type { ReportResult } from '../../../../shared/types';
import {
  A4_LANDSCAPE,
  A4_PORTRAIT,
  buildReportPdfHtml,
  isWideReport,
  reportPdfFileName,
  reportPdfFileUri,
} from '../reportPdf';

function makeResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    reportId: 'masters',
    title: 'Отчёт по мастерам',
    period: { from: '2026-09-01', to: '2026-09-25' },
    generatedAt: '2026-09-25T11:32:00.000Z',
    filters: { entityIds: ['m1', 'm2'], entityLabels: ['Иванов', 'Петров'], groupBy: null, groupByLabel: null },
    kpis: [
      { key: 'revenue', title: 'Выручка', value: 245600, type: 'money', deltaPercent: 12.5 },
      { key: 'profit', title: 'Прибыль', value: 98400.5, type: 'money', tone: 'positive', deltaPercent: -4 },
      { key: 'checks', title: 'Чеков', value: 37, type: 'int', deltaPercent: 0 },
      { key: 'discounts', title: 'Скидки', value: null, type: 'money' },
    ],
    columns: [
      { key: 'master', title: 'Мастер', type: 'text' },
      { key: 'checks', title: 'Чеков', type: 'int' },
      { key: 'revenue', title: 'Выручка', type: 'money' },
      { key: 'margin', title: 'Маржа', type: 'percent' },
      { key: 'balance', title: 'Остаток', type: 'money', signed: true },
    ],
    rows: [
      { _id: 'm1', _href: '/employees/m1', master: 'Иванов', checks: 12, revenue: 98400, margin: 31.25, balance: 1200 },
      {
        _id: 'm2',
        _href: '/employees/m2',
        _tone: 'warning',
        master: 'Петров',
        checks: 9,
        revenue: 74100,
        margin: 28,
        balance: -3200,
      },
      { _id: 'm3', master: 'Сидоров', checks: 0, revenue: null, margin: null, balance: 0 },
    ],
    totals: { master: null, checks: 21, revenue: 172500, margin: 29.8, balance: -2000 },
    sections: [
      {
        key: 'services',
        title: 'Топ-5 услуг',
        description: 'По выручке за период',
        columns: [
          { key: 'name', title: 'Услуга', type: 'text' },
          { key: 'qty', title: 'Кол-во', type: 'int' },
          { key: 'sum', title: 'Выручка', type: 'money' },
        ],
        rows: [{ name: 'Замена масла', qty: 14, sum: 21000 }],
        totals: { name: null, qty: 14, sum: 21000 },
      },
      {
        key: 'returns',
        title: 'Возвраты',
        columns: [
          { key: 'date', title: 'Дата', type: 'date' },
          { key: 'sum', title: 'Сумма', type: 'money' },
        ],
        rows: [],
        emptyText: 'Возвратов за период не было',
      },
    ],
    notes: ['Гарантийные чеки не входят в выручку', 'Долг: + мы должны, − нам должны'],
    meta: { pointName: 'Центральный', scope: 'point', companyName: 'Автосервис «Гараж»' },
    ...overrides,
  };
}

describe('buildReportPdfHtml — шапка', () => {
  test('компания, название отчёта, период, фильтры, филиал и дата формирования', () => {
    const html = buildReportPdfHtml(makeResult(), {
      periodLabel: 'Сентябрь 2026',
      entityLabel: 'Мастера',
      timeZone: 'Europe/Moscow',
    });
    expect(html).toContain('Автосервис «Гараж»');
    expect(html).toContain('Отчёт по мастерам');
    expect(html).toContain('Сентябрь 2026 · 01.09.2026 — 25.09.2026');
    expect(html).toContain('Мастера: Иванов, Петров');
    expect(html).toContain('Филиал: Центральный');
    expect(html).toContain('Сформирован: 25.09.26 14:32');
  });

  test('companyName из опций важнее meta.companyName; без обоих — «Автосервис»', () => {
    expect(buildReportPdfHtml(makeResult(), { companyName: 'ООО Ромашка' })).toContain('ООО Ромашка');
    expect(buildReportPdfHtml(makeResult({ meta: {} }))).toContain('Автосервис');
  });
});

describe('buildReportPdfHtml — KPI', () => {
  test('плитки с типизированным значением и стрелкой дельты', () => {
    const html = buildReportPdfHtml(makeResult());
    expect(html).toContain('Выручка');
    expect(html).toContain('245 600 ₽');
    expect(html).toContain('98 400,50 ₽');
    expect(html).toContain('▲ 12,5% к прошлому периоду');
    expect(html).toContain('▼ 4% к прошлому периоду');
    // Нулевая дельта — без стрелки, null-значение — прочерк.
    expect(html).toContain('= 0% к прошлому периоду');
    expect(html).toMatch(/Скидки<\/div><div class="kv">—<\/div>/);
  });
});

describe('buildReportPdfHtml — основная таблица', () => {
  test('заголовки колонок, числовые — с классом num, служебные ключи не выводятся', () => {
    const html = buildReportPdfHtml(makeResult());
    expect(html).toContain('<th>Мастер</th>');
    expect(html).toContain('<th class="num">Чеков</th>');
    expect(html).not.toContain('_id');
    expect(html).not.toContain('/employees/m1');
  });

  test('значения отформатированы по типу, знаковая колонка окрашена, тон строки применён', () => {
    const html = buildReportPdfHtml(makeResult());
    expect(html).toContain('<td>Иванов</td>');
    expect(html).toContain('<td class="num">12</td>');
    expect(html).toContain('98 400 ₽');
    // Проценты — один знак после запятой, как на экране.
    expect(html).toContain('31,3%');
    expect(html).toContain('<td class="num pos">1 200 ₽</td>');
    expect(html).toContain('<td class="num neg">−3 200 ₽</td>');
    expect(html).toContain('<tr class="tone-warning">');
    // Ноль в знаковой колонке — без цвета; null — прочерк.
    expect(html).toContain('<td class="num">0 ₽</td>');
    expect(html).toContain('<td class="num">—</td>');
  });

  test('итог в tfoot: подпись «Итого» в первой колонке и суммы по остальным', () => {
    const html = buildReportPdfHtml(makeResult());
    expect(html).toMatch(/<tfoot><tr><td>Итого<\/td><td class="num">21<\/td><td class="num">172 500 ₽<\/td>/);
    expect(html).toContain('<td class="num neg">−2 000 ₽</td></tr></tfoot>');
  });

  test('пустая таблица → понятный текст, без tfoot', () => {
    const html = buildReportPdfHtml(makeResult({ rows: [], totals: null, sections: [] }));
    expect(html).toContain('За период нет данных');
    expect(html).not.toContain('<tfoot>');
  });

  test('усечённая таблица → подсказка про лимит строк', () => {
    const html = buildReportPdfHtml(makeResult({ meta: { truncated: true, rowLimit: 500 } }));
    expect(html).toContain('Показаны первые 500 строк');
  });
});

describe('buildReportPdfHtml — секции и методика', () => {
  test('секции с заголовком, описанием, таблицей и итогом; пустая секция — её emptyText', () => {
    const html = buildReportPdfHtml(makeResult());
    expect(html).toContain('<h2>Топ-5 услуг</h2><p class="desc">По выручке за период</p>');
    expect(html).toContain('Замена масла');
    expect(html).toContain('21 000 ₽');
    expect(html).toContain('<h2>Возвраты</h2>');
    expect(html).toContain('<p class="empty">Возвратов за период не было</p>');
  });

  test('«Методика» = текст каталога + оговорки сервера', () => {
    const html = buildReportPdfHtml(makeResult(), { method: 'Чек относится к мастеру, указанному в чеке.' });
    expect(html).toContain('<h2>Методика</h2>');
    expect(html).toContain('Чек относится к мастеру, указанному в чеке.');
    expect(html).toContain('<li>Гарантийные чеки не входят в выручку</li>');
    expect(html).toContain('<li>Долг: + мы должны, − нам должны</li>');
  });

  test('без метода и notes блока «Методика» нет', () => {
    const html = buildReportPdfHtml(makeResult({ notes: [] }));
    expect(html).not.toContain('<h2>Методика</h2>');
  });
});

describe('buildReportPdfHtml — безопасность', () => {
  test('HTML из данных экранируется (имена, notes, заголовки секций)', () => {
    const html = buildReportPdfHtml(
      makeResult({
        rows: [{ master: '<script>alert(1)</script>', checks: 1, revenue: 1, margin: 1, balance: 1 }],
        notes: ['<img src=x onerror=alert(1)>'],
        sections: [{ key: 's', title: '<b>секция</b>', columns: [{ key: 'a', title: 'A', type: 'text' }], rows: [] }],
      }),
      { companyName: 'ООО "Кавычки" & Ко' },
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>секция</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('ООО &quot;Кавычки&quot; &amp; Ко');
  });
});

describe('ориентация страницы', () => {
  test('≤ 6 колонок — книжная, ≥ 7 — альбомная, опция landscape перекрывает', () => {
    const narrow = makeResult();
    expect(isWideReport(narrow)).toBe(false);
    expect(buildReportPdfHtml(narrow)).toContain('size: A4 portrait');

    const wideColumns = Array.from({ length: 7 }, (_, i) => ({
      key: `c${i}`,
      title: `Колонка ${i}`,
      type: 'int' as const,
    }));
    const wide = makeResult({ columns: wideColumns, rows: [], totals: null, sections: [] });
    expect(isWideReport(wide)).toBe(true);
    expect(buildReportPdfHtml(wide)).toContain('size: A4 landscape');
    expect(buildReportPdfHtml(wide, { landscape: false })).toContain('size: A4 portrait');
  });

  test('широкая секция тоже переводит документ в альбомную', () => {
    const cols = Array.from({ length: 8 }, (_, i) => ({ key: `c${i}`, title: `К${i}`, type: 'text' as const }));
    const r = makeResult({ sections: [{ key: 'w', title: 'Широкая', columns: cols, rows: [] }] });
    expect(isWideReport(r)).toBe(true);
  });

  test('размеры A4 в пунктах согласованы с ориентацией', () => {
    expect(A4_PORTRAIT).toEqual({ width: 595, height: 842 });
    expect(A4_LANDSCAPE).toEqual({ width: 842, height: 595 });
  });
});

describe('reportPdfFileName', () => {
  test('название + период, без символов, ломающих файловую систему', () => {
    const name = reportPdfFileName(makeResult({ title: 'По способам оплаты: нал/карта' }));
    expect(name).toBe('По способам оплаты нал карта 2026-09-01 — 2026-09-25.pdf');
  });

  test('URI в кэш-папке: имя percent-encoded, на диске декодируется в человеческое', () => {
    const uri = reportPdfFileUri('file:///data/Caches/', makeResult());
    expect(uri.startsWith('file:///data/Caches/')).toBe(true);
    // Сырой кириллицы/пробелов в URI нет — иначе нативный модуль не соберёт URL.
    expect(uri.slice('file:///data/Caches/'.length)).toMatch(/^[A-Za-z0-9%._-]+$/);
    expect(decodeURIComponent(uri)).toBe('file:///data/Caches/Отчёт по мастерам 2026-09-01 — 2026-09-25.pdf');
  });
});
