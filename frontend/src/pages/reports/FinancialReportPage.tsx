import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Coins,
  LineChart,
  Lock,
  Package,
  PackageMinus,
  Receipt,
  Recycle,
  ShieldAlert,
  Sparkles,
  Tag,
  TrendingUp,
  Undo2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { reportsApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { formatMoney } from '../../../../shared/utils/formatters';
import { useTenantCalendar } from '../../hooks/useTenantTimezone';
import type { FinancialReport } from '../../types';
import DatePeriodPicker from '../../components/DatePeriodPicker';
import PageHeader from '../../components/PageHeader';
import QueryState from '../../components/QueryState';
import EmptyState from '../../components/EmptyState';
import { ErrorRow, MiniStat } from '../../components/dashboard/shared';
import MonthPager from '../../components/reports/MonthPager';
import { monthOfDay, monthRange, patchParams, readPeriod } from '../../components/reports/periodParams';
import { Card, CardHeader } from '../../ui/Card';
import { StatCard } from '../../ui/StatCard';
import { DataTable } from '../../ui/DataTable';
import { Money } from '../../ui/Money';
import { Toolbar } from '../../ui/Toolbar';
import { SkeletonCard } from '../../ui/Skeleton';
import { toneChip } from '../../ui/tokens';

const percentFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** «12,5% от выручки» — или null, когда выручки нет (делить не на что). */
function shareOfRevenue(value: number, revenue: number): string | null {
  if (revenue <= 0) return null;
  return `${percentFormat.format((value / revenue) * 100)}% от выручки`;
}

function ExpenseRow({
  icon: Icon,
  label,
  hint,
  value,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string | null;
  value: number;
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${toneChip.neutral}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{label}</p>
          {hint && <p className="text-xs text-ink-3">{hint}</p>}
        </div>
      </div>
      <Money value={value} className="text-sm font-semibold text-ink" />
    </li>
  );
}

type TagRow = {
  tagId: string;
  name: string;
  color: string | null;
  checksCount: number;
  revenue: number;
  profit: number;
};

/**
 * Финансовый отчёт — подробно (прежняя страница «Отчёты», теперь
 * /reports/financial). Запросы и ключи не менялись; каждый из трёх блоков
 * (отчёт, брак и списания, метки) показывает свою ошибку с «Повторить», а не
 * исчезает молча (аудит P0). Период — в URL; месяц целиком — основной
 * сценарий: расход «за месяц» сервер включает только при полном месяце.
 */
export default function FinancialReportPage() {
  const { hasPermission } = useAuth();
  const { today } = useTenantCalendar();
  const [params, setParams] = useSearchParams();
  const defaultPeriod = useMemo(() => monthRange(monthOfDay(today)), [today]);
  const period = readPeriod(params, defaultPeriod);
  const dateFrom = period.from;
  const dateTo = period.to;
  const setPeriod = (from: string, to: string) => setParams(patchParams(params, { from, to }), { replace: true });

  const canView = hasPermission('financial_reports');

  const reportQuery = useQuery({
    queryKey: ['financial-report', dateFrom, dateTo],
    queryFn: () => reportsApi.getFinancial({ dateFrom, dateTo }),
    select: (res) => res.data as FinancialReport,
    enabled: canView,
  });

  // Брак + списания + возвраты поставщику за период.
  const defectQuery = useQuery({
    queryKey: ['defect-writeoff-report', dateFrom, dateTo],
    queryFn: () => reportsApi.defectWriteoff({ from: dateFrom, to: dateTo }),
    select: (res) => res.data,
    enabled: canView,
  });

  // Метки чеков (Round 12 #9): выручка/прибыль/чеки по каждой метке за период.
  const tagsQuery = useQuery({
    queryKey: ['tag-analytics', dateFrom, dateTo],
    queryFn: () => reportsApi.getTagAnalytics({ dateFrom, dateTo }),
    select: (res) => res.data as TagRow[],
    enabled: canView,
  });

  if (!canView) {
    return (
      <div className="space-y-5">
        <PageHeader title="Финансовый отчёт" icon={LineChart} backTo="/reports" />
        <Card>
          <EmptyState
            icon={Lock}
            title="Доступ ограничен"
            description="Финансовый отчёт открывается с правом «Финансовые отчёты». Обратитесь к владельцу."
          />
        </Card>
      </div>
    );
  }

  const report = reportQuery.data;
  const other = report ? ((report as FinancialReport & { otherExpenses?: number }).otherExpenses ?? 0) : 0;
  const marginPct = report && report.revenue > 0 ? (report.netProfit / report.revenue) * 100 : null;
  const tagRows = tagsQuery.data ?? [];
  const showTags = tagsQuery.isLoading || tagsQuery.isError || tagRows.length > 0;
  const defect = defectQuery.data;

  let defectBody: ReactNode = null;
  if (defectQuery.isLoading) defectBody = <SkeletonCard lines={3} />;
  else if (defectQuery.isError)
    defectBody = (
      <Card padding="none">
        <CardHeader icon={AlertTriangle} iconTone="warn" title="Брак и списания" />
        <div className="p-4">
          <ErrorRow
            message="Не удалось загрузить брак и списания"
            onRetry={() => defectQuery.refetch()}
            loading={defectQuery.isFetching}
          />
        </div>
      </Card>
    );
  else if (defect)
    defectBody = (
      <Card padding="none">
        <CardHeader
          icon={AlertTriangle}
          iconTone="warn"
          title="Брак и списания"
          subtitle="По себестоимости, за период"
        />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5">
          <div className="flex items-start gap-3">
            <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${toneChip.neutral}`}>
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <MiniStat label="В браке" value={formatMoney(defect.defectValue)} hint={`${defect.defectQty} шт`} />
          </div>
          <div className="flex items-start gap-3">
            <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${toneChip.neutral}`}>
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <MiniStat
              label="Возврат поставщику"
              value={formatMoney(defect.returnedToSupplierValue)}
              hint={`${defect.returnedToSupplierQty} шт`}
            />
          </div>
          <div className="flex items-start gap-3">
            <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${toneChip.neutral}`}>
              <PackageMinus className="h-4 w-4" aria-hidden="true" />
            </span>
            <MiniStat
              label="Списано как расход"
              value={formatMoney(defect.writeoffExpensedValue)}
              hint={`${defect.writeoffExpensedQty} шт`}
            />
          </div>
          <div className="flex items-start gap-3">
            <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${toneChip.neutral}`}>
              <Recycle className="h-4 w-4" aria-hidden="true" />
            </span>
            <MiniStat
              label="Списано без расхода"
              value={formatMoney(defect.writeoffValue - defect.writeoffExpensedValue)}
              hint={`${defect.writeoffQty - defect.writeoffExpensedQty} шт`}
            />
          </div>
        </dl>
      </Card>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Финансовый отчёт"
        icon={LineChart}
        subtitle="Прибыль, расходы, брак и списания, метки — за месяц или период"
        backTo="/reports"
      />

      <Toolbar>
        <MonthPager from={dateFrom} to={dateTo} todayKey={today} onChange={setPeriod} />
        <DatePeriodPicker dateFrom={dateFrom} dateTo={dateTo} onChange={setPeriod} />
      </Toolbar>

      <QueryState
        isLoading={reportQuery.isLoading}
        isError={reportQuery.isError}
        onRetry={reportQuery.refetch}
        isFetching={reportQuery.isFetching}
        errorTitle="Не удалось загрузить финансовый отчёт"
        loader={
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonCard key={i} lines={1} />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <SkeletonCard lines={4} />
              <SkeletonCard lines={4} />
            </div>
          </div>
        }
        minHeight="min-h-[40vh]"
      >
        {report && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard
                label="Чистая прибыль"
                value={<Money value={report.netProfit} colorize />}
                hint={marginPct !== null ? `Маржа ${percentFormat.format(marginPct)}%` : 'Выручки за период нет'}
                icon={TrendingUp}
                tone={report.netProfit >= 0 ? 'ok' : 'bad'}
              />
              <StatCard label="Выручка" value={formatMoney(report.revenue)} icon={Wallet} />
              <StatCard label="Валовая прибыль" value={formatMoney(report.grossProfit)} icon={Coins} />
              <StatCard
                label="Чеков"
                value={report.checkCount}
                hint={
                  report.checkCount > 0 && report.revenue > 0
                    ? `Средний чек: ${formatMoney(report.revenue / report.checkCount)}`
                    : undefined
                }
                icon={Receipt}
              />
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
              <Card padding="none">
                <CardHeader icon={Wallet} iconTone="neutral" title="Расходы" subtitle="Уже вычтены из чистой прибыли" />
                <ul className="divide-y divide-line">
                  <ExpenseRow
                    icon={Package}
                    label="Себестоимость товаров"
                    hint={shareOfRevenue(report.productCost, report.revenue)}
                    value={report.productCost}
                  />
                  <ExpenseRow
                    icon={Users}
                    label="Зарплаты мастерам"
                    hint={shareOfRevenue(report.salaries, report.revenue)}
                    value={report.salaries}
                  />
                  {(report.premiums ?? 0) > 0 && (
                    <ExpenseRow
                      icon={Coins}
                      label="Премии деньгами"
                      hint="Начислены сотрудникам за период"
                      value={report.premiums ?? 0}
                    />
                  )}
                  {(report.motivation ?? 0) > 0 && (
                    <ExpenseRow
                      icon={Sparkles}
                      label="Мотивация"
                      hint="Бонусы мастеров за акционные товары"
                      value={report.motivation ?? 0}
                    />
                  )}
                  {(report.warrantyLoss ?? 0) > 0 && (
                    <ExpenseRow
                      icon={ShieldAlert}
                      label="Убыток по гарантии"
                      hint="Запчасти + оплата мастеру по гарантийным работам"
                      value={report.warrantyLoss ?? 0}
                    />
                  )}
                  {other > 0 && (
                    <ExpenseRow
                      icon={Wallet}
                      label="Прочие расходы"
                      hint={shareOfRevenue(other, report.revenue)}
                      value={other}
                    />
                  )}
                </ul>
              </Card>

              {defectBody}
            </div>

            {showTags && (
              <Card padding="none" className="overflow-hidden">
                <CardHeader
                  icon={Tag}
                  iconTone="neutral"
                  title="По меткам"
                  subtitle="Выручка и прибыль чеков с меткой за период"
                  divider={false}
                />
                <DataTable<TagRow>
                  rows={tagRows}
                  rowKey={(r) => r.tagId}
                  isLoading={tagsQuery.isLoading}
                  isError={tagsQuery.isError}
                  onRetry={() => tagsQuery.refetch()}
                  isFetching={tagsQuery.isFetching}
                  errorTitle="Не удалось загрузить отчёт по меткам"
                  caption="Выручка и прибыль по меткам чеков"
                  bare
                  className="overflow-x-auto"
                  columns={[
                    {
                      key: 'name',
                      header: 'Метка',
                      primary: true,
                      sortable: true,
                      render: (r) => (
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2 w-2 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: r.color || '#64748b' }}
                            aria-hidden="true"
                          />
                          {r.name}
                        </span>
                      ),
                      footer: 'Итого',
                    },
                    {
                      key: 'checksCount',
                      header: 'Чеков',
                      numeric: true,
                      sortable: true,
                      footer: (rows) => rows.reduce((s, r) => s + r.checksCount, 0),
                    },
                    {
                      key: 'revenue',
                      header: 'Выручка',
                      numeric: true,
                      sortable: true,
                      render: (r) => <Money value={r.revenue} />,
                      footer: (rows) => <Money value={rows.reduce((s, r) => s + r.revenue, 0)} />,
                    },
                    {
                      key: 'profit',
                      header: 'Прибыль',
                      numeric: true,
                      sortable: true,
                      render: (r) => <Money value={r.profit} colorize className="font-medium" />,
                      footer: (rows) => <Money value={rows.reduce((s, r) => s + r.profit, 0)} colorize />,
                    },
                  ]}
                />
              </Card>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}
