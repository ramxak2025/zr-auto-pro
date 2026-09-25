/**
 * Экспорт отчёта конструктора (ReportResult) в Excel и PDF.
 *
 * Один универсальный генератор для всех 11 отчётов: порядок блоков одинаков в
 * обоих форматах — шапка (компания / отчёт / период / охват / фильтры / дата
 * формирования) → KPI → основная таблица с итого → секции → методика.
 *
 * Excel — через `xlsx` (динамический import: чанк грузится только по кнопке),
 * числа остаются числами с форматами (деньги / проценты / целые), чтобы в
 * таблице можно было считать. PDF — печатная HTML-версия → `html2pdf.js`
 * (тот же конвейер, что у generateOrderPdf.ts); A4 альбомная, когда хотя бы
 * одна таблица шире шести колонок.
 */
import type { ReportColumn, ReportColumnType, ReportKpi, ReportResult, ReportRow } from '../types';
import { formatDateTime } from '../../../shared/utils/formatters';
import {
  cellNumber,
  formatDayKeyRu,
  formatKpiValue,
  formatReportValue,
  isNumericType,
} from '../components/reports/reportFormat';

export interface ReportExportContext {
  /** Название компании, если сервер не прислал meta.companyName. */
  companyName?: string | null;
  /** Пояс автосервиса — для «сформирован …» и колонок datetime. */
  timeZone?: string | null;
}

interface ReportHeader {
  company: string;
  title: string;
  lines: string[];
}

function headerOf(result: ReportResult, ctx: ReportExportContext): ReportHeader {
  const company = result.meta?.companyName || ctx.companyName || 'Autexa';
  const scope =
    result.meta?.scope === 'all' || !result.meta?.pointName ? 'вся компания' : `филиал «${result.meta.pointName}»`;
  const lines = [
    `Период: ${formatDayKeyRu(result.period.from)} — ${formatDayKeyRu(result.period.to)}`,
    `Охват: ${scope}`,
  ];
  const labels = result.filters?.entityLabels ?? [];
  if (labels.length > 0) lines.push(`Фильтр: ${labels.join(', ')}`);
  if (result.filters?.groupByLabel) lines.push(`Группировка: ${result.filters.groupByLabel}`);
  lines.push(`Сформирован: ${formatDateTime(result.generatedAt, ctx.timeZone)}`);
  if (result.meta?.truncated)
    lines.push(`Таблица усечена: показаны первые ${result.meta.rowLimit ?? result.rows.length} строк`);
  return { company, title: result.title, lines };
}

/** Имя файла без расширения: «По мастерам 01.09.2026–30.09.2026». */
function fileBase(result: ReportResult): string {
  const safe = result.title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${safe} ${formatDayKeyRu(result.period.from)}–${formatDayKeyRu(result.period.to)}`;
}

// ── Excel ───────────────────────────────────────────────────────────────────

/** Числовые форматы Excel по типу колонки; number — General (1,5 / 15). */
const XLSX_FORMATS: Partial<Record<ReportColumnType, string>> = {
  money: '#,##0.00 "₽"',
  percent: '0.0"%"',
  int: '#,##0',
};

type XlsxCell = string | number | null;

export async function exportReportToExcel(result: ReportResult, ctx: ReportExportContext = {}): Promise<void> {
  const XLSX = await import('xlsx');
  const header = headerOf(result, ctx);

  const aoa: XlsxCell[][] = [];
  const formats: Array<{ r: number; c: number; z: string }> = [];
  let maxCols = 2;

  const valueCell = (raw: ReportRow[string] | undefined, col: ReportColumn, r: number, c: number): XlsxCell => {
    if (raw === null || raw === undefined || raw === '') return null;
    if (isNumericType(col.type)) {
      const n = cellNumber(raw);
      if (n === null) return String(raw);
      const z = XLSX_FORMATS[col.type];
      if (z) formats.push({ r, c, z });
      return n;
    }
    return formatReportValue(raw, col.type, { timeZone: ctx.timeZone });
  };

  const writeTable = (columns: ReportColumn[], rows: ReportRow[], totals?: ReportRow | null) => {
    maxCols = Math.max(maxCols, columns.length);
    aoa.push(columns.map((c) => c.title));
    for (const row of rows) {
      const r = aoa.length;
      aoa.push(columns.map((c, ci) => valueCell(row[c.key], c, r, ci)));
    }
    if (totals) {
      const r = aoa.length;
      aoa.push(
        columns.map((c, ci) => {
          if (ci === 0) {
            const v = totals[c.key];
            return v === null || v === undefined || v === '' ? 'Итого' : String(v);
          }
          return valueCell(totals[c.key], c, r, ci);
        }),
      );
    }
  };

  const kpiCell = (kpi: ReportKpi, r: number): XlsxCell => {
    if (kpi.type === 'text' || !isNumericType(kpi.type)) return formatKpiValue(kpi, ctx.timeZone);
    const n = cellNumber(kpi.value);
    if (n === null) return formatKpiValue(kpi, ctx.timeZone);
    const z = XLSX_FORMATS[kpi.type];
    if (z) formats.push({ r, c: 1, z });
    return n;
  };

  // Шапка
  aoa.push([header.company]);
  aoa.push([header.title]);
  for (const line of header.lines) aoa.push([line]);
  aoa.push([]);

  // KPI
  if (result.kpis.length > 0) {
    aoa.push(['Показатели']);
    for (const kpi of result.kpis) {
      const r = aoa.length;
      const row: XlsxCell[] = [kpi.title, kpiCell(kpi, r)];
      if (typeof kpi.deltaPercent === 'number' && Number.isFinite(kpi.deltaPercent)) {
        row.push(`${kpi.deltaPercent > 0 ? '+' : ''}${kpi.deltaPercent}% к прошлому периоду`);
      }
      aoa.push(row);
    }
    aoa.push([]);
  }

  // Основная таблица
  aoa.push(['Детализация']);
  if (result.rows.length === 0) aoa.push(['За период нет данных']);
  else writeTable(result.columns, result.rows, result.totals);
  aoa.push([]);

  // Секции
  for (const section of result.sections ?? []) {
    aoa.push([section.title]);
    if (section.description) aoa.push([section.description]);
    if (section.rows.length === 0) aoa.push([section.emptyText ?? 'За период нет данных']);
    else writeTable(section.columns, section.rows, section.totals);
    aoa.push([]);
  }

  // Методика
  if (result.notes && result.notes.length > 0) {
    aoa.push(['Методика']);
    for (const note of result.notes) aoa.push([note]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const f of formats) {
    const cell = ws[XLSX.utils.encode_cell({ r: f.r, c: f.c })];
    if (cell && cell.t === 'n') cell.z = f.z;
  }
  // Ширины: первая колонка — названия, остальные — числа.
  const widths: Array<{ wch: number }> = [{ wch: 36 }];
  for (let i = 1; i < maxCols; i += 1) widths.push({ wch: 18 });
  ws['!cols'] = widths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Отчёт');
  XLSX.writeFile(wb, `${fileBase(result)}.xlsx`);
}

// ── PDF ─────────────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TONE_BG: Record<string, string> = {
  negative: '#fef2f2',
  warning: '#fffbeb',
  positive: '#f0fdf4',
};

function tableHtml(
  columns: ReportColumn[],
  rows: ReportRow[],
  totals: ReportRow | null | undefined,
  tz?: string | null,
): string {
  const th = columns
    .map((c) => `<th style="text-align:${isNumericType(c.type) ? 'right' : (c.align ?? 'left')}">${esc(c.title)}</th>`)
    .join('');
  const cell = (row: ReportRow, c: ReportColumn, bold = false): string => {
    const raw = row[c.key];
    const numeric = isNumericType(c.type);
    let text = formatReportValue(raw, c.type, { timeZone: tz, signed: c.signed });
    let color = '';
    if (c.type === 'money' && c.signed) {
      const n = cellNumber(raw);
      if (n !== null && n < 0) color = 'color:#b91c1c;';
      else if (n !== null && n > 0) color = 'color:#15803d;';
    }
    if (text === '—') text = '<span style="color:#94a3b8">—</span>';
    else text = esc(text);
    return `<td style="text-align:${numeric ? 'right' : (c.align ?? 'left')};${color}${bold ? 'font-weight:700;' : ''}${numeric ? 'white-space:nowrap;' : ''}">${text}</td>`;
  };
  const body = rows
    .map((row) => {
      const tone = typeof row._tone === 'string' ? TONE_BG[row._tone] : undefined;
      return `<tr${tone ? ` style="background:${tone}"` : ''}>${columns.map((c) => cell(row, c)).join('')}</tr>`;
    })
    .join('');
  const foot = totals
    ? `<tfoot><tr>${columns
        .map((c, i) => {
          if (i === 0) {
            const v = totals[c.key];
            return `<td style="font-weight:700">${esc(v === null || v === undefined || v === '' ? 'Итого' : String(v))}</td>`;
          }
          return cell(totals, c, true);
        })
        .join('')}</tr></tfoot>`
    : '';
  return `<table class="rp-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

function buildPrintHtml(result: ReportResult, ctx: ReportExportContext, landscape: boolean): string {
  const header = headerOf(result, ctx);
  const width = landscape ? 1080 : 760;
  const kpiWidth = landscape ? 'calc(16.66% - 8px)' : 'calc(25% - 8px)';

  const kpis = result.kpis
    .map((k) => {
      const delta =
        typeof k.deltaPercent === 'number' && Number.isFinite(k.deltaPercent)
          ? `<div class="rp-kpi-delta" style="color:${k.deltaPercent >= 0 ? '#15803d' : '#b91c1c'}">${k.deltaPercent > 0 ? '+' : ''}${esc(String(k.deltaPercent))}% к прошлому периоду</div>`
          : '';
      const color =
        k.tone === 'negative'
          ? '#b91c1c'
          : k.tone === 'positive'
            ? '#15803d'
            : k.tone === 'warning'
              ? '#b45309'
              : '#0f172a';
      return `<div class="rp-kpi"><div class="rp-kpi-label">${esc(k.title)}</div><div class="rp-kpi-value" style="color:${color}">${esc(formatKpiValue(k, ctx.timeZone))}</div>${delta}</div>`;
    })
    .join('');

  const mainTable =
    result.rows.length === 0
      ? '<p class="rp-empty">За период нет данных</p>'
      : tableHtml(result.columns, result.rows, result.totals, ctx.timeZone);

  const sections = (result.sections ?? [])
    .map(
      (s) => `
      <h2 class="rp-h2">${esc(s.title)}</h2>
      ${s.description ? `<p class="rp-desc">${esc(s.description)}</p>` : ''}
      ${s.rows.length === 0 ? `<p class="rp-empty">${esc(s.emptyText ?? 'За период нет данных')}</p>` : tableHtml(s.columns, s.rows, s.totals, ctx.timeZone)}`,
    )
    .join('');

  const notes =
    result.notes && result.notes.length > 0
      ? `<h2 class="rp-h2">Методика</h2><ul class="rp-notes">${result.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
      : '';

  return `
<div class="rp-root" style="width:${width}px">
  <style>
    .rp-root{font-family:Onest,Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#0f172a;background:#fff;padding:24px 28px;box-sizing:border-box}
    .rp-root .rp-company{font-size:12px;font-weight:600;color:#475569}
    .rp-root .rp-title{font-size:20px;font-weight:700;margin:2px 0 6px;letter-spacing:-.01em}
    .rp-root .rp-meta{font-size:10.5px;color:#475569;margin:0 0 14px;border-bottom:2px solid #0f172a;padding-bottom:10px}
    .rp-root .rp-meta div{margin-top:1px}
    .rp-root .rp-kpis{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
    .rp-root .rp-kpi{width:${kpiWidth};box-sizing:border-box;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;page-break-inside:avoid}
    .rp-root .rp-kpi-label{font-size:9.5px;color:#64748b}
    .rp-root .rp-kpi-value{font-size:14px;font-weight:700;margin-top:2px;white-space:nowrap;font-variant-numeric:tabular-nums}
    .rp-root .rp-kpi-delta{font-size:9px;margin-top:2px}
    .rp-root .rp-h2{font-size:13px;font-weight:700;margin:16px 0 6px;page-break-after:avoid}
    .rp-root .rp-desc{font-size:10px;color:#64748b;margin:0 0 6px}
    .rp-root .rp-empty{font-size:10.5px;color:#64748b;margin:4px 0 10px}
    .rp-root .rp-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
    .rp-root .rp-table th{font-size:9.5px;font-weight:600;color:#475569;background:#f1f5f9;padding:5px 7px;border:1px solid #d9dee7;white-space:nowrap}
    .rp-root .rp-table td{font-size:10.5px;padding:4px 7px;border:1px solid #e2e8f0;vertical-align:top}
    .rp-root .rp-table tr{page-break-inside:avoid}
    .rp-root .rp-table tfoot td{background:#f8fafc;border-top:2px solid #cbd5e1}
    .rp-root .rp-notes{font-size:10px;color:#475569;margin:0;padding-left:16px}
    .rp-root .rp-notes li{margin:2px 0}
    .rp-root .rp-footer{margin-top:16px;font-size:9.5px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:6px}
  </style>
  <div class="rp-company">${esc(header.company)}</div>
  <div class="rp-title">${esc(header.title)}</div>
  <div class="rp-meta">${header.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
  ${kpis ? `<div class="rp-kpis">${kpis}</div>` : ''}
  <h2 class="rp-h2">Детализация</h2>
  ${mainTable}
  ${sections}
  ${notes}
  <div class="rp-footer">Autexa · ${esc(header.title)} · ${esc(header.lines[0] ?? '')}</div>
</div>`;
}

export async function exportReportToPdf(result: ReportResult, ctx: ReportExportContext = {}): Promise<void> {
  const widest = Math.max(result.columns.length, ...(result.sections ?? []).map((s) => s.columns.length));
  const landscape = widest > 6;

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.innerHTML = buildPrintHtml(result, ctx, landscape);
  document.body.appendChild(container);

  try {
    const html2pdf = (await import('html2pdf.js')).default;
    const element = container.firstElementChild as HTMLElement;
    const worker = html2pdf();
    // `pagebreak` поддерживается html2pdf.js с 0.9, но отсутствует в типах пакета.
    type SetOptions = Parameters<typeof worker.set>[0];
    const options = {
      margin: [10, 8, 12, 8] as [number, number, number, number],
      filename: `${fileBase(result)}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: landscape ? ('landscape' as const) : ('portrait' as const) },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.rp-kpi', '.rp-h2'] },
    };
    await worker
      .set(options as SetOptions)
      .from(element)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}
