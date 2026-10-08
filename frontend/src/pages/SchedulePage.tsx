import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Plus,
  Settings,
  Trash2,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { addDays, addMonths, eachDayOfInterval, endOfMonth, format, getDay, startOfMonth, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';

import { attendanceScore, calculateAttendanceStats, emptyBreakdown } from '../../../shared/utils/attendance';
import { scheduleApi, usersApi } from '../api/services';
import { ScheduleEntry, TodayEmployeeStatus, User } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import { formatDayKey } from '../../../shared/utils/formatters';
import { invalidateAttendanceQueries } from '../../../shared/utils/attendanceQueries';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonCard,
  StatCard,
  StatusPill,
  TabPanel,
  Tabs,
  Toolbar,
  cn,
} from '../ui';
import type { DataTableColumn, TabItem } from '../ui';
import { ErrorRow, MiniStat } from '../components/dashboard/shared';
import UserAvatar from '../components/company/UserAvatar';
import {
  LEGEND_KINDS,
  SCHEDULE_STATUS,
  scheduleCellOf,
  shortTime,
  todayStatusOf,
  type ScheduleStatusKind,
} from '../components/company/scheduleStatus';

type TabType = 'schedule' | 'today' | 'mystats' | 'attendance' | 'settings';
type SettingsSection = 'service' | 'masters';

// Русские сокращения дней недели (date-fns 'EE' даёт неверный 2-символьный префикс для Сб).
const DAY_ABBR = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const ORDERED_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Пн–Вс
const CELL_W = 44;

function directionGroupId(user: User): string | null {
  return user.directionId ?? null;
}

interface MyStats {
  totalScheduled: number;
  totalWorked: number;
  totalLate: number;
  totalLateMinor: number;
  totalLateMajor: number;
  totalOnTime: number;
  totalDaysOff: number;
  avgLateMinutes: number;
}

interface WorkMode {
  id: string;
  name: string;
  shiftStart: string;
  shiftEnd: string;
}

type QuickStatus = 'shift' | 'dayoff' | 'sick' | 'late_minor' | 'late_major' | 'absent';

const QUICK_STATUSES: { status: QuickStatus; kind: ScheduleStatusKind; label: string }[] = [
  { status: 'shift', kind: 'planned', label: 'Смена' },
  { status: 'dayoff', kind: 'dayOff', label: 'Выходной' },
  { status: 'sick', kind: 'sick', label: 'Больничный' },
  { status: 'late_minor', kind: 'lateMinor', label: 'Опоздал до часа' },
  { status: 'late_major', kind: 'lateMajor', label: 'Опоздал больше часа' },
  { status: 'absent', kind: 'absent', label: 'Прогул' },
];

/** 'YYYY-MM' → первое число месяца локальной полуночью; мусор → null. */
function parseMonthKey(key: string | null): Date | null {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return null;
  const [y, m] = key.split('-').map(Number);
  if (m < 1 || m > 12) return null;
  return new Date(y, m - 1, 1);
}

// ---------------------------------------------------------------------------
// Рейтинг посещаемости
// ---------------------------------------------------------------------------
function AttendanceRatingTab({ users }: { users: User[] }) {
  // Месяц рейтинга — текущий У АВТОСЕРВИСА (157): выборка смен уезжает на
  // сервер границами месяца, а он режет сутки поясом тенанта. По часам браузера
  // в ночь на 1-е число вкладка открывалась в пустом следующем месяце.
  const { month: tenantMonth, timeZone } = useTenantCalendar();
  const [selectedMonth, setSelectedMonth] = useState(tenantMonth);

  const monthStart = `${selectedMonth}-01`;
  const monthEnd = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  })();

  const {
    data: monthEntries,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', monthStart, monthEnd],
    queryFn: async () => {
      const res = await scheduleApi.getAll({ dateFrom: monthStart, dateTo: monthEnd });
      return res.data as ScheduleEntry[];
    },
  });

  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Статистика по каждому — ОБЩЕЙ утилитой: одна логика везде.
  const stats = useMemo(
    () => calculateAttendanceStats(monthEntries ?? [], new Date(), timeZone),
    [monthEntries, timeZone],
  );

  const ranked = useMemo(() => {
    return users
      .map((u) => {
        const s = stats[u.id] || emptyBreakdown();
        const score = attendanceScore(s);
        return { ...u, stats: s, score };
      })
      .sort((a, b) => b.score - a.score || b.stats.full - a.stats.full);
  }, [users, stats]);

  const shiftMonth = (dir: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setExpandedUserId(null);
  };

  const monthLabel = (() => {
    const [y, m] = selectedMonth.split('-');
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  })();

  const fmtDate = (d: string) => {
    const [, m, day] = d.split('-');
    return `${parseInt(day)}.${m}`;
  };

  return (
    <div className="space-y-4">
      <Toolbar>
        <IconButton
          label="Предыдущий месяц"
          icon={ChevronLeft}
          variant="secondary"
          size="sm"
          onClick={() => shiftMonth(-1)}
        />
        <h2 className="min-w-[10rem] text-center text-md font-semibold capitalize text-ink" aria-live="polite">
          {monthLabel}
        </h2>
        <IconButton
          label="Следующий месяц"
          icon={ChevronRight}
          variant="secondary"
          size="sm"
          onClick={() => shiftMonth(1)}
        />
        {selectedMonth !== tenantMonth && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedMonth(tenantMonth)}>
            К текущему
          </Button>
        )}
      </Toolbar>

      {isLoading && !monthEntries ? (
        <div className="space-y-2">
          <SkeletonCard lines={1} />
          <SkeletonCard lines={1} />
          <SkeletonCard lines={1} />
        </div>
      ) : isError && !monthEntries ? (
        <ErrorRow message="Не удалось загрузить посещаемость за месяц" onRetry={() => refetch()} loading={isFetching} />
      ) : ranked.length === 0 ? (
        <EmptyState icon={Users} title="Нет сотрудников" description="Рейтинг строится по мастерам и администраторам" />
      ) : (
        <ol className="space-y-2">
          {ranked.map((u, idx) => {
            const s = u.stats;
            const scoreTone = u.score >= 90 ? 'ok' : u.score >= 70 ? 'warn' : 'bad';
            const isExpanded = expandedUserId === u.id;
            const detailId = `rating-details-${u.id}`;
            const segments: { kind: ScheduleStatusKind; value: number; bar: string }[] = [
              { kind: 'planned', value: s.full, bar: 'bg-ok' },
              { kind: 'lateMinor', value: s.lateMinor, bar: 'bg-warn' },
              { kind: 'lateMajor', value: s.lateMajor, bar: 'bg-orange-500' },
              { kind: 'absent', value: s.absent, bar: 'bg-bad' },
            ];
            const allDetails: { kind: ScheduleStatusKind; title: string; count: number; dates: string[] }[] = [
              { kind: 'planned', title: 'Полная смена', count: s.full, dates: s.fullDates },
              { kind: 'lateMinor', title: 'Опоздал до часа', count: s.lateMinor, dates: s.lateMinorDates },
              { kind: 'lateMajor', title: 'Опоздал больше часа', count: s.lateMajor, dates: s.lateMajorDates },
              { kind: 'absent', title: 'Прогул', count: s.absent, dates: s.absentDates },
              { kind: 'sick', title: 'Больничный', count: s.sick, dates: s.sickDates },
              { kind: 'dayOff', title: 'Выходной', count: s.dayOff, dates: s.dayOffDates },
            ];
            const details = allDetails.filter((d) => d.dates.length > 0);
            return (
              <li key={u.id}>
                <Card padding="none" className={cn(idx === 0 && 'border-accent/40')}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={cn(
                        'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                        idx === 0
                          ? 'bg-accent text-white'
                          : idx < 3
                            ? 'bg-accent-soft text-accent-text'
                            : 'bg-surface-3 text-ink-2',
                      )}
                      aria-label={`Место ${idx + 1}`}
                    >
                      {idx + 1}
                    </span>
                    <UserAvatar name={u.fullName} src={u.avatar} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{u.fullName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="ok" icon={SCHEDULE_STATUS.planned.icon} size="sm">
                          {s.full}
                        </Badge>
                        {s.lateMinor > 0 && (
                          <Badge tone="warn" icon={SCHEDULE_STATUS.lateMinor.icon} size="sm">
                            {s.lateMinor}
                          </Badge>
                        )}
                        {s.lateMajor > 0 && (
                          <Badge tone="warn" icon={SCHEDULE_STATUS.lateMajor.icon} size="sm">
                            {s.lateMajor}
                          </Badge>
                        )}
                        {s.absent > 0 && (
                          <Badge tone="bad" icon={SCHEDULE_STATUS.absent.icon} size="sm">
                            {s.absent}
                          </Badge>
                        )}
                        {s.sick > 0 && (
                          <Badge tone="info" icon={SCHEDULE_STATUS.sick.icon} size="sm">
                            {s.sick}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <MiniStat label="Посещаемость" value={`${u.score} %`} tone={scoreTone} align="right" size="sm" />
                    <IconButton
                      label={isExpanded ? 'Скрыть даты' : 'Показать даты'}
                      icon={isExpanded ? ChevronUp : ChevronDown}
                      size="sm"
                      onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                    />
                  </div>

                  {s.total > 0 && (
                    <div className="px-4 pb-3">
                      <div
                        className="flex h-1.5 overflow-hidden rounded-full bg-surface-3"
                        role="img"
                        aria-label={`Смен: ${s.full}, опозданий до часа: ${s.lateMinor}, больше часа: ${s.lateMajor}, прогулов: ${s.absent}`}
                      >
                        {segments
                          .filter((seg) => seg.value > 0)
                          .map((seg) => (
                            <div
                              key={seg.kind}
                              className={seg.bar}
                              style={{ width: `${(seg.value / s.total) * 100}%` }}
                            />
                          ))}
                      </div>
                    </div>
                  )}

                  {isExpanded && (
                    <div id={detailId} className="space-y-1.5 border-t border-line bg-surface-2 px-4 py-3 text-xs">
                      {details.length === 0 ? (
                        <p className="text-ink-3">Нет данных за этот месяц</p>
                      ) : (
                        details.map((d) => {
                          const Icon = SCHEDULE_STATUS[d.kind].icon;
                          return (
                            <p key={d.kind} className="flex items-start gap-1.5">
                              <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-ink-3" aria-hidden="true" />
                              <span>
                                <span className="font-medium text-ink">
                                  {d.title} ({d.count}):
                                </span>{' '}
                                <span className="text-ink-2">{d.dates.map(fmtDate).join(', ')}</span>
                              </span>
                            </p>
                          );
                        })
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Страница
// ---------------------------------------------------------------------------
export default function SchedulePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const formId = useId();
  // «Сегодня» в графике — по календарю АВТОСЕРВИСА: тем же поясом сервер решает,
  // какие дни уже отработаны (salary.workedShiftsByUser).
  const { timeZone, today: tenantToday, month: tenantMonth } = useTenantCalendar();
  // Первое число ТЕКУЩЕГО месяца автосервиса. Календарная арифметика над
  // локальной полуночью — пояс машины на неё уже не влияет.
  const tenantMonthStart = useMemo(() => {
    const [y, m] = tenantToday.split('-').map(Number);
    return new Date(y || 1970, (m || 1) - 1, 1);
  }, [tenantToday]);
  // Мутации расписания/режимов работы — ключ schedule_manage (backend
  // POST/PATCH/DELETE /schedule*; волна Битрикс24). Просмотр — schedule_view.
  const canEdit = hasPermission('schedule_manage');

  // Вкладка, месяц сетки и раздел настроек — в URL: F5 и пересылка ссылки
  // возвращают на то же место.
  const tabItems = useMemo<TabItem<TabType>[]>(
    () => [
      { key: 'schedule', label: 'График', icon: CalendarDays },
      { key: 'today', label: 'Сегодня', icon: Clock },
      { key: 'mystats', label: 'Смены', icon: Users },
      { key: 'attendance', label: 'Рейтинг', icon: BarChart3 },
      ...(canEdit ? [{ key: 'settings' as const, label: 'Настройки', icon: Settings }] : []),
    ],
    [canEdit],
  );
  const requestedTab = params.get('tab') as TabType | null;
  const tab: TabType = tabItems.some((t) => t.key === requestedTab) ? (requestedTab as TabType) : 'schedule';
  const settingsTab: SettingsSection = params.get('section') === 'masters' ? 'masters' : 'service';

  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) p.delete(k);
            else p.set(k, v);
          }
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const setTab = (next: TabType) => updateParams({ tab: next === 'schedule' ? null : next });
  const setSettingsTab = (next: SettingsSection) => updateParams({ section: next === 'service' ? null : next });

  // Стартовый месяц — текущий У АВТОСЕРВИСА: в ночь на 1-е число график по
  // часам браузера открывался уже в следующем месяце (пустая сетка).
  const currentMonth = useMemo(
    () => parseMonthKey(params.get('month')) ?? tenantMonthStart,
    [params, tenantMonthStart],
  );
  const setCurrentMonth = useCallback(
    (d: Date) => {
      const key = format(d, 'yyyy-MM');
      updateParams({ month: key === tenantMonth ? null : key });
    },
    [tenantMonth, updateParams],
  );

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const dateFrom = format(monthStart, 'yyyy-MM-dd');
  const dateTo = format(monthEnd, 'yyyy-MM-dd');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Quick status popup
  const [quickPopup, setQuickPopup] = useState<{
    userId: string;
    date: string;
    entry?: ScheduleEntry;
  } | null>(null);

  // Local pending changes — applied in batch via "Apply" button
  // Key format: `${userId}-${date}`
  const [pendingChanges, setPendingChanges] = useState<
    Record<string, { userId: string; date: string; payload: any; existingEntryId?: string }>
  >({});
  const [applying, setApplying] = useState(false);

  // Master reorder dialog
  const [reorderDialog, setReorderDialog] = useState<{ userId: string; name: string; currentIndex: number } | null>(
    null,
  );

  const [entryForm, setEntryForm] = useState({
    userId: '',
    date: tenantToday,
    shiftStart: '09:00',
    shiftEnd: '18:00',
    isDayOff: false,
    isSickDay: false,
    note: '',
  });

  // Queries — queryFn returns plain data (NOT AxiosResponse) so setQueryData works
  const {
    data: scheduleData,
    isLoading: scheduleLoading,
    isError: scheduleError,
    isFetching: scheduleFetching,
    refetch: refetchSchedule,
  } = useQuery({
    queryKey: ['schedule', dateFrom, dateTo],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await scheduleApi.getAll({ dateFrom, dateTo });
      return res.data as ScheduleEntry[];
    },
  });

  const {
    data: todayData,
    isLoading: todayLoading,
    isError: todayError,
    isFetching: todayFetching,
    refetch: refetchToday,
  } = useQuery({
    queryKey: ['schedule-today'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return res.data as TodayEmployeeStatus[];
    },
    enabled: tab === 'today',
  });

  const {
    data: myStatsData,
    isLoading: myStatsLoading,
    isError: myStatsError,
    isFetching: myStatsFetching,
    refetch: refetchMyStats,
  } = useQuery({
    queryKey: ['my-schedule-stats'],
    queryFn: async () => (await scheduleApi.getMyStats()).data as MyStats,
    enabled: tab === 'mystats',
  });

  // Команда ТЕКУЩЕГО филиала (167): строки сетки — сотрудники этого
  // автосервиса (назначенные на него + не назначенные никуда), а дни строк
  // сервер отдаёт только этого филиала. Ключ под префиксом ['users'], чтобы
  // инвалидации справочника сотрудников дёргали и его. В слоте лежит МАССИВ —
  // так же его пишет «Планирование» (одна форма слота на всех потребителей и
  // на IndexedDB-снимок; ответ axios с функциями туда не клонируется).
  const {
    data: usersData,
    isError: usersError,
    refetch: refetchUsers,
    isFetching: usersFetching,
  } = useQuery({
    queryKey: ['users', 'point'],
    queryFn: async () => (await usersApi.getAll({ scope: 'point' })).data as User[],
  });

  const entries = useMemo(() => scheduleData ?? [], [scheduleData]);
  const todayStatuses = useMemo(() => todayData ?? [], [todayData]);
  const users = useMemo(() => usersData ?? [], [usersData]);

  // Days of the current month
  const monthDays = useMemo(() => {
    try {
      return eachDayOfInterval({ start: monthStart, end: monthEnd });
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  // Build user -> date -> entry map.
  // Defensive against missing userId/date (stale SW cache, partial payloads).
  const entryMap = useMemo(() => {
    const map: Record<string, Record<string, ScheduleEntry>> = {};
    entries.forEach((entry) => {
      if (!entry?.userId || !entry?.date) return;
      const uid = entry.userId;
      const d = String(entry.date).slice(0, 10);
      if (!map[uid]) map[uid] = {};
      map[uid][d] = entry;
    });
    // Overlay pending changes
    Object.values(pendingChanges).forEach((c) => {
      if (!c?.userId || !c?.date) return;
      const uid = c.userId;
      const d = String(c.date).slice(0, 10);
      if (!map[uid]) map[uid] = {};
      const existing = map[uid][d];
      map[uid][d] = {
        ...(existing || { id: `pending-${uid}-${d}`, tenantId: '', userId: uid, date: c.date, isManualOverride: true }),
        ...c.payload,
      } as ScheduleEntry;
    });
    return map;
  }, [entries, pendingChanges]);

  // Global master order — saved in backend via users.sortOrder
  const updateOrderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => usersApi.updateOrder(orderedIds),
    onMutate: async (orderedIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: ['users', 'point'] });
      const prev = queryClient.getQueryData<User[]>(['users', 'point']);
      queryClient.setQueryData<User[]>(['users', 'point'], (old) => {
        if (!Array.isArray(old)) return old;
        const byId = new Map(old.map((u) => [u.id, u]));
        const reordered = orderedIds
          .map((id, i) => {
            const u = byId.get(id);
            return u ? ({ ...u, sortOrder: i } as User) : null;
          })
          .filter((u): u is User => u !== null);
        // Add any users not in orderedIds (new users)
        const remaining = old.filter((u) => !orderedIds.includes(u.id));
        return [...reordered, ...remaining];
      });
      return prev;
    },
    onError: (_e, _v, ctx) => {
      if (ctx) queryClient.setQueryData(['users', 'point'], ctx);
      toast.error('Не сохранено: порядок мастеров не изменён');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  // All active users — use users list as primary source, supplement with entry users
  const scheduleUsers = useMemo(() => {
    // Мастера И администраторы — оба работают сменами и видны в графике.
    // Директор/суперадмин (владельцы) в графике не отображаются — требование продукта.
    const activeUsers = users.filter((u) => u.isActive && (u.role === 'master' || u.role === 'admin'));
    const activeIds = new Set(activeUsers.map((u) => u.id));

    entries.forEach((e) => {
      if (e.user && !activeIds.has(e.userId)) {
        activeUsers.push(e.user as User);
        activeIds.add(e.userId);
      }
    });

    // Sort by backend sortOrder field
    activeUsers.sort((a, b) => {
      const aUnassigned = directionGroupId(a) === null;
      const bUnassigned = directionGroupId(b) === null;
      if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
      const ad = a.directionName?.trim() || '\uffff';
      const bd = b.directionName?.trim() || '\uffff';
      const groupOrder = ad.localeCompare(bd, 'ru');
      if (groupOrder !== 0) return groupOrder;
      const groupIdOrder = (directionGroupId(a) ?? '').localeCompare(directionGroupId(b) ?? '');
      if (groupIdOrder !== 0) return groupIdOrder;
      const ao = (a as any).sortOrder ?? 0;
      const bo = (b as any).sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.fullName.localeCompare(b.fullName);
    });

    return activeUsers;
  }, [entries, users]);

  const scheduleDisplayRows = useMemo(() => {
    const displayRows: Array<
      { kind: 'direction'; key: string; label: string } | { kind: 'employee'; key: string; user: User; index: number }
    > = [];
    let previousGroupId: string | null = null;
    let hasPreviousGroup = false;
    scheduleUsers.forEach((user, index) => {
      const groupId = directionGroupId(user);
      if (!hasPreviousGroup || groupId !== previousGroupId) {
        displayRows.push({
          kind: 'direction',
          key: `direction:${JSON.stringify([groupId === null, groupId])}`,
          label: groupId === null ? 'Без направления' : user.directionName || 'Без названия',
        });
        previousGroupId = groupId;
        hasPreviousGroup = true;
      }
      displayRows.push({ kind: 'employee', key: `employee:${user.id}`, user, index });
    });
    return displayRows;
  }, [scheduleUsers]);

  const moveMasterToPosition = (userId: string, newPos: number) => {
    const moved = scheduleUsers.find((u) => u.id === userId);
    if (!moved) return;
    const groupUsers = scheduleUsers.filter((u) => directionGroupId(u) === directionGroupId(moved));
    const currentGroupPos = groupUsers.findIndex((u) => u.id === userId);
    if (newPos < 0 || newPos >= groupUsers.length || currentGroupPos === newPos) return;
    const reorderedGroup = groupUsers.map((u) => u.id);
    reorderedGroup.splice(currentGroupPos, 1);
    reorderedGroup.splice(newPos, 0, userId);
    const groupPositions = scheduleUsers.flatMap((u, index) =>
      directionGroupId(u) === directionGroupId(moved) ? [index] : [],
    );
    const reordered = scheduleUsers.map((u) => u.id);
    groupPositions.forEach((position, index) => {
      reordered[position] = reorderedGroup[index];
    });
    updateOrderMutation.mutate(reordered);
    setReorderDialog(null);
  };

  // Month navigation
  const goToPrevMonth = useCallback(() => setCurrentMonth(subMonths(currentMonth, 1)), [currentMonth, setCurrentMonth]);
  const goToNextMonth = useCallback(() => setCurrentMonth(addMonths(currentMonth, 1)), [currentMonth, setCurrentMonth]);
  const goToToday = useCallback(() => setCurrentMonth(tenantMonthStart), [tenantMonthStart, setCurrentMonth]);
  const isCurrentMonth = format(currentMonth, 'yyyy-MM') === tenantMonth;

  const createMutation = useMutation({
    mutationFn: (data: any) => scheduleApi.create(data),
    onSuccess: () => {
      // Delayed refetch — let server process first, patched cache is already showing
      setTimeout(() => {
        refetchSchedule();
        void invalidateAttendanceQueries(queryClient);
      }, 1500);
      closeModal();
    },
    onError: (err: unknown) => {
      refetchSchedule();
      toast.error(apiErrorMessage(err) ?? 'Ошибка');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => scheduleApi.update(id, data),
    onSuccess: () => {
      setTimeout(() => {
        refetchSchedule();
        void invalidateAttendanceQueries(queryClient);
      }, 1500);
      closeModal();
    },
    onError: (err: unknown) => {
      refetchSchedule();
      toast.error(apiErrorMessage(err) ?? 'Ошибка');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduleApi.remove(id),
    onSuccess: () => {
      void invalidateAttendanceQueries(queryClient);
      toast.success('Запись удалена');
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка удаления');
    },
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditingEntry(null);
    setEntryForm({
      userId: '',
      date: tenantToday,
      shiftStart: '09:00',
      shiftEnd: '18:00',
      isDayOff: false,
      isSickDay: false,
      note: '',
    });
  };

  const openCreate = (userId?: string, date?: string) => {
    if (!canEdit) return;
    setEditingEntry(null);
    setEntryForm({
      userId: userId || '',
      date: date || tenantToday,
      shiftStart: '09:00',
      shiftEnd: '18:00',
      isDayOff: false,
      isSickDay: false,
      note: '',
    });
    setModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryForm.userId) {
      toast.error('Выберите сотрудника');
      return;
    }
    const isDayOff = entryForm.isDayOff || entryForm.isSickDay;
    const note = entryForm.isSickDay ? 'Больничный' : entryForm.note || undefined;
    const payload = {
      userId: entryForm.userId,
      date: entryForm.date,
      shiftStart: isDayOff ? null : entryForm.shiftStart,
      shiftEnd: isDayOff ? null : entryForm.shiftEnd,
      isDayOff,
      note,
      // Выходной/больничный стирает факт прихода явно (PATCH частичный) —
      // иначе зарплата продолжала считать такой день отработанной сменой.
      ...(isDayOff ? { actualArrival: null } : {}),
    };
    if (editingEntry) {
      updateMutation.mutate({ id: editingEntry.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Work modes query
  const {
    data: workModesData,
    isLoading: workModesLoading,
    isError: workModesError,
    isFetching: workModesFetching,
    refetch: refetchWorkModes,
  } = useQuery({
    queryKey: ['work-modes'],
    queryFn: async () => (await scheduleApi.getWorkModes()).data as WorkMode[],
    enabled: tab === 'settings',
  });
  const workModes = useMemo(() => workModesData ?? [], [workModesData]);

  const createWorkModeMutation = useMutation({
    mutationFn: (data: any) => scheduleApi.createWorkMode(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-modes'] });
      toast.success('Режим работы создан');
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Не удалось создать режим'),
  });

  // Quick status change — directly creates/updates entry without opening modal
  const quickSetStatus = (status: QuickStatus | 'delete') => {
    if (!quickPopup) return;
    const { userId, date, entry } = quickPopup;

    if (status === 'delete' && entry) {
      deleteMutation.mutate(entry.id);
      setQuickPopup(null);
      return;
    }

    const isDayOff = status === 'dayoff' || status === 'sick';
    const note = status === 'sick' ? 'Больничный' : status === 'absent' ? 'Прогул' : '';

    // Бизнес-«сегодня» — календарный день В ПОЯСЕ АВТОСЕРВИСА (tenants.timezone,
    // 157), тот же, каким сервер считает отработанные смены. Будущий день — это
    // ПЛАН: факт прихода (actualArrival) и статус «вовремя» ему не пришиваем,
    // иначе зарплата считала бы смену раньше, чем она отработана.
    const isFutureDay = date > formatDayKey(new Date(), timeZone);

    const lateStatus =
      status === 'late_minor'
        ? 'late_minor'
        : status === 'late_major'
          ? 'late_major'
          : status === 'shift' && !isFutureDay
            ? 'on_time'
            : undefined;
    const lateMinutes = status === 'late_minor' ? 15 : status === 'late_major' ? 60 : 0;

    const shiftStartStr = entry?.shiftStart || '09:00';
    const payload: any = {
      userId,
      date,
      shiftStart: isDayOff ? null : shiftStartStr,
      shiftEnd: isDayOff ? null : entry?.shiftEnd || '18:00',
      isDayOff,
      note: note || '',
      lateStatus: lateStatus || null,
      lateMinutes: lateMinutes || 0,
      // null явно (не опускаем поле): PATCH частичный — Выходной/Больничный/
      // Прогул обязаны СТЕРЕТЬ устаревший факт прихода, иначе зарплата
      // продолжала считать такой день отработанной сменой.
      ...(isDayOff || status === 'absent' || isFutureDay ? { actualArrival: null } : {}),
    };

    if (entry && !isDayOff && entry.shiftStart) {
      payload.shiftStart = entry.shiftStart;
      payload.shiftEnd = entry.shiftEnd;
    }

    // Save to pending changes — NOT sent to server until "Apply" clicked
    const key = `${userId}-${date}`;
    flushSync(() => {
      setPendingChanges((prev) => ({
        ...prev,
        [key]: { userId, date, payload, existingEntryId: entry?.id },
      }));
      setQuickPopup(null);
    });
  };

  // Apply all pending changes at once
  const applyPendingChanges = async () => {
    const changes = Object.values(pendingChanges);
    if (changes.length === 0 || applying) return;
    setApplying(true);

    const failures: string[] = [];
    try {
      for (const change of changes) {
        try {
          if (change.existingEntryId) {
            await scheduleApi.update(change.existingEntryId, change.payload);
          } else {
            await scheduleApi.create(change.payload);
          }
        } catch {
          failures.push(change.userId);
        }
      }
    } finally {
      setApplying(false);
    }

    setPendingChanges({});
    void invalidateAttendanceQueries(queryClient);

    if (failures.length === 0) {
      toast.success(`Применено изменений: ${changes.length}`);
    } else {
      toast.error(`Не удалось применить: ${failures.length}`);
    }
  };

  const discardPendingChanges = () => {
    setPendingChanges({});
  };

  const pendingCount = Object.keys(pendingChanges).length;
  const todayKey = formatDayKey(new Date(), timeZone);
  const scrollRef = useRef<HTMLDivElement>(null);
  const quickUser = quickPopup ? users.find((u) => u.id === quickPopup.userId) : null;

  const todayColumns = useMemo<DataTableColumn<TodayEmployeeStatus>[]>(
    () => [
      {
        key: 'fullName',
        header: 'Сотрудник',
        render: (s) => (
          <span className="inline-flex items-center gap-2.5">
            <UserAvatar name={s.fullName} size="sm" />
            <span className="font-medium text-ink">{s.fullName}</span>
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Статус',
        render: (s) => {
          const st = todayStatusOf(s);
          return (
            <span className="flex flex-col items-start gap-1">
              <StatusPill tone={st.tone} live={s.isWorking && st.tone === 'ok'}>
                {st.label}
              </StatusPill>
              {s.isWorking && <span className="text-xs text-ink-3">Фактическая смена открыта</span>}
            </span>
          );
        },
      },
      {
        key: 'shift',
        header: 'Смена',
        hideBelow: 'sm',
        render: (s) =>
          !s.isDayOff && s.hasSchedule && s.shiftStart ? (
            <span className="tabular-nums">
              {shortTime(s.shiftStart)}–{shortTime(s.shiftEnd)}
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        key: 'arrival',
        header: 'Пришёл',
        hideBelow: 'md',
        render: (s) =>
          s.actualArrival ? (
            <span className="tabular-nums">{shortTime(s.actualArrival, timeZone)}</span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        key: 'late',
        header: 'Опоздание',
        numeric: true,
        hideBelow: 'md',
        render: (s) =>
          s.lateMinutes > 0 ? (
            <span className="text-warn-text">{s.lateMinutes} мин</span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        key: 'note',
        header: 'Заметка',
        hideBelow: 'lg',
        truncate: true,
        width: 220,
        render: (s) => s.note || <span className="text-ink-3">—</span>,
      },
    ],
    [],
  );

  const legend = (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3" aria-label="Легенда">
      {LEGEND_KINDS.map((kind) => {
        const def = SCHEDULE_STATUS[kind];
        const Icon = def.icon;
        return (
          <li key={kind} className="flex items-center gap-1.5">
            <span
              className={cn('flex h-5 w-5 items-center justify-center rounded border', def.cell)}
              aria-hidden="true"
            >
              <Icon className="h-3 w-3" />
            </span>
            {def.short}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Расписание"
        icon={CalendarDays}
        subtitle="График смен, посещаемость и режимы работы"
        actions={
          canEdit ? (
            <Button variant="secondary" icon={Plus} onClick={() => openCreate()}>
              Добавить запись
            </Button>
          ) : undefined
        }
      />

      {/* Несохранённые изменения — липкая полоса поверх любой вкладки */}
      {pendingCount > 0 && (
        <div
          role="status"
          className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 shadow-card"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-warn-text">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            Несохранённых изменений: <span className="tabular-nums">{pendingCount}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={discardPendingChanges} disabled={applying}>
              Отменить
            </Button>
            <Button size="sm" onClick={applyPendingChanges} loading={applying}>
              Применить
            </Button>
          </div>
        </div>
      )}

      <Tabs items={tabItems} value={tab} onChange={setTab} aria-label="Разделы расписания" idPrefix="schedule" />

      {/* График: строки — сотрудники, колонки — дни месяца */}
      <TabPanel idPrefix="schedule" tabKey="schedule" active={tab === 'schedule'}>
        <Card padding="none">
          <Toolbar className="border-b border-line px-4 py-3" end={legend}>
            <IconButton
              label="Предыдущий месяц"
              icon={ChevronLeft}
              variant="secondary"
              size="sm"
              onClick={goToPrevMonth}
            />
            <h2 className="min-w-[10rem] text-center text-md font-semibold capitalize text-ink" aria-live="polite">
              {format(currentMonth, 'LLLL yyyy', { locale: ru })}
            </h2>
            <IconButton
              label="Следующий месяц"
              icon={ChevronRight}
              variant="secondary"
              size="sm"
              onClick={goToNextMonth}
            />
            {!isCurrentMonth && (
              <Button variant="ghost" size="sm" onClick={goToToday}>
                К текущему
              </Button>
            )}
          </Toolbar>

          {scheduleLoading && !scheduleData ? (
            <div className="space-y-3 p-4" role="status" aria-label="Загрузка графика…">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : scheduleError && !scheduleData ? (
            <div className="p-4">
              <ErrorRow
                message="Не удалось загрузить график"
                onRetry={() => refetchSchedule()}
                loading={scheduleFetching}
              />
            </div>
          ) : usersError && scheduleUsers.length === 0 ? (
            <div className="p-4">
              <ErrorRow
                message="Не удалось загрузить список сотрудников"
                onRetry={() => refetchUsers()}
                loading={usersFetching}
              />
            </div>
          ) : scheduleUsers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Нет сотрудников"
              description="Добавьте мастеров в разделе «Пользователи», чтобы составить график"
            />
          ) : (
            <div className="flex">
              {/* Липкая колонка сотрудников: вне горизонтального скролла, строки выровнены фиксированной высотой */}
              <div className="w-44 flex-shrink-0 border-r border-line bg-surface sm:w-56">
                <div className="flex h-10 items-center border-b border-line bg-surface-2 px-3 text-xs font-semibold text-ink-3">
                  Сотрудник
                </div>
                {scheduleDisplayRows.map((row) => {
                  if (row.kind === 'direction')
                    return (
                      <div
                        key={row.key}
                        className="flex h-8 items-center border-b border-line bg-surface-2 px-3 text-2xs font-semibold uppercase tracking-wide text-ink-3"
                      >
                        {row.label}
                      </div>
                    );
                  const { user: u, index: idx } = row;
                  const rowInner = (
                    <>
                      <span className="w-4 flex-shrink-0 text-2xs font-semibold tabular-nums text-ink-4">
                        {idx + 1}
                      </span>
                      <UserAvatar name={u.fullName} src={u.avatar} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{u.fullName}</span>
                    </>
                  );
                  return canEdit ? (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() =>
                        setReorderDialog({
                          userId: u.id,
                          name: u.fullName,
                          currentIndex: scheduleUsers
                            .filter((item) => directionGroupId(item) === directionGroupId(u))
                            .findIndex((item) => item.id === u.id),
                        })
                      }
                      title="Изменить позицию внутри направления"
                      aria-label={`${u.fullName} — изменить позицию в направлении ${u.directionName || 'Без направления'}`}
                      className="flex h-12 w-full items-center gap-2 border-b border-line px-3 text-left transition-colors hover:bg-surface-2 focus-ring"
                    >
                      {rowInner}
                    </button>
                  ) : (
                    <div key={row.key} className="flex h-12 items-center gap-2 border-b border-line px-3">
                      {rowInner}
                    </div>
                  );
                })}
              </div>

              {/* Прокручиваемая область дат */}
              <div className="min-w-0 flex-1 overflow-x-auto" ref={scrollRef}>
                <div style={{ minWidth: `${monthDays.length * CELL_W}px` }}>
                  <div className="flex h-10 border-b border-line bg-surface-2">
                    {monthDays.map((day) => {
                      const dayOfWeek = getDay(day);
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                      const dayKey = format(day, 'yyyy-MM-dd');
                      const isTodayDate = dayKey === todayKey;
                      return (
                        <div
                          key={dayKey}
                          className={cn(
                            'flex w-11 flex-shrink-0 flex-col items-center justify-center leading-none',
                            isTodayDate && 'bg-accent-soft',
                          )}
                        >
                          <span className={cn('text-2xs', isWeekend ? 'text-bad-text' : 'text-ink-3')}>
                            {DAY_ABBR[dayOfWeek]}
                          </span>
                          <span
                            className={cn(
                              'mt-0.5 text-xs font-semibold tabular-nums',
                              isTodayDate ? 'text-accent-text' : isWeekend ? 'text-bad-text' : 'text-ink',
                            )}
                          >
                            {format(day, 'd')}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {scheduleDisplayRows.map((row) => {
                    if (row.kind === 'direction')
                      return (
                        <div
                          key={row.key}
                          className="h-8 border-b border-line bg-surface-2"
                          style={{ minWidth: `${monthDays.length * CELL_W}px` }}
                          aria-hidden="true"
                        />
                      );
                    const u = row.user;
                    return (
                      <div key={row.key} className="flex h-12 border-b border-line">
                        {monthDays.map((day) => {
                          const dateStr = format(day, 'yyyy-MM-dd');
                          const entry = entryMap[u.id]?.[dateStr];
                          const cell = scheduleCellOf(entry, dateStr, todayKey);
                          const dayOfWeek = getDay(day);
                          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                          const isTodayDate = dateStr === todayKey;
                          const def = cell ? SCHEDULE_STATUS[cell.kind] : null;
                          const CellIcon = def?.icon;
                          const statusLabel = def
                            ? cell?.time
                              ? `${def.label}, с ${cell.time}`
                              : def.label
                            : isWeekend
                              ? 'выходной день, записи нет'
                              : 'записи нет';
                          const content = def ? (
                            <span
                              className={cn('flex h-8 w-8 items-center justify-center rounded-lg border', def.cell)}
                              aria-hidden="true"
                            >
                              {cell?.time ? (
                                <span className="text-2xs font-semibold tabular-nums">{cell.time}</span>
                              ) : (
                                CellIcon && <CellIcon className="h-4 w-4" />
                              )}
                            </span>
                          ) : null;
                          const cellCls = cn(
                            'flex h-12 w-11 flex-shrink-0 items-center justify-center border-r border-line last:border-r-0',
                            isTodayDate ? 'bg-accent-soft/40' : isWeekend ? 'bg-surface-2/70' : '',
                          );
                          return canEdit ? (
                            <button
                              key={dateStr}
                              type="button"
                              onClick={() => setQuickPopup({ userId: u.id, date: dateStr, entry })}
                              aria-label={`${u.fullName}, ${format(day, 'd MMMM', { locale: ru })}: ${statusLabel}`}
                              title={statusLabel}
                              className={cn(
                                cellCls,
                                'transition-colors hover:bg-accent-soft/60 focus-ring focus-visible:z-10',
                              )}
                            >
                              {content}
                            </button>
                          ) : (
                            <div key={dateStr} className={cellCls} title={statusLabel}>
                              {content}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Card>
      </TabPanel>

      {/* Сегодня */}
      <TabPanel idPrefix="schedule" tabKey="today" active={tab === 'today'}>
        <DataTable
          rows={todayStatuses}
          rowKey={(s) => s.userId}
          columns={todayColumns}
          isLoading={todayLoading && !todayData}
          isError={todayError && !todayData}
          onRetry={refetchToday}
          isFetching={todayFetching}
          caption="Статус сотрудников на сегодня"
          emptyState={{
            icon: CalendarDays,
            title: 'Нет данных на сегодня',
            description: 'Расписание на сегодня не настроено',
          }}
        />
      </TabPanel>

      {/* Мои смены */}
      <TabPanel idPrefix="schedule" tabKey="mystats" active={tab === 'mystats'}>
        {myStatsLoading && !myStatsData ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} lines={1} />
            ))}
          </div>
        ) : myStatsError && !myStatsData ? (
          <ErrorRow
            message="Не удалось загрузить вашу статистику"
            onRetry={() => refetchMyStats()}
            loading={myStatsFetching}
          />
        ) : myStatsData ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Рабочих дней" value={myStatsData.totalWorked} hint="за месяц" icon={CalendarDays} />
              <StatCard
                label="Вовремя"
                value={myStatsData.totalOnTime}
                icon={Check}
                tone={myStatsData.totalOnTime > 0 ? 'ok' : 'neutral'}
              />
              <StatCard
                label="Опозданий"
                value={myStatsData.totalLate}
                icon={Clock}
                tone={myStatsData.totalLate > 0 ? 'warn' : 'neutral'}
              />
              <StatCard label="Выходных" value={myStatsData.totalDaysOff} icon={SCHEDULE_STATUS.dayOff.icon} />
            </div>

            <Card padding="none" className="max-w-xl">
              <CardHeader title="Детализация опозданий" as="h3" dense />
              <CardBody padding="none">
                <dl className="divide-y divide-line text-sm">
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <dt className="text-ink-2">Опоздания до часа</dt>
                    <dd className="font-semibold tabular-nums text-warn-text">{myStatsData.totalLateMinor}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <dt className="text-ink-2">Опоздания больше часа</dt>
                    <dd className="font-semibold tabular-nums text-bad-text">{myStatsData.totalLateMajor}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <dt className="text-ink-2">Среднее опоздание</dt>
                    <dd className="font-semibold tabular-nums text-ink">{myStatsData.avgLateMinutes} мин</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          </div>
        ) : null}
      </TabPanel>

      {/* Рейтинг посещаемости */}
      <TabPanel idPrefix="schedule" tabKey="attendance" active={tab === 'attendance'}>
        <AttendanceRatingTab users={scheduleUsers} />
      </TabPanel>

      {/* Настройки */}
      <TabPanel idPrefix="schedule" tabKey="settings" active={tab === 'settings'}>
        <div className="space-y-5">
          <SegmentedControl
            aria-label="Раздел настроек расписания"
            value={settingsTab}
            onChange={setSettingsTab}
            options={[
              { value: 'service', label: 'Режимы работы' },
              { value: 'masters', label: 'Выходные мастеров' },
            ]}
          />

          {settingsTab === 'masters' && <MasterDaysOffCard users={users} />}

          {settingsTab === 'service' && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
              <Card padding="none">
                <CardHeader
                  icon={Clock}
                  title="Режимы работы"
                  subtitle="Шаблоны смен для быстрого заполнения графика"
                />
                {workModesLoading && !workModesData ? (
                  <CardBody>
                    <Skeleton className="h-10 w-full" />
                  </CardBody>
                ) : workModesError && !workModesData ? (
                  <CardBody>
                    <ErrorRow
                      message="Не удалось загрузить режимы работы"
                      onRetry={() => refetchWorkModes()}
                      loading={workModesFetching}
                    />
                  </CardBody>
                ) : workModes.length > 0 ? (
                  <ul className="divide-y divide-line">
                    {workModes.map((wm) => (
                      <li key={wm.id} className="flex items-center gap-3 px-5 py-3">
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
                          <Clock className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{wm.name}</p>
                          <p className="text-xs tabular-nums text-ink-3">
                            {wm.shiftStart} — {wm.shiftEnd}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    compact
                    icon={Clock}
                    title="Нет режимов работы"
                    description="Создайте первый режим ниже"
                  />
                )}
                <CardFooter className="block">
                  <WorkModeForm
                    onSubmit={(data) => createWorkModeMutation.mutate(data)}
                    saving={createWorkModeMutation.isPending}
                  />
                </CardFooter>
              </Card>

              {workModes.length > 0 && <ApplyWorkModeCard workModes={workModes} users={users} />}
            </div>
          )}
        </div>
      </TabPanel>

      {/* Позиция мастера в списке */}
      <Modal
        isOpen={!!reorderDialog}
        onClose={() => setReorderDialog(null)}
        title="Позиция в списке"
        description={reorderDialog?.name}
        size="sm"
        footer={
          <Button variant="secondary" onClick={() => setReorderDialog(null)}>
            Отмена
          </Button>
        }
      >
        {reorderDialog && (
          <ul className="-mx-2 max-h-[50vh] overflow-y-auto">
            {scheduleUsers
              .filter((item) => {
                const target = scheduleUsers.find((u) => u.id === reorderDialog.userId);
                return !!target && directionGroupId(item) === directionGroupId(target);
              })
              .map((_, idx) => {
                const current = idx === reorderDialog.currentIndex;
                return (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() => moveMasterToPosition(reorderDialog.userId, idx)}
                      disabled={current || updateOrderMutation.isPending}
                      aria-current={current ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-ring',
                        current ? 'bg-accent-soft font-medium text-accent-text' : 'text-ink hover:bg-surface-3',
                      )}
                    >
                      <span className="w-6 text-xs font-semibold tabular-nums text-ink-3">{idx + 1}</span>
                      <span className="flex-1">{current ? 'Текущая позиция' : `Переместить на ${idx + 1}`}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
      </Modal>

      {/* Быстрый выбор статуса дня */}
      <Modal
        isOpen={!!quickPopup}
        onClose={() => setQuickPopup(null)}
        title={quickUser?.fullName ?? 'Статус дня'}
        description={quickPopup ? quickPopup.date.split('-').reverse().join('.') : undefined}
        size="sm"
        footer={
          quickPopup?.entry ? (
            <>
              <Button
                variant="ghost"
                icon={Trash2}
                className="mr-auto text-bad-text hover:text-bad-text"
                onClick={() => {
                  if (quickPopup.entry) setDeleteId(quickPopup.entry.id);
                  setQuickPopup(null);
                }}
              >
                Удалить запись
              </Button>
              <Button variant="secondary" onClick={() => setQuickPopup(null)}>
                Отмена
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setQuickPopup(null)}>
              Отмена
            </Button>
          )
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {QUICK_STATUSES.map((item) => {
            const def = SCHEDULE_STATUS[item.kind];
            const Icon = def.icon;
            return (
              <button
                key={item.status}
                type="button"
                onClick={() => quickSetStatus(item.status)}
                className="flex flex-col items-center gap-2 rounded-lg border border-line px-2 py-3 text-center transition-colors hover:border-line-strong hover:bg-surface-2 focus-ring"
              >
                <span
                  className={cn('flex h-9 w-9 items-center justify-center rounded-lg border', def.cell)}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-medium leading-tight text-ink">{item.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-3">
          Изменение попадёт в список несохранённых — примените их одной кнопкой.
        </p>
      </Modal>

      {/* Создание / редактирование записи */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingEntry ? 'Редактировать запись' : 'Новая запись расписания'}
        size="md"
        footer={
          <>
            {editingEntry && (
              <Button
                variant="ghost"
                icon={Trash2}
                className="mr-auto text-bad-text hover:text-bad-text"
                onClick={() => {
                  setDeleteId(editingEntry.id);
                  closeModal();
                }}
              >
                Удалить
              </Button>
            )}
            <Button variant="secondary" onClick={closeModal} disabled={isSaving}>
              Отмена
            </Button>
            <Button type="submit" form={formId} loading={isSaving}>
              {editingEntry ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <Field label="Сотрудник" htmlFor={`${formId}-user`} required>
            <Select
              id={`${formId}-user`}
              value={entryForm.userId}
              onChange={(e) => setEntryForm({ ...entryForm, userId: e.target.value })}
              placeholder="Выберите сотрудника"
              options={users.filter((u) => u.isActive).map((u) => ({ value: u.id, label: u.fullName }))}
              required
            />
          </Field>
          <Field label="Дата" htmlFor={`${formId}-date`} required>
            <Input
              id={`${formId}-date`}
              type="date"
              value={entryForm.date}
              onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })}
              required
            />
          </Field>
          <Field label="Тип">
            <SegmentedControl
              aria-label="Тип записи"
              fullWidth
              value={entryForm.isSickDay ? 'sick' : entryForm.isDayOff ? 'dayoff' : 'shift'}
              onChange={(v) => setEntryForm({ ...entryForm, isDayOff: v === 'dayoff', isSickDay: v === 'sick' })}
              options={[
                { value: 'shift', label: 'Смена', icon: SCHEDULE_STATUS.planned.icon },
                { value: 'dayoff', label: 'Выходной', icon: SCHEDULE_STATUS.dayOff.icon },
                { value: 'sick', label: 'Больничный', icon: SCHEDULE_STATUS.sick.icon },
              ]}
            />
          </Field>
          {!entryForm.isDayOff && !entryForm.isSickDay && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Начало" htmlFor={`${formId}-start`}>
                <Input
                  id={`${formId}-start`}
                  type="time"
                  value={entryForm.shiftStart}
                  onChange={(e) => setEntryForm({ ...entryForm, shiftStart: e.target.value })}
                />
              </Field>
              <Field label="Конец" htmlFor={`${formId}-end`}>
                <Input
                  id={`${formId}-end`}
                  type="time"
                  value={entryForm.shiftEnd}
                  onChange={(e) => setEntryForm({ ...entryForm, shiftEnd: e.target.value })}
                />
              </Field>
            </div>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Удалить запись"
        message="Удалить эту запись расписания? Действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Форма нового режима работы
// ---------------------------------------------------------------------------
function WorkModeForm({
  onSubmit,
  saving,
}: {
  onSubmit: (data: { name: string; shiftStart: string; shiftEnd: string }) => void;
  saving: boolean;
}) {
  const idBase = useId();
  const [name, setName] = useState('');
  const [shiftStart, setShiftStart] = useState('09:00');
  const [shiftEnd, setShiftEnd] = useState('19:00');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), shiftStart, shiftEnd });
    setName('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="Новый режим" htmlFor={`${idBase}-name`} className="min-w-0 flex-1">
        <Input
          id={`${idBase}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название режима"
          required
        />
      </Field>
      <div className="flex gap-3">
        <Field label="Начало" htmlFor={`${idBase}-start`}>
          <Input
            id={`${idBase}-start`}
            type="time"
            value={shiftStart}
            onChange={(e) => setShiftStart(e.target.value)}
            className="w-28"
          />
        </Field>
        <Field label="Конец" htmlFor={`${idBase}-end`}>
          <Input
            id={`${idBase}-end`}
            type="time"
            value={shiftEnd}
            onChange={(e) => setShiftEnd(e.target.value)}
            className="w-28"
          />
        </Field>
      </div>
      <Button type="submit" variant="secondary" icon={Plus} loading={saving} className="sm:mb-0">
        Добавить
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Выходные дни мастеров
// ---------------------------------------------------------------------------
function MasterDaysOffCard({ users }: { users: User[] }) {
  const queryClient = useQueryClient();
  const activeUsers = users.filter((u) => u.isActive && u.role === 'master');

  const updateMutation = useMutation({
    mutationFn: ({ userId, daysOff }: { userId: string; daysOff: number[] }) =>
      usersApi.update(userId, { daysOff } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Выходные обновлены');
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Ошибка сохранения'),
  });

  const toggleDay = (user: User, day: number) => {
    const current = user.daysOff || [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    updateMutation.mutate({ userId: user.id, daysOff: next });
  };

  if (activeUsers.length === 0) {
    return <EmptyState icon={Users} title="Нет мастеров" description="Выходные настраиваются только мастерам" />;
  }

  return (
    <Card padding="none" className="max-w-3xl">
      <CardHeader
        title="Выходные дни мастеров"
        subtitle="Будущие даты обновятся автоматически, прошедшие останутся без изменений"
      />
      <ul className="divide-y divide-line">
        {activeUsers.map((u) => {
          const offDays = u.daysOff || [];
          const offLabel = [...offDays]
            .sort((a, b) => ORDERED_DAYS.indexOf(a) - ORDERED_DAYS.indexOf(b))
            .map((d) => DAY_ABBR[d])
            .join(', ');
          return (
            <li key={u.id} className="px-5 py-4">
              <div className="mb-3 flex items-center gap-3">
                <UserAvatar name={u.fullName} src={u.avatar} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{u.fullName}</p>
                  <p className="text-xs text-ink-3">{offDays.length > 0 ? `Выходные: ${offLabel}` : 'Без выходных'}</p>
                </div>
              </div>
              <div className="flex gap-1.5" role="group" aria-label={`Выходные дни: ${u.fullName}`}>
                {ORDERED_DAYS.map((day) => {
                  const isOff = offDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(u, day)}
                      disabled={updateMutation.isPending}
                      aria-pressed={isOff}
                      className={cn(
                        'h-9 flex-1 rounded-lg text-xs font-semibold transition-colors focus-ring disabled:opacity-50',
                        isOff ? 'bg-accent text-white hover:bg-accent-hover' : 'bg-surface-3 text-ink-2 hover:bg-line',
                      )}
                    >
                      {DAY_ABBR[day]}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Применить режим работы на период
// ---------------------------------------------------------------------------
function ApplyWorkModeCard({ workModes, users }: { workModes: WorkMode[]; users: User[] }) {
  const queryClient = useQueryClient();
  const idBase = useId();
  const [selectedMode, setSelectedMode] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [applyFrom, setApplyFrom] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [applyTo, setApplyTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const applyMutation = useMutation({
    mutationFn: (data: { workModeId: string; userId?: string; dateFrom: string; dateTo: string }) =>
      scheduleApi.applyWorkMode(data),
    onSuccess: (res: any) => {
      void invalidateAttendanceQueries(queryClient);
      toast.success(`График применён (записей: ${res.data?.created || 0})`);
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err) ?? 'Ошибка при применении графика'),
  });

  const handleApply = () => {
    if (!selectedMode) {
      toast.error('Выберите режим работы');
      return;
    }
    if (!applyFrom || !applyTo) {
      toast.error('Укажите период');
      return;
    }
    applyMutation.mutate({
      workModeId: selectedMode,
      userId: selectedUser || undefined,
      dateFrom: applyFrom,
      dateTo: applyTo,
    });
  };

  const activeUsers = users.filter((u) => u.isActive && u.role === 'master');

  return (
    <Card padding="none">
      <CardHeader icon={CalendarDays} title="Применить график" subtitle="Заполнить смены по режиму на период" />
      <CardBody className="space-y-4">
        <Field label="Режим работы" htmlFor={`${idBase}-mode`} required>
          <Select
            id={`${idBase}-mode`}
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
            placeholder="Выберите режим"
            options={workModes.map((wm) => ({ value: wm.id, label: `${wm.name} (${wm.shiftStart}–${wm.shiftEnd})` }))}
          />
        </Field>
        <Field label="Сотрудник" htmlFor={`${idBase}-user`}>
          <Select
            id={`${idBase}-user`}
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            placeholder="Все мастера"
            options={activeUsers.map((u) => ({ value: u.id, label: u.fullName }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="С" htmlFor={`${idBase}-from`}>
            <Input id={`${idBase}-from`} type="date" value={applyFrom} onChange={(e) => setApplyFrom(e.target.value)} />
          </Field>
          <Field label="По" htmlFor={`${idBase}-to`}>
            <Input id={`${idBase}-to`} type="date" value={applyTo} onChange={(e) => setApplyTo(e.target.value)} />
          </Field>
        </div>
      </CardBody>
      <CardFooter>
        <span className="text-xs text-ink-3">Существующие записи в периоде будут перезаписаны режимом</span>
        <Button onClick={handleApply} loading={applyMutation.isPending}>
          Применить
        </Button>
      </CardFooter>
    </Card>
  );
}
