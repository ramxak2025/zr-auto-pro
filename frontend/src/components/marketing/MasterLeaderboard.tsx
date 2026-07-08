import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Medal, Star, Trophy } from 'lucide-react';

import { marketingApi } from '../../api/services';
import type { ReviewResponse } from '../../types';
import { LoadingBlock, Stars } from './marketingKit';

// Read-only leaderboard shown to master-role users. Podium styling for the
// top 3, plain rows below. Derived entirely from the month's review feed —
// no client names or comments are exposed here (that stays owner-only).
export default function MasterLeaderboard() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['marketing', 'reviews', month],
    queryFn: () => marketingApi.getReviews({ month }).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-');
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
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

  const placeColors = ['from-amber-400 to-yellow-500', 'from-gray-300 to-gray-400', 'from-amber-600 to-orange-500'];
  const placeBg = [
    'bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200',
    'bg-gradient-to-br from-gray-50 to-slate-50 border-gray-200',
    'bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200',
  ];

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mb-1 inline-flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          <h1 className="text-xl font-bold text-gray-900">Рейтинг мастеров</h1>
        </div>
        <p className="text-sm text-gray-500">Оценки клиентов по месяцам</p>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => shiftMonth(-1)}
          className="press-soft rounded-xl p-2 text-gray-500 hover:bg-gray-100"
          aria-label="Предыдущий месяц"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-[160px] rounded-xl border border-gray-200 bg-white px-5 py-2 text-center shadow-sm">
          <span className="text-sm font-semibold capitalize text-gray-900">{monthLabel}</span>
        </div>
        <button
          onClick={() => shiftMonth(1)}
          className="press-soft rounded-xl p-2 text-gray-500 hover:bg-gray-100"
          aria-label="Следующий месяц"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {isLoading ? (
        <LoadingBlock className="py-16" />
      ) : ranking.length === 0 ? (
        <div className="py-16 text-center">
          <Star className="mx-auto mb-3 h-12 w-12 text-gray-200" />
          <p className="text-sm font-medium text-gray-500">Нет отзывов за этот месяц</p>
          <p className="mt-1 text-xs text-gray-400">Рейтинг появится после получения отзывов от клиентов</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ranking.map((m, idx) => {
            const place = idx + 1;
            const isTop3 = place <= 3;
            return (
              <div
                key={m.id}
                className={`rounded-2xl border p-4 transition-all ${isTop3 ? placeBg[idx] : 'border-gray-100 bg-white'} ${place === 1 ? 'shadow-md' : 'shadow-sm'}`}
              >
                <div className="flex items-center gap-3">
                  {isTop3 ? (
                    <div
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${placeColors[idx]} text-sm font-bold text-white shadow-sm`}
                    >
                      {place === 1 ? (
                        <Trophy className="h-5 w-5" />
                      ) : place === 2 ? (
                        <Medal className="h-5 w-5" />
                      ) : (
                        place
                      )}
                    </div>
                  ) : (
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold text-gray-500">
                      {place}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate font-semibold ${place === 1 ? 'text-base text-gray-900' : 'text-sm text-gray-800'}`}
                    >
                      {m.name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Stars rating={Math.round(m.avg)} size={place === 1 ? 'md' : 'sm'} />
                      <span
                        className={`text-xs font-bold tabular-nums ${m.avg >= 4 ? 'text-green-600' : m.avg >= 3 ? 'text-amber-600' : 'text-red-600'}`}
                      >
                        {m.avg.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p
                      className={`font-bold tabular-nums ${place === 1 ? 'text-lg text-gray-900' : 'text-base text-gray-700'}`}
                    >
                      {m.count}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">
                      отзыв{m.count === 1 ? '' : m.count < 5 ? 'а' : 'ов'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
