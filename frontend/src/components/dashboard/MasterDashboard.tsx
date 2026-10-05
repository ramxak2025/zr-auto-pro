import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Gift,
  Package,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { salaryApi, scheduleApi, usersApi } from '../../api/services';
import type { SalarySummary } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCalendar } from '../../hooks/useTenantTimezone';
import { formatMoney } from '../../../../shared/utils/formatters';
import { attendanceScore, calculateAttendanceStats, emptyBreakdown } from '../../../../shared/utils/attendance';
import { Card, CardHeader } from '../../ui/Card';
import { StatCard } from '../../ui/StatCard';
import { SkeletonCard } from '../../ui/Skeleton';
import { Badge } from '../../ui/Badge';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { ErrorRow, MiniStat, initialsOf } from './shared';

/** Панель мастера: заработок сегодня/за месяц, касса, бонусы с товаров, рейтинг. */
export default function MasterDashboard() {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<SalarySummary>({
    queryKey: ['salary', 'my-summary'],
    queryFn: async () => {
      const res = await salaryApi.getMy();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorRow message="Не удалось загрузить данные по зарплате" onRetry={() => refetch()} loading={isFetching} />
    );
  }

  const promos = (data.productPromotions ?? []).filter((p) => p.percent > 0);

  return (
    <div className="space-y-4">
      {/* Профиль */}
      <Card padding="sm" className="flex items-center gap-4">
        <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-base font-bold text-accent-text">
          {initialsOf(user?.fullName ?? '', 'М')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-semibold text-ink">{user?.fullName || 'Мастер'}</p>
          <p className="text-sm text-ink-3">
            Услуги {data.salaryPercent}%{data.productSalaryPercent ? ` · Товары ${data.productSalaryPercent}%` : ''}
          </p>
        </div>
      </Card>

      {/* Сегодня */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          compact
          label="Заказов сегодня"
          value={data.todayChecks || '—'}
          hint={`За месяц: ${data.monthChecks ?? 0}`}
          icon={ClipboardList}
          tone="accent"
        />
        <StatCard
          compact
          label="Заработано сегодня"
          value={data.today ? formatMoney(data.today) : '—'}
          hint={`За месяц: ${formatMoney(data.month)}`}
          icon={TrendingUp}
          tone="ok"
        />
      </div>

      {/* Касса сегодня */}
      <Card padding="none">
        <CardHeader dense title="Касса сегодня" />
        <div className="grid grid-cols-3 divide-x divide-line">
          <div className="flex flex-col items-center gap-1 px-3 py-3 text-center">
            <Banknote className="h-4 w-4 text-ok" aria-hidden="true" />
            <MiniStat size="sm" align="center" label="Наличные" value={formatMoney(data.todayCash ?? 0)} />
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-3 text-center">
            <CreditCard className="h-4 w-4 text-accent" aria-hidden="true" />
            <MiniStat size="sm" align="center" label="Карта" value={formatMoney(data.todayCard ?? 0)} />
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-3 text-center">
            <ShieldAlert className="h-4 w-4 text-warn" aria-hidden="true" />
            <MiniStat
              size="sm"
              align="center"
              label="Гарантия · не в кассу"
              value={formatMoney(data.todayWarranty ?? 0)}
            />
          </div>
        </div>
      </Card>

      {/* Структура заработка */}
      {(data.todayService !== undefined || data.todayProduct !== undefined) &&
        (data.todayService || 0) + (data.todayProduct || 0) > 0 && (
          <Card padding="none">
            <CardHeader dense title="Структура заработка сегодня" />
            <div className="grid grid-cols-2 gap-3 p-4">
              <div className="rounded-lg bg-accent-soft p-3">
                <p className="text-xs font-medium text-accent-text">С услуг</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                  {formatMoney(data.todayService ?? 0)}
                </p>
              </div>
              <div className="rounded-lg bg-ok-soft p-3">
                <p className="text-xs font-medium text-ok-text">С товаров</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                  {formatMoney(data.todayProduct ?? 0)}
                </p>
              </div>
            </div>
          </Card>
        )}

      {/* Бонусы с товаров */}
      {promos.length > 0 && (
        <Card padding="none">
          <CardHeader
            dense
            icon={Gift}
            iconTone="ok"
            title="Бонус с товаров"
            subtitle="Продавайте эти товары и получайте % с прибыли"
          />
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {promos.map((promo) => (
              <li key={promo.productId} className="flex items-center gap-3 px-4 py-2.5">
                {promo.photo ? (
                  <img
                    src={promo.photo}
                    alt=""
                    width={40}
                    height={40}
                    loading="lazy"
                    className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3">
                    <Package className="h-5 w-5 text-ink-4" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{promo.productName}</p>
                  <p className="text-xs text-ink-3">Цена: {formatMoney(promo.sellPrice)}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-ok-text">
                    +{formatMoney(promo.estimatedBonus)}
                  </p>
                  <p className="text-2xs text-ink-3">{promo.percent}% с прибыли</p>
                </div>
              </li>
            ))}
          </ul>
          {data.productSalaryPercent && data.productSalaryPercent > 0 ? (
            <div className="rounded-b-xl border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
              Также <span className="font-semibold">{data.productSalaryPercent}%</span> со всех остальных товаров
            </div>
          ) : null}
        </Card>
      )}

      <MasterRankWidget userId={user?.id} />
    </div>
  );
}

function MasterRankWidget({ userId }: { userId?: string }) {
  // Месяц рейтинга — текущий У АВТОСЕРВИСА (157): границы месяца уезжают на
  // сервер, а он режет сутки поясом тенанта.
  const { month: tenantMonth, timeZone } = useTenantCalendar();
  const [selectedMonth] = useState(tenantMonth);
  const monthStart = `${selectedMonth}-01`;
  const monthEnd = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  })();

  const { data: monthEntries = [] } = useQuery({
    queryKey: ['schedule', monthStart, monthEnd],
    queryFn: async () => {
      const res = await scheduleApi.getAll({ dateFrom: monthStart, dateTo: monthEnd });
      return res.data as unknown[];
    },
    enabled: !!userId,
  });

  const { data: usersData = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data as unknown[];
    },
  });

  type UserLite = { id: string; isActive: boolean; role: string };
  const masters = (usersData as UserLite[]).filter((u) => u.isActive && u.role === 'master');

  // Use SHARED attendance utility — identical logic to RatingTab on schedule.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stats = calculateAttendanceStats((monthEntries as any[]) || [], new Date(), timeZone);
  const ranked = masters
    .map((u) => {
      const s = stats[u.id] || emptyBreakdown();
      return { id: u.id, score: attendanceScore(s), full: s.full, total: s.total };
    })
    .sort((a, b) => b.score - a.score || b.full - a.full);

  if (!userId || ranked.length === 0) return null;
  const myRank = ranked.findIndex((r) => r.id === userId) + 1;
  const me = ranked.find((r) => r.id === userId);
  if (!me || myRank === 0) return null;

  const scoreTone = me.score >= 90 ? 'ok' : me.score >= 70 ? 'warn' : 'bad';
  const monthName = new Date(
    parseInt(selectedMonth.split('-')[0]),
    parseInt(selectedMonth.split('-')[1]) - 1,
  ).toLocaleDateString('ru-RU', { month: 'long' });

  return (
    <Link to="/schedule" className={cn('block rounded-xl', focusRing)}>
      <Card interactive padding="sm" className="flex items-center gap-4">
        <span
          className={cn(
            'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-base font-bold tabular-nums',
            myRank <= 3 ? 'bg-warn-soft text-warn-text' : 'bg-surface-3 text-ink-2',
          )}
        >
          #{myRank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-wide text-ink-3">Мой рейтинг</p>
          <p className="mt-0.5 text-base font-semibold capitalize text-ink">{monthName}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
            <Badge tone={scoreTone} size="sm">
              {me.score}%
            </Badge>
            посещаемость · {me.full}/{me.total} смен
          </p>
        </div>
        <ChevronRight className="h-5 w-5 flex-shrink-0 text-ink-4" aria-hidden="true" />
      </Card>
    </Link>
  );
}
