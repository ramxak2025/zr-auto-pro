// ═══════════════════════════════════════════════════════════════════════════
//  Конструктор отчётов — универсальный PDF из `ReportResult` (2026-09-25).
//
//  Один генератор на все одиннадцать отчётов: шапка (компания, отчёт, период,
//  фильтры, дата формирования) → KPI-плитки → основная таблица с итогом →
//  секции → «Методика» (текст из каталога + оговорки сервера). Новый отчёт
//  на сервере не требует правок здесь — вёрстка идёт по `columns`/`type`.
//
//  Чистая функция `buildReportPdfHtml` не тянет react-native и тестируется в
//  node-jest (см. __tests__/reportPdf.test.ts). `shareReportPdf` поднимает
//  expo-print / expo-sharing ЛЕНИВО через guarded require — тот же контракт,
//  что у orderPdf.ts: до батч-prebuild нативные модули могут быть не
//  слинкованы, и тогда показываем мягкий алерт вместо краша.
//
//  ВСЕ значения из данных экранируются `escapeHtml` — названия мастеров,
//  поставщиков, комментарии расходов и notes сервера идут в HTML только через
//  него. Числа и даты форматируем сами (reportFormat.ts), их экранировать не
//  нужно, но пропускаем через escapeHtml всё равно — дешевле, чем помнить,
//  где текст, а где число.
// ═══════════════════════════════════════════════════════════════════════════
import type { ReportColumn, ReportKpi, ReportResult, ReportRow, ReportSection } from '../../../shared/types';
import { escapeHtml } from './orderPdf';
import {
  cellAlign,
  describeReportFilters,
  formatCell,
  formatPeriodRange,
  formatReportDateTime,
  formatReportPercent,
  signedTone,
  visibleColumns,
} from './reportFormat';

export interface ReportPdfOptions {
  /** Название компании для шапки; по умолчанию — `meta.companyName` из ответа. */
  companyName?: string | null;
  /** Человекочитаемый период («Сентябрь 2026»); без него — даты периода. */
  periodLabel?: string | null;
  /** Подпись сущностного фильтра из каталога («Мастера») — для строки фильтров. */
  entityLabel?: string | null;
  /** Текст методики из каталога (REPORT_CATALOG[].method). */
  method?: string | null;
  /** Пояс автосервиса — для «сформирован …» и колонок datetime. */
  timeZone?: string | null;
  /** Принудительная ориентация; по умолчанию альбомная для широких таблиц. */
  landscape?: boolean;
}

/** С какого числа колонок таблица считается широкой и уходит в альбомный A4. */
export const WIDE_TABLE_COLUMNS = 7;

/** A4 в пунктах (72 ppi) — expo-print задаёт размер страницы через width/height. */
export const A4_PORTRAIT = { width: 595, height: 842 } as const;
export const A4_LANDSCAPE = { width: 842, height: 595 } as const;

const INK = '#0F172A';
const MUTED = '#64748B';
const LINE = '#E2E8F0';
const ZEBRA = '#F8FAFC';
const BRAND = '#2563EB';
const POS = '#15803D';
const NEG = '#B91C1C';
const WARN = '#B45309';

export function isWideReport(result: ReportResult): boolean {
  if (visibleColumns(result.columns).length >= WIDE_TABLE_COLUMNS) return true;
  return (result.sections ?? []).some((s) => visibleColumns(s.columns).length >= WIDE_TABLE_COLUMNS);
}

function css(landscape: boolean): string {
  return `
  @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm 11mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 0; color: ${INK}; font-size: 11px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .brandbar { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 3px solid ${BRAND}; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { font-size: 11px; font-weight: 800; letter-spacing: 3px; color: ${BRAND}; }
  .company { font-size: 18px; font-weight: 800; margin: 2px 0 0; letter-spacing: -0.3px; }
  .period { color: ${MUTED}; font-size: 11px; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title .k { font-size: 10px; font-weight: 700; letter-spacing: 1px; color: ${MUTED}; text-transform: uppercase; }
  .doc-title .t { font-size: 15px; font-weight: 800; margin-top: 2px; }
  .meta { color: ${MUTED}; font-size: 10px; margin: 0 0 12px; }
  .meta span + span::before { content: " · "; }
  table.kpis { width: 100%; border-collapse: separate; border-spacing: 6px 6px; margin: 0 -6px 12px; }
  table.kpis td { width: 25%; border: 1px solid ${LINE}; border-radius: 10px; padding: 8px 10px; vertical-align: top; }
  table.kpis .kl { font-size: 9px; font-weight: 700; letter-spacing: 0.8px; color: ${MUTED}; text-transform: uppercase; }
  table.kpis .kv { font-size: 16px; font-weight: 800; margin-top: 3px; letter-spacing: -0.4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.kpis .kd { font-size: 9px; margin-top: 2px; color: ${MUTED}; }
  .pos { color: ${POS}; } .neg { color: ${NEG}; } .warn { color: ${WARN}; }
  h2 { font-size: 10px; letter-spacing: 1px; color: ${MUTED}; margin: 16px 0 6px; text-transform: uppercase; font-weight: 700; page-break-after: avoid; }
  p.desc { color: ${MUTED}; font-size: 10px; margin: -2px 0 6px; }
  table.data { width: 100%; border-collapse: collapse; font-size: 10px; page-break-inside: auto; }
  table.data tr { page-break-inside: avoid; }
  table.data th, table.data td { text-align: left; padding: 5px 7px; vertical-align: top; }
  table.data thead th { background: ${INK}; color: #fff; font-size: 9px; letter-spacing: 0.4px; text-transform: uppercase; font-weight: 700; }
  table.data thead th:first-child { border-top-left-radius: 6px; }
  table.data thead th:last-child { border-top-right-radius: 6px; }
  table.data tbody tr:nth-child(even) { background: ${ZEBRA}; }
  table.data tbody td { border-bottom: 1px solid ${LINE}; }
  table.data tbody tr.tone-positive td { background: #F0FDF4; }
  table.data tbody tr.tone-negative td { background: #FEF2F2; }
  table.data tbody tr.tone-warning td { background: #FFFBEB; }
  table.data td.num, table.data th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.data td.center, table.data th.center { text-align: center; }
  table.data tfoot td { border-top: 2px solid ${INK}; font-weight: 800; padding-top: 6px; }
  p.empty { color: ${MUTED}; font-size: 10px; font-style: italic; margin: 4px 0 8px; }
  p.note { color: ${MUTED}; font-size: 9px; margin: 4px 0 0; }
  .method p { margin: 0 0 6px; font-size: 10px; }
  .method ul { margin: 0; padding-left: 16px; font-size: 10px; color: ${INK}; }
  .method li { margin: 2px 0; }
  .foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid ${LINE}; color: ${MUTED}; font-size: 9px; text-align: center; letter-spacing: 0.4px; }
  `;
}

function alignClass(column: ReportColumn): string {
  const align = cellAlign(column);
  if (align === 'right') return 'num';
  if (align === 'center') return 'center';
  return '';
}

function toneClass(column: ReportColumn, value: ReportRow[string] | undefined): string {
  if (!column.signed) return '';
  const tone = signedTone(value);
  return tone === 'positive' ? 'pos' : tone === 'negative' ? 'neg' : '';
}

function renderRow(columns: ReportColumn[], row: ReportRow, timeZone?: string | null): string {
  const tone = typeof row._tone === 'string' && row._tone ? ` class="tone-${escapeHtml(row._tone)}"` : '';
  const cells = columns
    .map((c) => {
      const cls = [alignClass(c), toneClass(c, row[c.key])].filter(Boolean).join(' ');
      return `<td${cls ? ` class="${cls}"` : ''}>${escapeHtml(formatCell(row[c.key], c.type, { timeZone }))}</td>`;
    })
    .join('');
  return `<tr${tone}>${cells}</tr>`;
}

function renderTotals(columns: ReportColumn[], totals: ReportRow, timeZone?: string | null): string {
  const cells = columns
    .map((c, i) => {
      const raw = totals[c.key];
      const isLabelCell = i === 0 && (raw === null || raw === undefined || raw === '');
      const text = isLabelCell ? 'Итого' : formatCell(raw, c.type, { timeZone });
      const cls = [alignClass(c), toneClass(c, raw)].filter(Boolean).join(' ');
      return `<td${cls ? ` class="${cls}"` : ''}>${escapeHtml(text)}</td>`;
    })
    .join('');
  return `<tfoot><tr>${cells}</tr></tfoot>`;
}

function renderTable(
  columnsAll: ReportColumn[],
  rows: ReportRow[],
  totals: ReportRow | null | undefined,
  emptyText: string,
  timeZone?: string | null,
): string {
  const columns = visibleColumns(columnsAll);
  if (columns.length === 0) return '';
  if (rows.length === 0) return `<p class="empty">${escapeHtml(emptyText)}</p>`;
  const head = columns
    .map((c) => {
      const cls = alignClass(c);
      return `<th${cls ? ` class="${cls}"` : ''}>${escapeHtml(c.title)}</th>`;
    })
    .join('');
  const body = rows.map((r) => renderRow(columns, r, timeZone)).join('');
  const foot = totals ? renderTotals(columns, totals, timeZone) : '';
  return `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

function renderKpis(kpis: ReportKpi[], timeZone?: string | null): string {
  if (kpis.length === 0) return '';
  const cells = kpis.map((k) => {
    const toneCls = k.tone && k.tone !== 'default' ? (k.tone === 'warning' ? 'warn' : k.tone) : '';
    const delta =
      typeof k.deltaPercent === 'number' && Number.isFinite(k.deltaPercent)
        ? `<div class="kd ${k.deltaPercent > 0 ? 'pos' : k.deltaPercent < 0 ? 'neg' : ''}">${k.deltaPercent > 0 ? '▲' : k.deltaPercent < 0 ? '▼' : '='} ${escapeHtml(
            formatReportPercent(Math.abs(k.deltaPercent)),
          )} к прошлому периоду</div>`
        : '';
    return `<td><div class="kl">${escapeHtml(k.title)}</div><div class="kv${toneCls ? ` ${toneCls}` : ''}">${escapeHtml(
      formatCell(k.value, k.type, { timeZone }),
    )}</div>${delta}</td>`;
  });
  // По четыре плитки в ряд; последний ряд добиваем пустыми ячейками, чтобы
  // ширины колонок не прыгали (print-движки не любят flex-wrap).
  const rowsHtml: string[] = [];
  for (let i = 0; i < cells.length; i += 4) {
    const chunk = cells.slice(i, i + 4);
    while (chunk.length < 4) chunk.push('<td style="border-color: transparent"></td>');
    rowsHtml.push(`<tr>${chunk.join('')}</tr>`);
  }
  return `<table class="kpis">${rowsHtml.join('')}</table>`;
}

function renderSection(section: ReportSection, timeZone?: string | null): string {
  const desc = section.description ? `<p class="desc">${escapeHtml(section.description)}</p>` : '';
  return `<h2>${escapeHtml(section.title)}</h2>${desc}${renderTable(
    section.columns,
    section.rows,
    section.totals,
    section.emptyText || 'Нет данных за период',
    timeZone,
  )}`;
}

/**
 * Собирает HTML отчёта (A4, inline CSS, без внешних ресурсов). Чистая функция.
 */
export function buildReportPdfHtml(result: ReportResult, opts: ReportPdfOptions = {}): string {
  const landscape = opts.landscape ?? isWideReport(result);
  const companyName = escapeHtml(opts.companyName || result.meta?.companyName || 'Автосервис');
  const periodDates = formatPeriodRange(result.period.from, result.period.to);
  const periodLine =
    opts.periodLabel && opts.periodLabel !== periodDates ? `${opts.periodLabel} · ${periodDates}` : periodDates;
  const filtersLine = describeReportFilters(result.filters, opts.entityLabel);
  const generated = formatReportDateTime(result.generatedAt, opts.timeZone);

  const metaParts = [
    `<span>Период: ${escapeHtml(periodLine)}</span>`,
    filtersLine ? `<span>${escapeHtml(filtersLine)}</span>` : '',
    result.meta?.pointName
      ? `<span>Филиал: ${escapeHtml(result.meta.pointName)}</span>`
      : result.meta?.scope === 'all'
        ? '<span>Все филиалы</span>'
        : '',
    `<span>Сформирован: ${escapeHtml(generated)}</span>`,
  ].filter(Boolean);

  const truncated =
    result.meta?.truncated && result.meta.rowLimit
      ? `<p class="note">Показаны первые ${result.meta.rowLimit} строк — сузьте период или фильтр, чтобы увидеть остальные.</p>`
      : '';

  const sections = (result.sections ?? []).map((s) => renderSection(s, opts.timeZone)).join('');

  const notes = result.notes?.filter(Boolean) ?? [];
  const method =
    opts.method || notes.length > 0
      ? `<h2>Методика</h2><div class="method">${opts.method ? `<p>${escapeHtml(opts.method)}</p>` : ''}${
          notes.length > 0 ? `<ul>${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''
        }</div>`
      : '';

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>${css(landscape)}</style></head>
<body>
  <div class="brandbar">
    <div>
      <div class="brand">AUTEXA</div>
      <h1 class="company">${companyName}</h1>
      <div class="period">${escapeHtml(periodLine)}</div>
    </div>
    <div class="doc-title"><div class="k">Отчёт</div><div class="t">${escapeHtml(result.title)}</div></div>
  </div>
  <div class="meta">${metaParts.join('')}</div>
  ${renderKpis(result.kpis ?? [], opts.timeZone)}
  ${renderTable(result.columns, result.rows, result.totals, 'За период нет данных', opts.timeZone)}
  ${truncated}
  ${sections}
  ${method}
  <div class="foot">${companyName} · ${escapeHtml(result.title)} · ${escapeHtml(periodDates)} · сформировано в Autexa</div>
</body></html>`;
}

// Alert поднимаем лениво — модуль с чистым `buildReportPdfHtml` НЕ должен
// тянуть 'react-native' статически (иначе не импортируется в node-jest).
function showAlert(title: string, message: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Alert } = require('react-native') as typeof import('react-native');
    Alert.alert(title, message);
  } catch {
    /* вне RN-окружения (тесты) — no-op */
  }
}

/** Имя файла: «Отчёт по мастерам 2026-09-01 — 2026-09-25.pdf» без символов, ломающих share-sheet. */
export function reportPdfFileName(result: ReportResult): string {
  const safeTitle = result.title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${safeTitle} ${result.period.from} — ${result.period.to}.pdf`;
}

/**
 * Строит PDF отчёта и открывает системный share-sheet (печать, «Сохранить в
 * Файлы», отправить в мессенджер). Возвращает true, если лист открыт.
 */
export async function shareReportPdf(result: ReportResult, opts: ReportPdfOptions = {}): Promise<boolean> {
  let Print: typeof import('expo-print');
  let Sharing: typeof import('expo-sharing');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Print = require('expo-print');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sharing = require('expo-sharing');
    if (typeof Print?.printToFileAsync !== 'function') throw new Error('ExpoPrint not linked');
  } catch {
    showAlert('Экспорт недоступен', 'Доступно после обновления приложения.');
    return false;
  }

  try {
    const landscape = opts.landscape ?? isWideReport(result);
    const html = buildReportPdfHtml(result, { ...opts, landscape });
    const page = landscape ? A4_LANDSCAPE : A4_PORTRAIT;
    const { uri } = await Print.printToFileAsync({ html, base64: false, width: page.width, height: page.height });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: reportPdfFileName(result),
        UTI: 'com.adobe.pdf',
      });
      return true;
    }
    showAlert('PDF создан', uri);
    return false;
  } catch {
    showAlert('Ошибка', 'Не удалось создать PDF отчёта.');
    return false;
  }
}
