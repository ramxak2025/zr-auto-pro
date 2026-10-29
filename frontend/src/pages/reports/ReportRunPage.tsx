import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, FileQuestion, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

import { reportBuilderApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCalendar } from '../../hooks/useTenantTimezone';
import { getReportDefinition, isReportId } from '../../../../shared/reports/catalog';
import { apiErrorMessage, apiErrorStatus } from '../../../../shared/utils/apiError';
import type { ReportFilterKind, ReportResult } from '../../types';
import PageHeader from '../../components/PageHeader';
import DatePeriodPicker from '../../components/DatePeriodPicker';
import EmptyState from '../../components/EmptyState';
import { ErrorRow } from '../../components/dashboard/shared';
import MonthPager from '../../components/reports/MonthPager';
import EntityFilter, { SelectedChips } from '../../components/reports/EntityFilter';
import ReportKpiGrid, { ReportKpiSkeleton } from '../../components/reports/ReportKpiGrid';
import ReportTable, { ReportSectionCard } from '../../components/reports/ReportTable';
import { ReportCaption, ReportMethod } from '../../components/reports/ReportMethod';
import { REPORT_ICONS } from '../../components/reports/reportIcons';
import { pluralRows } from '../../components/reports/reportFormat';
import { patchParams, readList, readPeriod } from '../../components/reports/periodParams';
import { exportReportToExcel, exportReportToPdf } from '../../utils/reportExport';
import { Button, buttonClasses } from '../../ui/Button';
import { Toolbar } from '../../ui/Toolbar';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Card, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { SkeletonText } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';

type ExportKind = 'excel' | 'pdf';

/** Ошибка сервера словами сервера: 400 (период), 403 (права) — без «Повторить». */
function ReportError({ error, onRetry, loading }: { error: unknown; onRetry: () => void; loading: boolean }) {
  const status = apiErrorStatus(error);
  const message = apiErrorMessage(error) ?? 'Не удалось сформировать отчёт. Проверьте соединение и попробуйте снова.';
  const retryable = status === null || status >= 500;
  return <ErrorRow message={message} onRetry={retryable ? onRetry : undefined} loading={loading} />;
}

function ReportSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Формируем отчёт…">
      <ReportKpiSkeleton />
      <Card padding="md">
        <SkeletonText lines={8} />
      </Card>
    </div>
  );
}

/**
 * Универсальный экран отчёта: период (месяц целиком / пресеты / произвольный),
 * сущностный фильтр, группировка — всё в URL; результат сервера рендерится
 * одним кодом для всех 11 отчётов (KPI → таблица с итого → секции → методика).
 * Смена периода/фильтра перезапрашивает отчёт сама; «Сформировать» — явный
 * повторный запуск; Excel/PDF — из того же результата.
 */
export default function ReportRunPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const def = isReportId(reportId) ? getReportDefinition(reportId) : null;
  const [params, setParams] = useSearchParams();
  const { today, monthStart, timeZone } = useTenantCalendar();
  const { user } = useAuth();
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  const period = readPeriod(params, { from: monthStart, to: today });
  const periodInvalid = period.from > period.to;
  const filterKind: ReportFilterKind | null = def?.entityFilter?.kind ?? null;
  const ids = filterKind ? readList(params, 'ids') : [];
  const groupByOptions = def?.groupByOptions ?? [];
  const groupByParam = params.get('groupBy');
  const groupBy =
    groupByOptions.length > 0
      ? groupByOptions.some((o) => o.value === groupByParam)
        ? (groupByParam as string)
        : groupByOptions[0].value
      : null;

  const update = (patch: Record<string, string | null | undefined>) =>
    setParams(patchParams(params, patch), { replace: true });

  const filterQuery = useQuery({
    queryKey: ['report-filter-options', filterKind],
    queryFn: async () => (await reportBuilderApi.filterOptions(filterKind as ReportFilterKind)).data,
    enabled: filterKind !== null,
    staleTime: 5 * 60_000,
  });
  // Сущностный фильтр не показываем, когда выбирать не из чего: справочник вернул
  // ≤ 1 опции (сотруднику с охватом «только своя зарплата» сервер отдаёт в
  // filters/employees только его самого). Вместе с фильтром прячем чипы и подписи
  // фильтра в экспорте, а `ids` из ссылки не применяем — скрытый фильтр не должен
  // молча резать отчёт.
  const filterHidden = !!filterKind && !!filterQuery.data && filterQuery.data.options.length <= 1;
  const effectiveIds = filterHidden ? [] : ids;

  const idsKey = effectiveIds.join(',');
  const report = useQuery<ReportResult>({
    queryKey: ['report-builder', def?.id ?? null, period.from, period.to, idsKey, groupBy ?? ''],
    queryFn: async () => {
      if (!def) throw new Error('Отчёт не найден');
      const res = await reportBuilderApi.run(def.id, {
        dateFrom: period.from,
        dateTo: period.to,
        ids: effectiveIds,
        groupBy,
      });
      return res.data;
    },
    enabled: def !== null && !periodInvalid,
    staleTime: 30_000,
    // 400/403 — ответ окончательный, повторять бессмысленно; сетевой сбой — один повтор.
    retry: (count, err) => apiErrorStatus(err) === null && count < 1,
    // Прежнюю таблицу держим на экране (без мигания) только внутри ОДНОГО
    // отчёта: чужие цифры под новым заголовком показывать нельзя.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === def?.id ? prev : undefined),
  });

  const runExport = async (kind: ExportKind) => {
    if (!report.data || exporting) return;
    setExporting(kind);
    try {
      const ctx = { companyName: user?.tenant?.name, timeZone };
      // Фильтр скрыт (выбирать не из чего) — его подписи в шапке файла не нужны.
      const result: ReportResult = filterHidden
        ? { ...report.data, filters: { ...report.data.filters, entityLabels: [] } }
        : report.data;
      if (kind === 'excel') await exportReportToExcel(result, ctx);
      else await exportReportToPdf(result, ctx);
    } catch (err) {
      console.error(err);
      toast.error(kind === 'excel' ? 'Не удалось сформировать Excel' : 'Не удалось сформировать PDF');
    } finally {
      setExporting(null);
    }
  };

  if (!def) {
    return (
      <div className="space-y-5">
        <PageHeader title="Отчёт не найден" icon={BarChart3} backTo="/reports" />
        <Card>
          <EmptyState
            icon={FileQuestion}
            title="Такого отчёта нет"
            description="Проверьте ссылку или выберите отчёт из списка."
          />
          <div className="flex justify-center pb-6">
            <Link to="/reports" className={buttonClasses({ variant: 'secondary' })}>
              К списку отчётов
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const Icon = REPORT_ICONS[def.id];
  const data = report.data;
  const sections = data?.sections ?? [];
  const twoColumnSections = sections.length >= 2 && sections.every((s) => s.columns.length <= 5);
  const emptyResult =
    !!data &&
    data.rows.length === 0 &&
    sections.every((s) => s.rows.length === 0) &&
    data.kpis.every((k) => k.value === null || k.value === 0 || k.value === '');
  const busy = report.isFetching && report.isPlaceholderData;

  return (
    <div className="space-y-5">
      <PageHeader
        title={def.title}
        icon={Icon}
        subtitle={def.description}
        backTo="/reports"
        actions={
          <>
            <Button
              variant="secondary"
              icon={FileSpreadsheet}
              onClick={() => runExport('excel')}
              loading={exporting === 'excel'}
              disabled={!data || exporting !== null}
            >
              Excel
            </Button>
            <Button
              variant="secondary"
              icon={FileText}
              onClick={() => runExport('pdf')}
              loading={exporting === 'pdf'}
              disabled={!data || exporting !== null}
            >
              PDF
            </Button>
          </>
        }
      />

      <Toolbar
        end={
          <Button
            icon={RefreshCw}
            onClick={() => report.refetch()}
            loading={report.isFetching && !report.isPlaceholderData}
            disabled={periodInvalid}
          >
            Сформировать
          </Button>
        }
      >
        <MonthPager from={period.from} to={period.to} todayKey={today} onChange={(from, to) => update({ from, to })} />
        <DatePeriodPicker dateFrom={period.from} dateTo={period.to} onChange={(from, to) => update({ from, to })} />
        {def.entityFilter && !filterHidden && (
          <EntityFilter
            label={def.entityFilter.label}
            options={filterQuery.data?.options}
            selected={ids}
            onChange={(list) => update({ ids: list.join(',') })}
            isLoading={filterQuery.isLoading}
            isError={filterQuery.isError}
            isFetching={filterQuery.isFetching}
            onRetry={() => filterQuery.refetch()}
          />
        )}
        {groupBy && (
          <SegmentedControl
            aria-label="Группировка"
            options={groupByOptions.map((o) => ({ value: o.value, label: o.label }))}
            value={groupBy}
            onChange={(v) => update({ groupBy: v })}
          />
        )}
      </Toolbar>

      {def.entityFilter && filterQuery.isError && !filterQuery.data && (
        <ErrorRow
          message={`Не удалось загрузить список «${def.entityFilter.label}» — фильтр недоступен, отчёт показан без него.`}
          onRetry={() => filterQuery.refetch()}
          loading={filterQuery.isFetching}
        />
      )}

      {def.entityFilter && !filterHidden && (
        <SelectedChips
          label={def.entityFilter.label}
          options={filterQuery.data?.options}
          selected={ids}
          onChange={(list) => update({ ids: list.join(',') })}
        />
      )}

      {periodInvalid ? (
        <ErrorRow message="Дата начала позже даты окончания — поправьте период." />
      ) : report.isError ? (
        <ReportError error={report.error} onRetry={() => report.refetch()} loading={report.isFetching} />
      ) : report.isLoading && !data ? (
        <ReportSkeleton />
      ) : data ? (
        <div
          className={cn('space-y-5 transition-opacity duration-150', busy && 'opacity-60')}
          aria-busy={busy || undefined}
        >
          {emptyResult ? (
            <Card>
              <EmptyState
                icon={Icon}
                title="За период нет данных"
                description="Попробуйте другой период или снимите фильтры."
              />
            </Card>
          ) : (
            <>
              <ReportKpiGrid kpis={data.kpis} timeZone={timeZone} />

              <Card padding="none" className="overflow-hidden">
                <CardHeader
                  title="Детализация"
                  subtitle={
                    data.rows.length > 0
                      ? `${pluralRows(data.rows.length)}${data.filters.groupByLabel ? ` · ${data.filters.groupByLabel.toLowerCase()}` : ''}`
                      : undefined
                  }
                  divider={data.rows.length === 0}
                  actions={
                    data.meta?.truncated ? (
                      <Badge tone="warn">Первые {data.meta.rowLimit ?? data.rows.length}</Badge>
                    ) : undefined
                  }
                />
                <ReportTable
                  columns={data.columns}
                  rows={data.rows}
                  totals={data.totals}
                  timeZone={timeZone}
                  caption={`${def.title}: детализация`}
                  emptyText="За период нет данных"
                  bare
                  className="overflow-x-auto"
                />
              </Card>

              {sections.length > 0 && (
                <div className={cn('grid grid-cols-1 gap-5', twoColumnSections && 'xl:grid-cols-2 xl:items-start')}>
                  {sections.map((section) => (
                    <ReportSectionCard key={section.key} section={section} timeZone={timeZone} />
                  ))}
                </div>
              )}
            </>
          )}

          <ReportMethod method={def.method} notes={data.notes} />
          <ReportCaption result={data} timeZone={timeZone} />
        </div>
      ) : null}
    </div>
  );
}
