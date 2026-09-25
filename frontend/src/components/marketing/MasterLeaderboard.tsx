import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Star, Trophy } from 'lucide-react';

import { marketingApi } from '../../api/services';
import type { ReviewResponse } from '../../types';
import PageHeader from '../PageHeader';
import { Card } from '../../ui/Card';
import { IconButton } from '../../ui/IconButton';
import { Toolbar, ToolbarGroup } from '../../ui/Toolbar';
import { cn } from '../../ui/cn';
import { toneChip, toneText } from '../../ui/tokens';
import { EmptyState, LoadingBlock, SectionError, Stars, plural } from './marketingKit';

/** Тон средней оценки по смыслу: ≥ 4 — хорошо, 3–4 — внимание, < 3 — плохо. */
export function ratingTone(avg: number): 'ok' | 'warn' | 'bad' {
  if (avg >= 4) return 'ok';
  if (avg >= 3) return 'warn';
  return 'bad';
}

// Read-only leaderboard shown to master-role users. Derived entirely from the
// month's review feed — no client names or comments are exposed here (that
// stays owner-only).
export default function MasterLeaderboard() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const {
    data: reviews = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['marketing', 'reviews', month],
    queryFn: () => marketingApi.getReviews({ month }).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-');
    const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [month]);

  const shiftMonth = (dir: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const ranking = useMemo(() => {
    const map: Record<string, { name: string; total: number; sum: number }> = {};
    reviews.forEach((r: ReviewResponse) => {
      if (!r.employeeId || !r.employeeName) return;
      if (!map[r.employeeId]) map[r.employeeId] = { name: r.employeeName, total: 0, sum: 0 };
      map[r.employeeId].total++;
      map[r.employeeId].sum += r.rating;
    });
    return Object.entries(map)
      .map(([id, s]) => ({ id, name: s.name, count: s.total, avg: Math.round((s.sum / s.total) * 10) / 10 }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count);
  }, [reviews]);

  return (
    <div className="space-y-5">
      <PageHeader title="Рейтинг мастеров" icon={Trophy} subtitle="Оценки клиентов по месяцам" />

      <Toolbar>
        <ToolbarGroup>
          <IconButton label="Предыдущий месяц" icon={ChevronLeft} variant="secondary" onClick={() => shiftMonth(-1)} />
          <span className="min-w-[10rem] text-center text-sm font-semibold text-ink" aria-live="polite">
            {monthLabel}
          </span>
          <IconButton label="Следующий месяц" icon={ChevronRight} variant="secondary" onClick={() => shiftMonth(1)} />
        </ToolbarGroup>
      </Toolbar>

      <Card padding="none">
        {isLoading ? (
          <LoadingBlock className="px-4" lines={4} />
        ) : isError ? (
          <div className="p-4">
            <SectionError message="Не удалось загрузить рейтинг" onRetry={() => refetch()} loading={isFetching} />
          </div>
        ) : ranking.length === 0 ? (
          <EmptyState
            icon={Star}
            title="Нет отзывов за этот месяц"
            hint="Рейтинг появится после получения оценок от клиентов"
          />
        ) : (
          <ol className="divide-y divide-line">
            {ranking.map((m, idx) => {
              const place = idx + 1;
              const isTop3 = place <= 3;
              const tone = ratingTone(m.avg);
              return (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={cn(
                      'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums',
                      isTop3 ? toneChip.accent : toneChip.neutral,
                    )}
                    aria-label={`${place} место`}
                  >
                    {place === 1 ? <Trophy className="h-4 w-4" aria-hidden="true" /> : place}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate font-semibold text-ink', place === 1 ? 'text-base' : 'text-sm')}>
                      {m.name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Stars rating={Math.round(m.avg)} label={`Средняя оценка ${m.avg}`} />
                      <span className={cn('text-xs font-semibold tabular-nums', toneText[tone])}>
                        {m.avg.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-base font-semibold tabular-nums text-ink">{m.count}</p>
                    <p className="text-2xs text-ink-3">{plural(m.count, ['отзыв', 'отзыва', 'отзывов'])}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
