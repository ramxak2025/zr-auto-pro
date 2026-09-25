import type { ReportKpi } from '../../types';
import { StatCard } from '../../ui/StatCard';
import { SkeletonCard } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { toneText } from '../../ui/tokens';
import { formatKpiValue, toneToUi } from './reportFormat';

interface ReportKpiGridProps {
  kpis: ReportKpi[];
  timeZone?: string | null;
  className?: string;
}

/**
 * Полоса KPI отчёта. Тон — только тот, что прислал сервер (по умолчанию
 * нейтральный: шесть плиток не должны превращаться в светофор). Дельта к
 * прошлому периоду — стрелкой, как на Главной.
 */
export default function ReportKpiGrid({ kpis, timeZone, className }: ReportKpiGridProps) {
  if (kpis.length === 0) return null;
  const many = kpis.length > 8;
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3', many ? 'xl:grid-cols-5' : 'xl:grid-cols-4', className)}>
      {kpis.map((kpi) => {
        const delta = typeof kpi.deltaPercent === 'number' && Number.isFinite(kpi.deltaPercent);
        const tone = toneToUi(kpi.tone);
        const text = formatKpiValue(kpi, timeZone);
        return (
          <StatCard
            key={kpi.key}
            compact
            label={kpi.title}
            // Тон сервера окрашивает само значение: у KPI нет иконки-чипа, где
            // StatCard показывает тон обычно.
            value={tone === 'neutral' ? text : <span className={toneText[tone]}>{text}</span>}
            tone={tone}
            hint={kpi.hint}
            delta={delta ? { value: kpi.deltaPercent as number, label: 'к прошлому периоду' } : undefined}
          />
        );
      })}
    </div>
  );
}

/** Скелет полосы KPI на первую загрузку. */
export function ReportKpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={1} />
      ))}
    </div>
  );
}
