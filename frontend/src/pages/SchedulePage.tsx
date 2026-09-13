import { useState, useMemo, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Clock,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Users,
  BarChart3,
  Trophy,
  TrendingUp,
  Medal,
  Settings,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  format,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  addDays,
  isToday,
  getDay,
} from 'date-fns';
import { ru } from 'date-fns/locale';

import { calculateAttendanceStats, attendanceScore, emptyBreakdown } from '../../../shared/utils/attendance';
import { scheduleApi, usersApi } from '../api/services';
import { ScheduleEntry, TodayEmployeeStatus, User } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import { formatDayKey } from '../../../shared/utils/formatters';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import InlineLoader from '../components/InlineLoader';
import EmptyState from '../components/EmptyState';

type TabType = 'schedule' | 'today' | 'mystats' | 'attendance' | 'settings';

// Correct Russian day abbreviations (date-fns 'EE' locale gives wrong 2-char prefix for Сб)
const DAY_ABBR = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function AttendanceRatingTab({
  entries,
  users,
  dateFrom,
  dateTo,
}: {
  entries: ScheduleEntry[];
  users: User[];
  dateFrom: string;
  dateTo: string;
}) {
  // Месяц рейтинга — текущий У АВТОСЕРВИСА (157): выборка смен уезжает на
  // сервер границами месяца, а он режет сутки поясом тенанта. По часам браузера
  // в ночь на 1-е число вкладка открывалась в пустом следующем месяце.
  const { month: tenantMonth } = useTenantCalendar();
  const [selectedMonth, setSelectedMonth] = useState(tenantMonth);

  const queryClient = useQueryClient();

  // Fetch entries for selected month
  const monthStart = `${selectedMonth}-01`;
  const monthEnd = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  })();

  const { data: monthEntries } = useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', monthStart, monthEnd],
    queryFn: async () => {
      const res = await scheduleApi.getAll({ dateFrom: monthStart, dateTo: monthEnd });
      return res.data as ScheduleEntry[];
    },
  });

  const allEntries = monthEntries ?? entries;

  // Which row is expanded to show the day-by-day breakdown
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Compute stats per user via SHARED utility — same logic everywhere.
  const stats = useMemo(() => calculateAttendanceStats(allEntries as any), [allEntries]);

  // Rank users by attendance score
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
  };

  const monthLabel = (() => {
    const [y, m] = selectedMonth.split('-');
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  })();

  return (
    <div className="space-y-4">
      {/* Month picker */}
      <div className="flex items-center justify-center gap-3">
        <button
          aria-label="Предыдущий месяц"
          onClick={() => shiftMonth(-1)}
          className="p-2 rounded-lg hover:bg-gray-100"
        >
          <ChevronLeft className="h-5 w-5 text-gray-500" />
        </button>
        <span className="text-sm font-bold text-gray-900 capitalize min-w-[150px] text-center">{monthLabel}</span>
        <button aria-label="Следующий месяц" onClick={() => shiftMonth(1)} className="p-2 rounded-lg hover:bg-gray-100">
          <ChevronRight className="h-5 w-5 text-gray-500" />
        </button>
      </div>

      {/* Ranking */}
      <div className="space-y-2">
        {ranked.map((u, idx) => {
          const s = u.stats;
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
          const scoreColor = u.score >= 90 ? 'text-green-600' : u.score >= 70 ? 'text-yellow-600' : 'text-red-600';
          const scoreBg = u.score >= 90 ? 'bg-green-50' : u.score >= 70 ? 'bg-yellow-50' : 'bg-red-50';

          const isExpanded = expandedUserId === u.id;
          const fmtDate = (d: string) => {
            const [, m, day] = d.split('-');
            return `${parseInt(day)}.${m}`;
          };
          return (
            <div
              key={u.id}
              className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${idx < 3 ? 'ring-1 ring-amber-200' : ''}`}
            >
              <button
                type="button"
                onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {/* Rank */}
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      idx === 0
                        ? 'bg-amber-100 text-amber-700'
                        : idx === 1
                          ? 'bg-gray-200 text-gray-700'
                          : idx === 2
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-50 text-gray-400'
                    }`}
                  >
                    {medal || idx + 1}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{u.fullName}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                        ✅ {s.full}
                      </span>
                      {s.lateMinor > 0 && (
                        <span className="text-[10px] bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium">
                          ⏰ {s.lateMinor}
                        </span>
                      )}
                      {s.lateMajor > 0 && (
                        <span className="text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">
                          ⚠️ {s.lateMajor}
                        </span>
                      )}
                      {s.absent > 0 && (
                        <span className="text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                          ❌ {s.absent}
                        </span>
                      )}
                      {s.sick > 0 && (
                        <span className="text-[10px] bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded-full font-medium">
                          🏥 {s.sick}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Score */}
                  <div className={`flex-shrink-0 ${scoreBg} rounded-xl px-3 py-1.5 text-center`}>
                    <p className={`text-lg font-bold ${scoreColor}`}>{u.score}%</p>
                    <p className="text-[9px] text-gray-400">посещ.</p>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                </div>

                {/* Progress bar */}
                {s.total > 0 && (
                  <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden flex">
                    {s.full > 0 && (
                      <div className="bg-green-500 h-full" style={{ width: `${(s.full / s.total) * 100}%` }} />
                    )}
                    {s.lateMinor > 0 && (
                      <div className="bg-yellow-400 h-full" style={{ width: `${(s.lateMinor / s.total) * 100}%` }} />
                    )}
                    {s.lateMajor > 0 && (
                      <div className="bg-orange-500 h-full" style={{ width: `${(s.lateMajor / s.total) * 100}%` }} />
                    )}
                    {s.absent > 0 && (
                      <div className="bg-red-500 h-full" style={{ width: `${(s.absent / s.total) * 100}%` }} />
                    )}
                  </div>
                )}
              </button>

              {/* Expandable breakdown — shows EXACTLY which dates count where */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-2 text-xs">
                  {s.fullDates.length > 0 && (
                    <div>
                      <span className="font-semibold text-green-700">✅ Полная смена ({s.full}): </span>
                      <span className="text-gray-600">{s.fullDates.map(fmtDate).join(', ')}</span>
                    </div>
                  )}
                  {s.lateMinorDates.length > 0 && (
                    <div>
                      <span className="font-semibold text-yellow-700">⏰ Опоздал &lt;1ч ({s.lateMinor}): </span>
                      <span className="text-gray-600">{s.lateMinorDates.map(fmtDate).join(', ')}</span>
                    </div>
                  )}
                  {s.lateMajorDates.length > 0 && (
                    <div>
                      <span className="font-semibold text-orange-700">⚠️ Опоздал &gt;1ч ({s.lateMajor}): </span>
                      <span className="text-gray-600">{s.lateMajorDates.map(fmtDate).join(', ')}</span>
                    </div>
                  )}
                  {s.absentDates.length > 0 && (
                    <div>
                      <span className="font-semibold text-red-700">❌ Прогул ({s.absent}): </span>
                      <span className="text-gray-600">{s.absentDates.map(fmtDate).join(', ')}</span>
                    </div>
                  )}
                  {s.sickDates.length > 0 && (
                    <div>
                      <span className="font-semibold text-rose-700">🏥 Больничный ({s.sick}): </span>
                      <span className="text-gray-600">{s.sickDates.map(fmtDate).join(', ')}</span>
                    </div>
                  )}
                  {s.dayOffDates.length > 0 && (
                    <div>
                      <span className="font-semibold text-gray-500">🌙 Выходной ({s.dayOff}): </span>
                      <span className="text-gray-600">{s.dayOffDates.map(fmtDate).join(', ')}</span>
                    </div>
                  )}
                  {s.total === 0 && s.sick === 0 && s.dayOff === 0 && (
                    <p className="text-gray-400 text-center">Нет данных за этот месяц</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
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

  const [tab, setTab] = useState<TabType>('schedule');

  // Стартовый месяц — текущий У АВТОСЕРВИСА: в ночь на 1-е число график по
  // часам браузера открывался уже в следующем месяце (пустая сетка).
  const [currentMonth, setCurrentMonth] = useState(tenantMonthStart);

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

  // Settings tab state
  const [settingsTab, setSettingsTab] = useState<'service' | 'masters'>('service');

  // Queries — queryFn returns plain data (NOT AxiosResponse) so setQueryData works
  const {
    data: scheduleData,
    isLoading: scheduleLoading,
    refetch: refetchSchedule,
  } = useQuery({
    queryKey: ['schedule', dateFrom, dateTo],
    queryFn: async () => {
      const res = await scheduleApi.getAll({ dateFrom, dateTo });
      return res.data as ScheduleEntry[];
    },
  });

  const { data: todayData, isLoading: todayLoading } = useQuery({
    queryKey: ['schedule-today'],
    queryFn: async () => {
      const res = await scheduleApi.getToday();
      return res.data as TodayEmployeeStatus[];
    },
    enabled: tab === 'today',
  });

  const { data: myStatsData } = useQuery({
    queryKey: ['my-schedule-stats'],
    queryFn: () => scheduleApi.getMyStats(),
    select: (res) =>
      res.data as {
        totalScheduled: number;
        totalWorked: number;
        totalLate: number;
        totalLateMinor: number;
        totalLateMajor: number;
        totalOnTime: number;
        totalDaysOff: number;
        avgLateMinutes: number;
      },
    enabled: tab === 'mystats',
  });

  // Команда ТЕКУЩЕГО филиала (167): строки сетки — сотрудники этого
  // автосервиса (назначенные на него + не назначенные никуда), а дни строк
  // сервер отдаёт только этого филиала. Ключ под префиксом ['users'], чтобы
  // инвалидации справочника сотрудников дёргали и его.
  const { data: usersData } = useQuery({
    queryKey: ['users', 'point'],
    queryFn: () => usersApi.getAll({ scope: 'point' }),
    select: (res) => res.data as User[],
  });

  const entries = scheduleData ?? [];
  const todayStatuses = todayData ?? [];
  const users = usersData ?? [];

  // Days of the current month
  const monthDays = useMemo(() => {
    try {
      return eachDayOfInterval({ start: monthStart, end: monthEnd });
    } catch {
      return [];
    }
  }, [dateFrom, dateTo]);

  const scheduleQueryKey = ['schedule', dateFrom, dateTo];

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
      const prev = queryClient.getQueryData<any>(['users', 'point']);
      queryClient.setQueryData<any>(['users', 'point'], (old: any) => {
        if (!old?.data) return old;
        const byId = new Map(old.data.map((u: any) => [u.id, u]));
        const reordered = orderedIds
          .map((id, i) => {
            const u = byId.get(id);
            return u ? { ...u, sortOrder: i } : null;
          })
          .filter(Boolean);
        // Add any users not in orderedIds (new users)
        const remaining = old.data.filter((u: any) => !orderedIds.includes(u.id));
        return { ...old, data: [...reordered, ...remaining] };
      });
      return prev;
    },
    onError: (_e, _v, ctx) => {
      if (ctx) queryClient.setQueryData(['users', 'point'], ctx);
      toast.error('Не сохранено: порядок мастеров не изменён');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const moveMaster = (userId: string, direction: 'up' | 'down') => {
    const current = scheduleUsers.map((u) => u.id);
    const idx = current.indexOf(userId);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? Math.max(0, idx - 1) : Math.min(current.length - 1, idx + 1);
    if (idx === newIdx) return;
    const reordered = [...current];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    updateOrderMutation.mutate(reordered);
  };

  const moveMasterToPosition = (userId: string, newPos: number) => {
    const current = scheduleUsers.map((u) => u.id);
    const idx = current.indexOf(userId);
    if (idx < 0 || idx === newPos) return;
    const reordered = current.filter((id) => id !== userId);
    reordered.splice(newPos, 0, userId);
    updateOrderMutation.mutate(reordered);
    setReorderDialog(null);
  };

  // All active users — use users list as primary source, supplement with entry users
  const scheduleUsers = useMemo(() => {
    // Include masters AND admins — both work on shifts and appear in schedule.
    // Exclude only director/superadmin (management, not shift workers).
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
      const ao = (a as any).sortOrder ?? 0;
      const bo = (b as any).sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.fullName.localeCompare(b.fullName);
    });

    return activeUsers;
  }, [entries, users]);

  // Month navigation
  const goToPrevMonth = useCallback(() => setCurrentMonth((m) => subMonths(m, 1)), []);
  const goToNextMonth = useCallback(() => setCurrentMonth((m) => addMonths(m, 1)), []);
  const goToToday = useCallback(() => setCurrentMonth(tenantMonthStart), [tenantMonthStart]);

  // Instant cache update — mutates React Query cache directly
  const patchCache = (userId: string, date: string, changes: Partial<ScheduleEntry>, isNew: boolean) => {
    queryClient.setQueryData<ScheduleEntry[]>(scheduleQueryKey, (old) => {
      if (!old) return old;
      if (isNew) {
        return [
          ...old,
          {
            id: `t-${Date.now()}`,
            tenantId: '',
            userId,
            date,
            shiftStart: '09:00',
            shiftEnd: '18:00',
            isDayOff: false,
            lateMinutes: 0,
            isManualOverride: false,
            ...changes,
          } as ScheduleEntry,
        ];
      }
      return old.map((e) =>
        e.userId === userId && String(e.date || '').slice(0, 10) === date ? { ...e, ...changes } : e,
      );
    });
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => scheduleApi.create(data),
    onSuccess: () => {
      // Delayed refetch — let server process first, patched cache is already showing
      setTimeout(() => {
        refetchSchedule();
        queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      }, 1500);
      closeModal();
    },
    onError: () => {
      refetchSchedule();
      toast.error('Ошибка');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => scheduleApi.update(id, data),
    onSuccess: () => {
      setTimeout(() => {
        refetchSchedule();
        queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      }, 1500);
      closeModal();
    },
    onError: () => {
      refetchSchedule();
      toast.error('Ошибка');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduleApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      toast.success('Запись удалена');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка удаления');
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

  const openEdit = (entry: ScheduleEntry) => {
    if (!canEdit) return;
    setEditingEntry(entry);
    const isSick = (entry.note || '').toLowerCase().includes('больнич');
    setEntryForm({
      userId: entry.userId,
      date: String(entry.date || '').slice(0, 10),
      shiftStart: entry.shiftStart || '09:00',
      shiftEnd: entry.shiftEnd || '18:00',
      isDayOff: entry.isDayOff && !isSick,
      isSickDay: isSick,
      note: entry.note || '',
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
  const { data: workModesData } = useQuery({
    queryKey: ['work-modes'],
    queryFn: () => scheduleApi.getWorkModes(),
    select: (res) => res.data,
    enabled: tab === 'settings',
  });
  const workModes = workModesData ?? [];

  const createWorkModeMutation = useMutation({
    mutationFn: (data: any) => scheduleApi.createWorkMode(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-modes'] });
      toast.success('Режим работы создан');
    },
  });

  const updateWorkModeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => scheduleApi.updateWorkMode(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-modes'] });
      toast.success('Режим обновлён');
    },
  });

  // Quick status change — directly creates/updates entry without opening modal
  const quickSetStatus = (status: 'shift' | 'dayoff' | 'sick' | 'late_minor' | 'late_major' | 'absent' | 'delete') => {
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
    // иначе зарплата считала бы смену раньше, чем она отработана. Раньше здесь
    // стоял фиксированный московский сдвиг — у автосервиса восточнее Москвы
    // «сегодня» на несколько часов считалось будущим.
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

    // When admin marks "arrived on time" or "late", pin actualArrival to the
    // SCHEDULED date, not to current moment. Otherwise clicking "Смена" on a
    // past day records arrival at today's time — which inflates rating counts.
    const shiftStartStr = entry?.shiftStart || '09:00';
    const arrivalForDate = (offsetMin: number) => {
      const [h, m] = shiftStartStr.split(':').map(Number);
      const dt = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
      dt.setMinutes(dt.getMinutes() + offsetMin);
      return dt.toISOString();
    };
    const actualArrival =
      status === 'shift' && !isFutureDay
        ? arrivalForDate(0)
        : status === 'late_minor'
          ? arrivalForDate(15)
          : status === 'late_major'
            ? arrivalForDate(60)
            : null;

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
      actualArrival,
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
    const entries = Object.values(pendingChanges);
    if (entries.length === 0) return;

    const failures: string[] = [];
    for (const change of entries) {
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

    setPendingChanges({});
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
    queryClient.invalidateQueries({ queryKey: ['schedule-today'] });

    if (failures.length === 0) {
      toast.success(`Применено ${entries.length} изм.`);
    } else {
      toast.error(`Ошибок: ${failures.length}`);
    }
  };

  const discardPendingChanges = () => {
    setPendingChanges({});
  };

  // Cell rendering helpers
  const getCellContent = (entry: ScheduleEntry | undefined, dateStr?: string) => {
    if (!entry) return null;
    const note = (entry.note || '').toLowerCase();
    const lateMin = entry.lateMinutes || 0;
    // «Сегодня» и «прошедший день» — по календарю АВТОСЕРВИСА, ровно как
    // isFutureDay выше и как сервер считает отработанные смены (157). По часам
    // браузера подсветка текущего дня уезжала на соседнюю колонку у любого, кто
    // открыл график из другого региона.
    const todayKey = formatDayKey(new Date(), timeZone);
    const isPast = dateStr ? dateStr < todayKey : false;
    const isToday = dateStr === todayKey;

    // Больничный
    if (note.includes('больнич')) {
      return { label: '🏥', bgColor: 'bg-rose-50', textColor: 'text-rose-500', borderColor: 'border-rose-200' };
    }
    // Прогул (из note)
    if (note.includes('прогул')) {
      return { label: '❌', bgColor: 'bg-red-50', textColor: 'text-red-600', borderColor: 'border-red-300' };
    }
    // Выходной
    if (entry.isDayOff) {
      return { label: '🌙', bgColor: 'bg-gray-800', textColor: 'text-white', borderColor: 'border-gray-700' };
    }
    // Опоздание >1ч (восклицательный в треугольнике)
    if (entry.lateStatus === 'late_major' || lateMin >= 60) {
      return { label: '⚠️', bgColor: 'bg-yellow-100', textColor: 'text-yellow-700', borderColor: 'border-yellow-400' };
    }
    // Опоздание <1ч (будильник на жёлтом)
    if (entry.lateStatus === 'late_minor' || (lateMin > 0 && lateMin < 60)) {
      return { label: '⏰', bgColor: 'bg-yellow-50', textColor: 'text-yellow-600', borderColor: 'border-yellow-300' };
    }
    // Открыл смену вовремя — показываем время начала смены зелёным
    if (entry.shiftStart && (entry.actualArrival || entry.lateStatus === 'on_time')) {
      const time = entry.shiftStart?.slice(0, 5) || '✓';
      return { label: time, bgColor: 'bg-green-100', textColor: 'text-green-700', borderColor: 'border-green-300' };
    }
    // Прогул для прошедших дней без смены
    if (entry.shiftStart && !entry.isDayOff && isPast && !isToday) {
      return { label: '❌', bgColor: 'bg-red-50', textColor: 'text-red-600', borderColor: 'border-red-300' };
    }
    // Запланирована смена (сегодня или будущее) — зелёная галочка
    if (entry.shiftStart) {
      return { label: '✓', bgColor: 'bg-green-50', textColor: 'text-green-600', borderColor: 'border-green-200' };
    }
    return null;
  };

  // Today tab helpers
  const getStatusBadge = (status: TodayEmployeeStatus) => {
    if (status.isDayOff)
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-900 text-white">
          Выходной
        </span>
      );
    if (!status.hasSchedule)
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">
          Нет расписания
        </span>
      );
    if (status.lateStatus === 'late_major')
      return (
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">
          Опоздание &gt;1ч
        </span>
      );
    if (status.lateStatus === 'late_minor')
      return (
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700">
          Опоздание &lt;1ч
        </span>
      );
    if (status.isWorking)
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
          На смене
        </span>
      );
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
        Прогул
      </span>
    );
  };

  const getStatusIcon = (status: TodayEmployeeStatus) => {
    if (status.isDayOff) return <XCircle className="w-5 h-5 text-gray-900" />;
    if (status.lateStatus === 'late_major') return <AlertTriangle className="w-5 h-5 text-orange-500" />;
    if (status.lateStatus === 'late_minor') return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    if (status.isWorking) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    if (status.hasSchedule) return <XCircle className="w-5 h-5 text-red-500" />;
    return <Clock className="w-5 h-5 text-gray-400" />;
  };

  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Расписание</h1>
        {canEdit && (
          <button onClick={() => openCreate()} className="btn-primary">
            <Plus className="w-4 h-4" />
            Добавить
          </button>
        )}
      </div>

      {/* Pending changes Apply bar */}
      {Object.keys(pendingChanges).length > 0 && (
        <div className="sticky top-0 z-40 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-semibold text-amber-800">
              Несохранённых изменений: {Object.keys(pendingChanges).length}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={discardPendingChanges}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Отмена
            </button>
            <button
              onClick={applyPendingChanges}
              className="text-xs font-bold bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700"
            >
              Применить
            </button>
          </div>
        </div>
      )}

      {/* Tabs — icon-first on mobile, icon+label on desktop */}
      <div className="mb-5 bg-gray-100 rounded-2xl p-1 flex items-center gap-0.5">
        {(
          [
            { key: 'schedule', label: 'График', icon: CalendarDays },
            { key: 'today', label: 'Сегодня', icon: Clock },
            { key: 'mystats', label: 'Смены', icon: Users },
            { key: 'attendance', label: 'Рейтинг', icon: BarChart3 },
            ...(canEdit ? [{ key: 'settings' as const, label: 'Настр.', icon: Settings }] : []),
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const active = tab === (t.key as TabType);
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key as TabType)}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl transition-all ${
                active ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" />
              <span className="text-[10px] font-semibold leading-none truncate max-w-full">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Schedule Tab - Grid: rows=employees, columns=dates */}
      {tab === 'schedule' && (
        <div>
          {/* Month Navigation */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3">
              <div className="flex items-center justify-between">
                <button
                  aria-label="Предыдущий месяц"
                  onClick={goToPrevMonth}
                  className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-all duration-200 active:scale-95"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-center">
                  <h2 className="text-white font-semibold text-lg capitalize">
                    {format(currentMonth, 'LLLL yyyy', { locale: ru })}
                  </h2>
                  {format(currentMonth, 'yyyy-MM') !== tenantMonth && (
                    <button
                      onClick={goToToday}
                      className="text-white/80 hover:text-white text-[10px] mt-0.5 transition-colors underline decoration-white/40"
                    >
                      К текущему
                    </button>
                  )}
                </div>
                <button
                  aria-label="Следующий месяц"
                  onClick={goToNextMonth}
                  className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-all duration-200 active:scale-95"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-5 h-5 rounded bg-green-50 border border-green-200 flex items-center justify-center text-[10px]">
                    ✓
                  </span>
                  Смена
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-5 h-5 rounded bg-gray-800 border border-gray-700 flex items-center justify-center text-[10px]">
                    🌙
                  </span>
                  Вых
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-5 h-5 rounded bg-rose-50 border border-rose-200 flex items-center justify-center text-[10px]">
                    🏥
                  </span>
                  Б/Л
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-5 h-5 rounded bg-yellow-50 border border-yellow-300 flex items-center justify-center text-[10px]">
                    ⏰
                  </span>
                  &lt;1ч
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-5 h-5 rounded bg-orange-50 border border-orange-300 flex items-center justify-center text-[10px]">
                    ⚠️
                  </span>
                  &gt;1ч
                </span>
              </div>
            </div>

            {scheduleLoading ? (
              <InlineLoader />
            ) : scheduleUsers.length === 0 ? (
              <div className="py-16">
                <EmptyState
                  icon={Users}
                  title="Нет сотрудников"
                  description="Добавьте сотрудников для составления расписания"
                />
              </div>
            ) : (
              /* Grid Table — horizontal scroll on mobile */
              <div className="relative">
                <div className="flex">
                  {/* Sticky employee names column */}
                  <div className="flex-shrink-0 sticky left-0 z-10 bg-white border-r border-gray-200">
                    {/* Corner header */}
                    <div className="h-10 border-b border-gray-200 bg-gray-50 px-3 flex items-center">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase">Сотрудник</span>
                    </div>
                    {/* Employee rows — fixed height, no wrapping */}
                    {scheduleUsers.map((u, idx) => (
                      <div
                        key={u.id}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          canEdit && setReorderDialog({ userId: u.id, name: u.fullName, currentIndex: idx })
                        }
                        onKeyDown={(e) =>
                          e.key === 'Enter' &&
                          canEdit &&
                          setReorderDialog({ userId: u.id, name: u.fullName, currentIndex: idx })
                        }
                        className="h-12 min-h-[48px] max-h-[48px] border-b border-gray-50 px-3 flex items-center gap-2 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer"
                      >
                        <span className="text-[10px] font-bold text-gray-300 w-5 flex-shrink-0">{idx + 1}</span>
                        <span className="text-xs font-medium text-gray-800 truncate flex-1">{u.fullName}</span>
                      </div>
                    ))}
                  </div>

                  {/* Scrollable dates area */}
                  <div className="overflow-x-auto flex-1" ref={scrollRef}>
                    <div style={{ minWidth: `${monthDays.length * 44}px` }}>
                      {/* Date headers */}
                      <div className="flex border-b border-gray-200 bg-gray-50">
                        {monthDays.map((day) => {
                          const dayOfWeek = getDay(day);
                          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                          const isTodayDate = isToday(day);
                          return (
                            <div
                              key={format(day, 'yyyy-MM-dd')}
                              className={`w-11 flex-shrink-0 h-10 flex flex-col items-center justify-center ${
                                isTodayDate ? 'bg-blue-100' : isWeekend ? 'bg-red-50/50' : ''
                              }`}
                            >
                              <span
                                className={`text-[9px] font-medium ${isWeekend ? 'text-red-400' : 'text-gray-400'}`}
                              >
                                {DAY_ABBR[getDay(day)]}
                              </span>
                              <span
                                className={`text-xs font-bold ${
                                  isTodayDate ? 'text-blue-600' : isWeekend ? 'text-red-500' : 'text-gray-700'
                                }`}
                              >
                                {format(day, 'd')}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Employee schedule rows */}
                      {scheduleUsers.map((u) => (
                        <div key={u.id} className="flex border-b border-gray-50 h-12 min-h-[48px] max-h-[48px]">
                          {monthDays.map((day) => {
                            const dateStr = format(day, 'yyyy-MM-dd');
                            const entry = entryMap[u.id]?.[dateStr];
                            const cellData = getCellContent(entry, dateStr);
                            const dayOfWeek = getDay(day);
                            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                            const isTodayDate = isToday(day);

                            const openCell = () => {
                              if (canEdit) setQuickPopup({ userId: u.id, date: dateStr, entry });
                            };
                            return (
                              <div
                                key={dateStr}
                                {...(canEdit
                                  ? {
                                      role: 'button' as const,
                                      tabIndex: 0,
                                      'aria-label': `${u.fullName}, ${format(day, 'd MMMM', { locale: ru })}`,
                                      onKeyDown: (e: React.KeyboardEvent) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          openCell();
                                        }
                                      },
                                    }
                                  : {})}
                                onClick={openCell}
                                className={`w-11 flex-shrink-0 h-12 flex items-center justify-center border-r border-gray-50 last:border-r-0 transition-colors ${
                                  canEdit ? 'cursor-pointer hover:bg-blue-50/50' : ''
                                } ${isTodayDate ? 'bg-blue-50/40' : isWeekend ? 'bg-red-50/20' : ''}`}
                              >
                                {cellData ? (
                                  <div
                                    className={`w-8 h-8 rounded-lg ${cellData.bgColor} border ${cellData.borderColor} flex items-center justify-center`}
                                  >
                                    <span
                                      className={`${/^[\d:]+$/.test(cellData.label) ? 'text-[10px] font-bold' : 'text-[15px] leading-none'} ${cellData.textColor}`}
                                    >
                                      {cellData.label}
                                    </span>
                                  </div>
                                ) : !isWeekend ? (
                                  <div className="w-8 h-8 rounded-lg bg-green-50/50 border border-green-100 flex items-center justify-center">
                                    <span className="text-[10px] text-green-400">✓</span>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Today Tab */}
      {tab === 'today' && (
        <div>
          {todayLoading ? (
            <InlineLoader />
          ) : todayStatuses.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Нет данных на сегодня"
              description="Расписание на сегодня не настроено"
            />
          ) : (
            <div className="space-y-3">
              {todayStatuses.map((status) => (
                <div
                  key={status.userId}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 transition-all duration-150 hover:shadow-md"
                >
                  <div className="flex-shrink-0">{getStatusIcon(status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{status.fullName}</span>
                      {getStatusBadge(status)}
                    </div>
                    {!status.isDayOff && status.hasSchedule && (
                      <div className="text-sm text-gray-500 mt-1">
                        <span>
                          Смена: {status.shiftStart?.slice(0, 5)} - {status.shiftEnd?.slice(0, 5)}
                        </span>
                        {status.lateMinutes > 0 && (
                          <span className="ml-3 text-red-600">Опоздание: {status.lateMinutes} мин.</span>
                        )}
                        {status.actualArrival && (
                          <span className="ml-3 text-gray-400">Пришёл: {status.actualArrival.slice(0, 5)}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* My Stats Tab */}
      {tab === 'mystats' && (
        <div>
          {myStatsData ? (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Моя статистика за месяц</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-blue-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-blue-700">{myStatsData.totalWorked}</p>
                    <p className="text-xs text-blue-600 mt-1">Рабочих дней</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-green-700">{myStatsData.totalOnTime}</p>
                    <p className="text-xs text-green-600 mt-1">Вовремя</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-red-700">{myStatsData.totalLate}</p>
                    <p className="text-xs text-red-600 mt-1">Опоздания</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-gray-700">{myStatsData.totalDaysOff}</p>
                    <p className="text-xs text-gray-600 mt-1">Выходные</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Детализация опозданий</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Незначительные опоздания</span>
                    <span className="text-sm font-semibold text-yellow-600">{myStatsData.totalLateMinor}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Серьёзные опоздания</span>
                    <span className="text-sm font-semibold text-red-600">{myStatsData.totalLateMajor}</span>
                  </div>
                  <div className="flex items-center justify-between border-t pt-2">
                    <span className="text-sm text-gray-500">Среднее опоздание</span>
                    <span className="text-sm font-semibold text-gray-900">{myStatsData.avgLateMinutes} мин.</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <InlineLoader />
          )}
        </div>
      )}

      {/* Master reorder dialog */}
      {reorderDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setReorderDialog(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xs max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-2 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-900 text-center">Позиция мастера</p>
              <p className="text-xs text-gray-400 text-center truncate">{reorderDialog.name}</p>
            </div>
            <div className="overflow-y-auto py-1">
              {scheduleUsers.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => moveMasterToPosition(reorderDialog.userId, idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                    idx === reorderDialog.currentIndex
                      ? 'bg-primary-50 text-primary-700 font-semibold'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="w-6 text-[11px] font-bold text-gray-400">{idx + 1}</span>
                  <span className="flex-1">
                    {idx === reorderDialog.currentIndex ? '— текущая позиция —' : `Переместить на ${idx + 1}`}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setReorderDialog(null)}
              className="w-full text-center py-3 text-xs font-medium text-gray-500 border-t border-gray-100"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Quick Status Popup — centered */}
      {quickPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setQuickPopup(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[280px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-2">
              <p className="text-sm font-bold text-gray-900 text-center">
                {users.find((u) => u.id === quickPopup.userId)?.fullName}
              </p>
              <p className="text-xs text-gray-400 text-center">{quickPopup.date.split('-').reverse().join('.')}</p>
            </div>
            <div className="px-3 pb-4 grid grid-cols-3 gap-1.5">
              {[
                { status: 'shift' as const, emoji: '✅', label: 'Смена', bg: 'bg-green-50 active:bg-green-100' },
                { status: 'dayoff' as const, emoji: '🌙', label: 'Выходной', bg: 'bg-gray-50 active:bg-gray-200' },
                { status: 'sick' as const, emoji: '🏥', label: 'Больничный', bg: 'bg-rose-50 active:bg-rose-100' },
                { status: 'late_minor' as const, emoji: '⏰', label: '<1ч', bg: 'bg-yellow-50 active:bg-yellow-100' },
                { status: 'late_major' as const, emoji: '⚠️', label: '>1ч', bg: 'bg-orange-50 active:bg-orange-100' },
                { status: 'absent' as const, emoji: '❌', label: 'Прогул', bg: 'bg-red-50 active:bg-red-100' },
              ].map((item) => (
                <button
                  key={item.status}
                  onClick={() => quickSetStatus(item.status)}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl ${item.bg} transition-colors`}
                >
                  <span className="text-xl">{item.emoji}</span>
                  <span className="text-[10px] font-semibold text-gray-700">{item.label}</span>
                </button>
              ))}
            </div>
            {quickPopup.entry && (
              <button
                onClick={() => {
                  if (quickPopup.entry) setDeleteId(quickPopup.entry.id);
                  setQuickPopup(null);
                }}
                className="w-full text-center py-3 text-xs font-medium text-red-600 border-t border-gray-100 rounded-b-2xl active:bg-red-50"
              >
                Удалить запись
              </button>
            )}
          </div>
        </div>
      )}

      {/* Attendance Rating Tab */}
      {tab === 'attendance' && (
        <AttendanceRatingTab entries={entries} users={scheduleUsers} dateFrom={dateFrom} dateTo={dateTo} />
      )}

      {/* Settings Tab — Modern Minimalist */}
      {tab === 'settings' && (
        <div className="space-y-5">
          {/* Settings sub-tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setSettingsTab('masters')}
              className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                settingsTab === 'masters'
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              Выходные мастеров
            </button>
            <button
              onClick={() => setSettingsTab('service')}
              className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
                settingsTab === 'service'
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              Режимы работы
            </button>
          </div>

          {/* Master Days Off tab */}
          {settingsTab === 'masters' && <MasterDaysOffCard users={users} />}

          {/* Service Work Modes tab */}
          {settingsTab === 'service' && (
            <div className="space-y-4">
              {/* Work modes list + create */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Режимы работы</h3>
                </div>
                {workModes.length > 0 ? (
                  <div className="divide-y divide-gray-50">
                    {workModes.map((wm: any) => (
                      <div key={wm.id} className="flex items-center justify-between px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                            <Clock className="w-4 h-4 text-blue-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{wm.name}</p>
                            <p className="text-xs text-gray-400">
                              {wm.shiftStart} — {wm.shiftEnd}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-center text-sm text-gray-400">Нет режимов работы</div>
                )}
                <div className="px-5 py-4 bg-gray-50/50 border-t border-gray-100">
                  <WorkModeForm onSubmit={(data: any) => createWorkModeMutation.mutate(data)} />
                </div>
              </div>

              {/* Apply work mode */}
              {workModes.length > 0 && <ApplyWorkModeCard workModes={workModes} users={users} />}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Modal (for + button) */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingEntry ? 'Редактировать запись' : 'Новая запись расписания'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Сотрудник</label>
            <select
              className="input"
              value={entryForm.userId}
              onChange={(e) => setEntryForm({ ...entryForm, userId: e.target.value })}
              required
            >
              <option value="">Выберите сотрудника</option>
              {users
                .filter((u) => u.isActive)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="label">Дата</label>
            <input
              type="date"
              className="input"
              value={entryForm.date}
              onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Тип</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setEntryForm({ ...entryForm, isDayOff: false, isSickDay: false })}
                className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors ${!entryForm.isDayOff && !entryForm.isSickDay ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Смена
              </button>
              <button
                type="button"
                onClick={() => setEntryForm({ ...entryForm, isDayOff: true, isSickDay: false })}
                className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors ${entryForm.isDayOff && !entryForm.isSickDay ? 'border-gray-500 bg-gray-100 text-gray-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Выходной
              </button>
              <button
                type="button"
                onClick={() => setEntryForm({ ...entryForm, isDayOff: false, isSickDay: true })}
                className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors ${entryForm.isSickDay ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Больничный
              </button>
            </div>
          </div>
          {!entryForm.isDayOff && !entryForm.isSickDay && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Начало</label>
                <input
                  type="time"
                  className="input"
                  value={entryForm.shiftStart}
                  onChange={(e) => setEntryForm({ ...entryForm, shiftStart: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Конец</label>
                <input
                  type="time"
                  className="input"
                  value={entryForm.shiftEnd}
                  onChange={(e) => setEntryForm({ ...entryForm, shiftEnd: e.target.value })}
                />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div>
              {editingEntry && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleteId(editingEntry.id);
                    closeModal();
                  }}
                  className="btn-danger btn-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Удалить
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={closeModal} className="btn-secondary">
                Отмена
              </button>
              <button type="submit" disabled={isSaving} className="btn-primary">
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Сохранение...
                  </>
                ) : editingEntry ? (
                  'Сохранить'
                ) : (
                  'Создать'
                )}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Удалить запись"
        message="Вы уверены, что хотите удалить эту запись расписания?"
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}

function WorkModeForm({ onSubmit }: { onSubmit: (data: any) => void }) {
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
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
      <input
        type="text"
        className="input flex-1 text-sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Название режима"
        required
      />
      <div className="flex gap-2">
        <input
          type="time"
          className="input w-[100px] text-sm"
          value={shiftStart}
          onChange={(e) => setShiftStart(e.target.value)}
        />
        <input
          type="time"
          className="input w-[100px] text-sm"
          value={shiftEnd}
          onChange={(e) => setShiftEnd(e.target.value)}
        />
      </div>
      <button type="submit" className="btn-primary px-4 whitespace-nowrap text-sm">
        <Plus className="w-4 h-4" /> Добавить
      </button>
    </form>
  );
}

const DAY_NAMES_FULL = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const ORDERED_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Пн-Вс

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
    onError: () => toast.error('Ошибка сохранения'),
  });

  const toggleDay = (user: User, day: number) => {
    const current = user.daysOff || [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    updateMutation.mutate({ userId: user.id, daysOff: next });
  };

  if (activeUsers.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Выходные дни мастеров</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Выберите дни недели — будущие даты обновятся автоматически, прошедшие останутся без изменений
        </p>
      </div>
      <div className="divide-y divide-gray-50">
        {activeUsers.map((u) => {
          const initials = u.fullName
            .split(' ')
            .map((w) => w[0])
            .join('')
            .slice(0, 2);
          const offDays = u.daysOff || [];
          return (
            <div key={u.id} className="px-5 py-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{u.fullName}</p>
                  {offDays.length > 0 && (
                    <p className="text-[11px] text-gray-400">
                      Выходные:{' '}
                      {offDays
                        .sort((a, b) => {
                          const order = [1, 2, 3, 4, 5, 6, 0];
                          return order.indexOf(a) - order.indexOf(b);
                        })
                        .map((d) => DAY_NAMES_FULL[d])
                        .join(', ')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5">
                {ORDERED_DAYS.map((day) => {
                  const isOff = offDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(u, day)}
                      disabled={updateMutation.isPending}
                      className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-all ${
                        isOff
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                      } disabled:opacity-50`}
                    >
                      {DAY_NAMES_FULL[day]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ApplyWorkModeCard({ workModes, users }: { workModes: any[]; users: User[] }) {
  const queryClient = useQueryClient();
  const [selectedMode, setSelectedMode] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [applyFrom, setApplyFrom] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [applyTo, setApplyTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const applyMutation = useMutation({
    mutationFn: (data: { workModeId: string; userId?: string; dateFrom: string; dateTo: string }) =>
      scheduleApi.applyWorkMode(data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      toast.success(`График применён (${res.data?.created || 0} записей)`);
    },
    onError: () => toast.error('Ошибка при применении графика'),
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Применить график</h3>
      </div>
      <div className="px-5 py-4 space-y-3">
        <select className="input text-sm" value={selectedMode} onChange={(e) => setSelectedMode(e.target.value)}>
          <option value="">Режим работы</option>
          {workModes.map((wm: any) => (
            <option key={wm.id} value={wm.id}>
              {wm.name} ({wm.shiftStart}–{wm.shiftEnd})
            </option>
          ))}
        </select>

        <select className="input text-sm" value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}>
          <option value="">Все мастера</option>
          {activeUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </select>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 w-10 flex-shrink-0">С</label>
            <input
              type="date"
              className="input text-xs py-2 px-2.5 flex-1 min-w-0"
              value={applyFrom}
              onChange={(e) => setApplyFrom(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500 w-10 flex-shrink-0">По</label>
            <input
              type="date"
              className="input text-xs py-2 px-2.5 flex-1 min-w-0"
              value={applyTo}
              onChange={(e) => setApplyTo(e.target.value)}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleApply}
          disabled={applyMutation.isPending}
          className="btn-primary w-full justify-center text-sm"
        >
          {applyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Применить
        </button>
      </div>
    </div>
  );
}
