import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Moon, Thermometer, UsersRound, X, type LucideIcon } from 'lucide-react';
import { scheduleApi } from '../../api/services';
import type { TodayEmployeeStatus } from '../../types';
import { Card, CardHeader } from '../../ui/Card';
import { SkeletonCard } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { ErrorRow, initialsOf } from './shared';
import { recordedAttendanceBucket } from '../../../../shared/utils/attendance';

type StatusKind = 'onShift' | 'lateMinor' | 'lateMajor' | 'notArrived' | 'absent' | 'dayOff' | 'sick' | 'none';

const isSick = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('больнич');
const isAbsent = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('прогул');
// Ручной статус «Смена» или фактический приход считаются «на смене».
const isOnShift = (s: TodayEmployeeStatus) => {
  const bucket = recordedAttendanceBucket(s);
  return s.isWorking || bucket === 'full' || bucket === 'lateMinor' || bucket === 'lateMajor';
};

function kindOf(s: TodayEmployeeStatus): StatusKind {
  if (isSick(s)) return 'sick';
  if (isAbsent(s)) return 'absent';
  if (s.isDayOff) return 'dayOff';
  if (recordedAttendanceBucket(s) === 'lateMajor') return 'lateMajor';
  if (recordedAttendanceBucket(s) === 'lateMinor') return 'lateMinor';
  if (isOnShift(s)) return 'onShift';
  if (s.hasSchedule) return 'notArrived';
  return 'none';
}

const KIND: Record<StatusKind, { label: string; avatar: string; dot: string; badge?: LucideIcon }> = {
  onShift: { label: 'На смене', avatar: 'bg-ok text-white', dot: 'bg-ok' },
  lateMinor: { label: 'Опоздание до часа', avatar: 'bg-warn text-white', dot: 'bg-warn' },
  lateMajor: { label: 'Опоздание больше часа', avatar: 'bg-orange-600 text-white', dot: 'bg-orange-600' },
  notArrived: { label: 'Не отмечен', avatar: 'bg-ink-4 text-white', dot: 'bg-ink-4' },
  absent: { label: 'Прогул', avatar: 'bg-bad text-white', dot: 'bg-bad', badge: X },
  dayOff: { label: 'Выходной', avatar: 'bg-line-strong text-ink-2', dot: 'bg-line-strong', badge: Moon },
  sick: { label: 'Больничный', avatar: 'bg-info text-white', dot: 'bg-info', badge: Thermometer },
  none: { label: 'Без графика', avatar: 'bg-surface-3 text-ink-3', dot: 'bg-line-strong' },
};

const lateRank = (s: TodayEmployeeStatus) =>
  s.lateStatus === 'late_major' ? 3 : s.lateStatus === 'late_minor' ? 2 : 1;

/**
 * «Сотрудники сегодня»: кто на смене, кто опаздывает, кого нет. Каждый человек —
 * ссылка в его карточку. Статус кодируется цветом аватара, подписью и (для
 * выходного/больничного/прогула) значком — не только цветом.
 */
export default function StaffTodayCard() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading && !data) return <SkeletonCard lines={3} />;
  if (isError && !data)
    return (
      <ErrorRow message="Не удалось загрузить статусы сотрудников" onRetry={() => refetch()} loading={isFetching} />
    );

  const statuses = data ?? [];
  if (statuses.length === 0) return null;

  // Группы: на смене (вовремя → <1ч → >1ч), не пришёл, прогул, выходной, больничный.
  const onShiftAll = statuses
    .filter(
      (s) =>
        (isOnShift(s) || s.lateStatus === 'late_minor' || s.lateStatus === 'late_major') &&
        !s.isDayOff &&
        !isSick(s) &&
        !isAbsent(s),
    )
    .sort((a, b) => lateRank(a) - lateRank(b));
  const notArrived = statuses.filter(
    (s) => !isOnShift(s) && !s.isDayOff && s.hasSchedule && !isSick(s) && !isAbsent(s) && !s.lateStatus,
  );
  const absent = statuses.filter((s) => isAbsent(s));
  const dayOff = statuses.filter((s) => s.isDayOff && !isSick(s));
  const sick = statuses.filter((s) => isSick(s));
  // Без графика на сегодня и не на смене — раньше такие люди не попадали ни в
  // одну группу, и карточка стояла с пустым телом.
  const noSchedule = statuses.filter((s) => kindOf(s) === 'none');

  const allGroups: { key: string; title: string; kind: StatusKind; items: TodayEmployeeStatus[] }[] = [
    { key: 'onShift', title: 'На смене', kind: 'onShift', items: onShiftAll },
    { key: 'notArrived', title: 'Ещё не пришли', kind: 'notArrived', items: notArrived },
    { key: 'absent', title: 'Прогул', kind: 'absent', items: absent },
    { key: 'dayOff', title: 'Выходной', kind: 'dayOff', items: dayOff },
    { key: 'sick', title: 'Больничный', kind: 'sick', items: sick },
    { key: 'none', title: 'Без графика на сегодня', kind: 'none', items: noSchedule },
  ];
  const groups = allGroups.filter((g) => g.items.length > 0);

  return (
    <Card padding="none">
      <CardHeader
        icon={UsersRound}
        title="Сотрудники сегодня"
        subtitle={`${statuses.length} чел.`}
        actions={
          <ul
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3"
            aria-label="Сводка по статусам"
          >
            {groups.map((g) => (
              <li key={g.key} className="inline-flex items-center gap-1.5 tabular-nums" title={g.title}>
                <span className={cn('h-2 w-2 rounded-full', KIND[g.kind].dot)} aria-hidden="true" />
                <span className="sr-only">{g.title}: </span>
                {g.items.length}
              </li>
            ))}
          </ul>
        }
      />
      <div className="space-y-4 px-5 py-4">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.title}>
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-3">
              {g.title} <span className="text-ink-4">({g.items.length})</span>
            </h3>
            <ul className="flex flex-wrap gap-1">
              {g.items.map((s) => {
                const k = kindOf(s);
                const meta = KIND[k];
                const Badge = meta.badge;
                return (
                  <li key={s.userId}>
                    <Link
                      to={`/employees/${s.userId}`}
                      title={`${s.fullName} — ${meta.label}`}
                      className={cn(
                        'group flex w-[84px] flex-col items-center gap-1 rounded-lg p-1.5 text-center transition-colors hover:bg-surface-2',
                        focusRing,
                      )}
                    >
                      <span className="relative">
                        <span
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold transition-transform duration-150 group-hover:scale-105',
                            meta.avatar,
                          )}
                          aria-hidden="true"
                        >
                          {initialsOf(s.fullName)}
                        </span>
                        {Badge && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface text-ink-2">
                            <Badge className="h-2.5 w-2.5" aria-hidden="true" />
                          </span>
                        )}
                      </span>
                      <span className="w-full truncate text-xs font-medium text-ink">{s.fullName.split(' ')[0]}</span>
                      <span className="w-full truncate text-2xs text-ink-3">{meta.label}</span>
                      {s.isWorking && <span className="w-full text-2xs text-ink-3">Смена открыта</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
