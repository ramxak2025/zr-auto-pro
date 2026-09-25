/**
 * ЗЕРКАЛО shared/reports/catalog.ts — менять синхронно.
 *
 * Здесь только то, что нужно серверу: id, название (для шапки ReportResult),
 * право доступа, признаки owner-only / «≥ 2 филиалов», вид сущностного фильтра
 * и варианты группировки (для валидации `groupBy`). Описания и «методика»
 * живут в shared и рендерятся клиентами — сервер их не дублирует.
 *
 * Почему зеркало, а не импорт: backend компилируется без rootDir, и импорт
 * файла из `../../../shared` уводит корень `dist/` на корень монорепо
 * (см. report-types.ts). Инвариант: список id здесь == REPORT_IDS в shared;
 * расхождение сломает клиентам «недоступный отчёт без reason».
 */
import { ReportFilterKind, ReportId } from './report-types';

export interface ReportGroupByOption {
  value: string;
  label: string;
}

export interface ReportDefinition {
  id: ReportId;
  title: string;
  entityFilter?: { kind: ReportFilterKind; label: string; multi: boolean };
  groupByOptions?: ReportGroupByOption[];
  /** Право из матрицы ролей, достаточное для отчёта (альтернатива financial_reports). */
  permission?: string;
  ownerOnly?: boolean;
  requiresMultiPoint?: boolean;
}

export const REPORT_CATALOG: ReportDefinition[] = [
  { id: 'summary', title: 'Сводный отчёт', permission: 'financial_reports' },
  {
    id: 'masters',
    title: 'По мастерам',
    entityFilter: { kind: 'masters', label: 'Мастера', multi: true },
    permission: 'financial_reports',
  },
  {
    id: 'salary',
    title: 'По зарплатам',
    entityFilter: { kind: 'employees', label: 'Сотрудники', multi: true },
    permission: 'salary_view',
  },
  {
    id: 'suppliers',
    title: 'По поставщикам',
    entityFilter: { kind: 'suppliers', label: 'Поставщики', multi: true },
    permission: 'suppliers_access',
  },
  { id: 'clients', title: 'По клиентам', permission: 'clients_view' },
  {
    id: 'products',
    title: 'По товарам',
    groupByOptions: [
      { value: 'product', label: 'По товарам' },
      { value: 'category', label: 'По папкам' },
    ],
    permission: 'warehouse_access',
  },
  { id: 'services', title: 'По услугам', permission: 'financial_reports' },
  { id: 'payments', title: 'По способам оплаты', permission: 'financial_reports' },
  { id: 'expenses', title: 'По расходам', permission: 'financial_reports' },
  { id: 'bookings', title: 'По записям', permission: 'bookings_access' },
  {
    id: 'points',
    title: 'По филиалам',
    entityFilter: { kind: 'points', label: 'Филиалы', multi: true },
    ownerOnly: true,
    requiresMultiPoint: true,
  },
];

export const REPORT_IDS: ReportId[] = REPORT_CATALOG.map((r) => r.id);

export function isReportId(value: unknown): value is ReportId {
  return typeof value === 'string' && (REPORT_IDS as string[]).includes(value);
}

export function getReportDefinition(id: ReportId): ReportDefinition {
  const def = REPORT_CATALOG.find((r) => r.id === id);
  if (!def) throw new Error(`Unknown report: ${id}`);
  return def;
}

/** Подписи фильтров — по виду, а не по отчёту (один вид = одна подпись). */
export const FILTER_KIND_LABELS: Record<ReportFilterKind, string> = {
  masters: 'Мастера',
  employees: 'Сотрудники',
  suppliers: 'Поставщики',
  points: 'Филиалы',
};

export const FILTER_KINDS: ReportFilterKind[] = ['masters', 'employees', 'suppliers', 'points'];

export function isFilterKind(value: unknown): value is ReportFilterKind {
  return typeof value === 'string' && (FILTER_KINDS as string[]).includes(value);
}
