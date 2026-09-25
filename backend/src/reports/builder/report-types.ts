/**
 * ЗЕРКАЛО shared/types/index.ts — секция «КОНСТРУКТОР ОТЧЁТОВ». Менять синхронно.
 *
 * Backend не импортирует `shared/` (файл вне rootDir: любой импорт из
 * `../../../shared` переносит общий корень компиляции на корень монорепо, и
 * `dist/main.js` превращается в `dist/backend/src/main.js` — падает
 * `node dist/main` в Dockerfile). Поэтому контракт ответа продублирован здесь
 * дословно; источник правды — shared, при расхождении правится ОБА файла.
 */

export type ReportId =
  | 'summary'
  | 'masters'
  | 'salary'
  | 'suppliers'
  | 'clients'
  | 'products'
  | 'services'
  | 'payments'
  | 'expenses'
  | 'bookings'
  | 'points';

export type ReportColumnType = 'text' | 'money' | 'number' | 'int' | 'percent' | 'date' | 'datetime';

export interface ReportColumn {
  key: string;
  title: string;
  type: ReportColumnType;
  align?: 'left' | 'right' | 'center';
  hint?: string;
  signed?: boolean;
  width?: number;
}

export type ReportCell = string | number | null;

export interface ReportRow {
  [key: string]: ReportCell;
}

export type ReportTone = 'default' | 'positive' | 'negative' | 'warning';

export interface ReportKpi {
  key: string;
  title: string;
  value: number | string | null;
  type: ReportColumnType;
  hint?: string;
  tone?: ReportTone;
  deltaPercent?: number | null;
}

export interface ReportSection {
  key: string;
  title: string;
  description?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow | null;
  emptyText?: string;
}

export interface ReportAppliedFilters {
  entityIds?: string[];
  entityLabels?: string[];
  groupBy?: string | null;
  groupByLabel?: string | null;
}

export interface ReportResult {
  reportId: ReportId;
  title: string;
  period: { from: string; to: string };
  generatedAt: string;
  filters: ReportAppliedFilters;
  kpis: ReportKpi[];
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow | null;
  sections?: ReportSection[];
  notes?: string[];
  meta?: {
    pointName?: string | null;
    scope?: 'point' | 'all';
    truncated?: boolean;
    rowLimit?: number;
    companyName?: string;
  };
}

export type ReportFilterKind = 'masters' | 'employees' | 'suppliers' | 'points';

export interface ReportFilterOption {
  id: string;
  label: string;
  sublabel?: string;
}

export interface ReportFilterOptions {
  kind: ReportFilterKind;
  label: string;
  multi: boolean;
  options: ReportFilterOption[];
}

export interface ReportCatalogResponse {
  reports: Array<{
    id: ReportId;
    available: boolean;
    reason?: string | null;
  }>;
}
