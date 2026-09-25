import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ReportDefinition } from './catalog';
import { ReportAppliedFilters, ReportColumn, ReportId, ReportKpi, ReportRow, ReportSection } from './report-types';

/** Лимиты строк по спеке: основная таблица ≤ 500, секции ≤ 100. */
export const MAIN_ROW_LIMIT = 500;
export const SECTION_ROW_LIMIT = 100;

/**
 * Контекст одного запуска отчёта — всё, что билдеру нужно знать о «где и за
 * что» считать. Собирается диспетчером (ReportBuilderService) ОДИН раз: пояс
 * тенанта, филиал сессии, отвалидированный период, выбранные сущности.
 */
export interface ReportContext {
  tenantId: string;
  /**
   * Филиал СЕССИИ (actorPointId) — null только у тенанта без филиалов.
   * Отчёт 'points' его сознательно не использует (сравнение всех точек).
   */
  pointId: string | null;
  /** IANA-пояс тенанта (getTenantTimezone). */
  tz: string;
  actor: JwtPayload;
  companyName: string;
  pointName: string | null;
  /** Период, 'YYYY-MM-DD' включительно с обеих сторон, dateFrom ≤ dateTo. */
  dateFrom: string;
  dateTo: string;
  /** Длина периода в днях (dateTo − dateFrom + 1). */
  days: number;
  /**
   * «Сегодня» в поясе тенанта, 'YYYY-MM-DD', обрезанное сверху по dateTo:
   * опорная дата для «дней без продаж / без визитов». Для текущего периода —
   * сегодня, для закрытого прошлого — его последний день (отчёт воспроизводим).
   */
  refDate: string;
  /** Выбранные сущности фильтра (uuid), пусто = все. */
  ids: string[];
  /** Выбранная группировка (валидирована по каталогу) либо null. */
  groupBy: string | null;
  def: ReportDefinition;
}

/** Результат билдера — диспетчер дополняет его шапкой, периодом и meta. */
export interface BuiltReport {
  kpis: ReportKpi[];
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow | null;
  sections?: ReportSection[];
  notes?: string[];
  /** Основная таблица усечена лимитом MAIN_ROW_LIMIT. */
  truncated?: boolean;
  filters?: Partial<ReportAppliedFilters>;
}

export interface ReportBuilder {
  readonly id: ReportId;
  build(ctx: ReportContext): Promise<BuiltReport>;
}
