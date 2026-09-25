import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BarChart3, LineChart, Lock, type LucideIcon } from 'lucide-react';

import { reportBuilderApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import {
  REPORT_CATALOG,
  REPORT_GROUP_LABELS,
  type ReportDefinition,
  type ReportGroup,
} from '../../../../shared/reports/catalog';
import { UserRole } from '../../types';
import PageHeader from '../../components/PageHeader';
import EmptyState from '../../components/EmptyState';
import { ErrorRow } from '../../components/dashboard/shared';
import { REPORT_ICONS } from '../../components/reports/reportIcons';
import { Card } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { SkeletonCard } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing, toneChip } from '../../ui/tokens';

const GROUP_ORDER: ReportGroup[] = ['summary', 'money', 'people', 'stock'];

interface ReportCardProps {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
  meta?: string[];
  /** Недоступен текущему пользователю — карточка серая, причина под описанием. */
  reason?: string | null;
}

function ReportCard({ to, icon: Icon, title, description, meta = [], reason }: ReportCardProps) {
  const available = !reason;
  const inner = (
    <>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
            available ? toneChip.accent : toneChip.neutral,
          )}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-md font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm leading-snug text-ink-3">{description}</p>
        </div>
        {available && (
          <ArrowRight
            className="mt-2 h-4 w-4 flex-shrink-0 text-ink-4 transition-transform duration-150 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        )}
      </div>
      {(meta.length > 0 || reason) && (
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {meta.map((m) => (
            <Badge key={m} outline>
              {m}
            </Badge>
          ))}
          {reason && (
            <span className="inline-flex items-center gap-1 text-xs text-warn-text">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              {reason}
            </span>
          )}
        </div>
      )}
    </>
  );

  if (!available) {
    return (
      <Card as="article" padding="none" className="flex h-full flex-col gap-3 p-5 opacity-70" aria-disabled="true">
        {inner}
      </Card>
    );
  }
  return (
    <Card as="article" padding="none" interactive className="group h-full">
      <Link to={to} className={cn('flex h-full flex-col gap-3 rounded-xl p-5', focusRing)}>
        {inner}
      </Link>
    </Card>
  );
}

function cardMeta(def: ReportDefinition): string[] {
  const meta: string[] = [];
  if (def.entityFilter) meta.push(`Фильтр: ${def.entityFilter.label.toLowerCase()}`);
  if (def.groupByOptions && def.groupByOptions.length > 0) {
    meta.push(def.groupByOptions.map((o) => o.label.toLowerCase()).join(' / '));
  }
  if (def.requiresMultiPoint) meta.push('Несколько филиалов');
  return meta;
}

/**
 * Хаб «Отчёты»: карточки конструктора из shared/reports/catalog.ts по группам,
 * доступность — по ответу сервера (права, филиалы). Прежний финансовый отчёт —
 * отдельной карточкой в «Сводных», ничего не теряем.
 */
export default function ReportsHubPage() {
  const { user, hasPermission } = useAuth();
  const isOwnerClass = user?.role === UserRole.DIRECTOR || user?.role === UserRole.SUPERADMIN;
  const canFinancial = hasPermission('financial_reports');

  const catalog = useQuery({
    queryKey: ['report-catalog'],
    queryFn: async () => (await reportBuilderApi.catalog()).data,
    staleTime: 5 * 60_000,
  });

  const availability = useMemo(() => {
    const map = new Map<string, { available: boolean; reason?: string | null }>();
    for (const r of catalog.data?.reports ?? []) map.set(r.id, { available: r.available, reason: r.reason });
    return map;
  }, [catalog.data]);

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        label: REPORT_GROUP_LABELS[group],
        reports: REPORT_CATALOG.filter((def) => def.group === group).filter((def) => {
          const a = availability.get(def.id);
          if (!a) return false;
          // Недоступные показываем серым только владельцу: ему полезно знать, что
          // отчёт есть и чего не хватает. Остальным — лишний шум.
          return a.available || isOwnerClass;
        }),
      })).filter((g) => g.reports.length > 0 || (g.group === 'summary' && canFinancial)),
    [availability, isOwnerClass, canFinancial],
  );

  const availableCount = Array.from(availability.values()).filter((a) => a.available).length;
  const nothing = catalog.isSuccess && availableCount === 0 && !canFinancial;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Отчёты"
        icon={BarChart3}
        subtitle="Выберите отчёт, задайте период и фильтры — результат можно скачать в Excel или PDF"
      />

      {catalog.isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      )}

      {catalog.isError && (
        <ErrorRow
          message="Не удалось загрузить список отчётов"
          onRetry={() => catalog.refetch()}
          loading={catalog.isFetching}
        />
      )}

      {nothing && (
        <Card>
          <EmptyState
            icon={Lock}
            title="Доступ к отчётам ограничен"
            description="Раздел открывается с правом «Финансовые отчёты» или с правами на отдельные разделы: зарплата, склад, поставщики, клиенты, записи. Обратитесь к владельцу."
          />
        </Card>
      )}

      {(catalog.isSuccess || catalog.isError) &&
        !nothing &&
        groups.map(({ group, label, reports }) => (
          <section key={group} aria-labelledby={`reports-group-${group}`} className="space-y-3">
            <h2 id={`reports-group-${group}`} className="text-sm font-semibold text-ink">
              {label}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group === 'summary' && canFinancial && (
                <ReportCard
                  to="/reports/financial"
                  icon={LineChart}
                  title="Финансовый отчёт — подробно"
                  description="Чистая прибыль и маржа, расходы, брак и списания, отчёт по меткам — привычный отчёт за месяц."
                  meta={['Месяц или период']}
                />
              )}
              {reports.map((def) => {
                const a = availability.get(def.id);
                return (
                  <ReportCard
                    key={def.id}
                    to={`/reports/${def.id}`}
                    icon={REPORT_ICONS[def.id]}
                    title={def.title}
                    description={def.description}
                    meta={cardMeta(def)}
                    reason={a && !a.available ? (a.reason ?? 'Недоступен') : null}
                  />
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
