import { useState, useMemo, useCallback, useRef } from 'react';
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
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  format,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  isToday,
  getDay,
} from 'date-fns';
import { ru } from 'date-fns/locale';

import { scheduleApi, usersApi } from '../api/services';
import { ScheduleEntry, TodayEmployeeStatus, User } from '../types';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';

type TabType = 'schedule' | 'today' | 'mystats' | 'settings';

// Correct Russian day abbreviations (date-fns 'EE' locale gives wrong 2-char prefix for Сб)
const DAY_ABBR = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export default function SchedulePage() {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const canEdit =
    authUser?.role === 'director' ||
    authUser?.role === 'superadmin' ||
    authUser?.role === 'admin';

  const [tab, setTab] = useState<TabType>('schedule');

  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today);

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

  const [entryForm, setEntryForm] = useState({
    userId: '',
    date: format(today, 'yyyy-MM-dd'),
    shiftStart: '09:00',
    shiftEnd: '18:00',
    isDayOff: false,
    isSickDay: false,
    note: '',
  });

  // Settings tab state
  const [settingsTab, setSettingsTab] = useState<'service' | 'masters'>('service');

  // Queries
  const { data: scheduleData, isLoading: scheduleLoading } = useQuery({
    queryKey: ['schedule', dateFrom, dateTo],
    queryFn: () => scheduleApi.getAll({ dateFrom, dateTo }),
    select: (res) => res.data as ScheduleEntry[],
  });

  const { data: todayData, isLoading: todayLoading } = useQuery({
    queryKey: ['schedule-today'],
    queryFn: () => scheduleApi.getToday(),
    select: (res) => res.data as TodayEmployeeStatus[],
    enabled: tab === 'today',
  });

  const { data: myStatsData } = useQuery({
    queryKey: ['my-schedule-stats'],
    queryFn: () => scheduleApi.getMyStats(),
    select: (res) => res.data as {
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

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(),
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

  // Build user -> date -> entry map
  const entryMap = useMemo(() => {
    const map: Record<string, Record<string, ScheduleEntry>> = {};
    entries.forEach((entry) => {
      const uid = entry.userId;
      const d = entry.date.slice(0, 10);
      if (!map[uid]) map[uid] = {};
      map[uid][d] = entry;
    });
    return map;
  }, [entries]);

  // All active users (merge from entries + users list)
  const scheduleUsers = useMemo(() => {
    const userIds = new Set(entries.map((e) => e.userId));
    const entryUsers = entries
      .filter((e) => e.user)
      .reduce((acc, e) => {
        if (e.user && !acc.find((u) => u.id === e.userId)) {
          acc.push(e.user);
        }
        return acc;
      }, [] as User[]);
    const allUsers = [...entryUsers];
    users.forEach((u) => {
      if (!userIds.has(u.id) && u.isActive) {
        allUsers.push(u);
      }
    });
    return allUsers;
  }, [entries, users]);

  // Month navigation
  const goToPrevMonth = useCallback(() => setCurrentMonth((m) => subMonths(m, 1)), []);
  const goToNextMonth = useCallback(() => setCurrentMonth((m) => addMonths(m, 1)), []);
  const goToToday = useCallback(() => setCurrentMonth(new Date()), []);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: any) => scheduleApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      toast.success('Запись расписания создана');
      closeModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка создания записи');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => scheduleApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      toast.success('Запись обновлена');
      closeModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка обновления');
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
      date: format(today, 'yyyy-MM-dd'),
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
      date: date || format(today, 'yyyy-MM-dd'),
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
      date: entry.date.slice(0, 10),
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
  const quickSetStatus = (status: 'shift' | 'dayoff' | 'sick' | 'late_minor' | 'late_major' | 'delete') => {
    if (!quickPopup) return;
    const { userId, date, entry } = quickPopup;

    if (status === 'delete' && entry) {
      deleteMutation.mutate(entry.id);
      setQuickPopup(null);
      return;
    }

    const isDayOff = status === 'dayoff' || status === 'sick';
    const note = status === 'sick' ? 'Больничный' : (status === 'late_minor' ? 'Опоздание <1ч' : status === 'late_major' ? 'Опоздание >1ч' : '');
    const lateStatus = status === 'late_minor' ? 'late_minor' : status === 'late_major' ? 'late_major' : undefined;

    const payload: any = {
      userId,
      date,
      shiftStart: isDayOff ? null : '09:00',
      shiftEnd: isDayOff ? null : '18:00',
      isDayOff,
      note: note || undefined,
    };

    if (entry) {
      // Preserve existing shift times if editing shift
      if (!isDayOff && entry.shiftStart) {
        payload.shiftStart = entry.shiftStart;
        payload.shiftEnd = entry.shiftEnd;
      }
      updateMutation.mutate({ id: entry.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
    setQuickPopup(null);
  };

  // Cell rendering helpers
  const getCellContent = (entry: ScheduleEntry | undefined) => {
    if (!entry) return null;
    const isSick = (entry.note || '').toLowerCase().includes('больнич');
    const isLateMinor = (entry.note || '').includes('<1ч') || entry.lateStatus === 'late_minor';
    const isLateMajor = (entry.note || '').includes('>1ч') || entry.lateStatus === 'late_major';
    if (isSick) {
      return { label: '🏥', bgColor: 'bg-rose-50', textColor: 'text-rose-500', borderColor: 'border-rose-200' };
    }
    if (entry.isDayOff) {
      return { label: '🌙', bgColor: 'bg-gray-800', textColor: 'text-white', borderColor: 'border-gray-700' };
    }
    if (isLateMajor) {
      return { label: '⚠️', bgColor: 'bg-orange-50', textColor: 'text-orange-600', borderColor: 'border-orange-300' };
    }
    if (isLateMinor) {
      return { label: '⏰', bgColor: 'bg-yellow-50', textColor: 'text-yellow-600', borderColor: 'border-yellow-300' };
    }
    // Working shift
    const time = entry.shiftStart?.slice(0, 5) || '✓';
    return { label: time, bgColor: 'bg-green-50', textColor: 'text-green-700', borderColor: 'border-green-200' };
  };

  // Today tab helpers
  const getStatusBadge = (status: TodayEmployeeStatus) => {
    if (status.isDayOff)
      return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-900 text-white">Выходной</span>;
    if (!status.hasSchedule)
      return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">Нет расписания</span>;
    if (status.lateStatus === 'late_major')
      return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">Опоздание &gt;1ч</span>;
    if (status.lateStatus === 'late_minor')
      return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700">Опоздание &lt;1ч</span>;
    if (status.isWorking)
      return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">На смене</span>;
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">Прогул</span>;
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

      {/* Tabs */}
      <div className="overflow-x-auto -mx-1 px-1 mb-6 scrollbar-hide">
        <div className="inline-flex gap-1 bg-gray-100 rounded-2xl p-1 min-w-0">
          <button
            onClick={() => setTab('schedule')}
            className={`whitespace-nowrap py-2 px-3 text-sm font-medium rounded-xl transition-all duration-200 ${
              tab === 'schedule' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <CalendarDays className="w-4 h-4 inline-block mr-1 -mt-0.5" />
            График
          </button>
          <button
            onClick={() => setTab('today')}
            className={`whitespace-nowrap py-2 px-3 text-sm font-medium rounded-xl transition-all duration-200 ${
              tab === 'today' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Clock className="w-4 h-4 inline-block mr-1 -mt-0.5" />
            Сегодня
          </button>
          <button
            onClick={() => setTab('mystats')}
            className={`whitespace-nowrap py-2 px-3 text-sm font-medium rounded-xl transition-all duration-200 ${
              tab === 'mystats' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users className="w-4 h-4 inline-block mr-1 -mt-0.5" />
            Смены
          </button>
          {canEdit && (
            <button
              onClick={() => setTab('settings')}
              className={`whitespace-nowrap py-2 px-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                tab === 'settings' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Настройки
            </button>
          )}
        </div>
      </div>

      {/* Schedule Tab - Grid: rows=employees, columns=dates */}
      {tab === 'schedule' && (
        <div>
          {/* Month Navigation */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3">
              <div className="flex items-center justify-between">
                <button
                  onClick={goToPrevMonth}
                  className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-all duration-200 active:scale-95"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-center">
                  <h2 className="text-white font-semibold text-lg capitalize">
                    {format(currentMonth, 'LLLL yyyy', { locale: ru })}
                  </h2>
                  <button
                    onClick={goToToday}
                    className="text-white/80 hover:text-white text-xs mt-0.5 transition-colors underline decoration-white/40"
                  >
                    Сегодня
                  </button>
                </div>
                <button
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
                  <span className="w-5 h-5 rounded bg-green-50 border border-green-200 flex items-center justify-center text-[10px]">✓</span>
                  Смена
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-5 h-5 rounded bg-gray-800 border border-gray-700 flex items-center justify-center text-[10px]">🌙</span>
                  Вых
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-5 h-5 rounded bg-rose-50 border border-rose-200 flex items-center justify-center text-[10px]">🏥</span>
                  Б/Л
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-5 h-5 rounded bg-yellow-50 border border-yellow-300 flex items-center justify-center text-[10px]">⏰</span>
                  &lt;1ч
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-5 h-5 rounded bg-orange-50 border border-orange-300 flex items-center justify-center text-[10px]">⚠️</span>
                  &gt;1ч
                </span>
              </div>
            </div>

            {scheduleLoading ? (
              <div className="py-16"><LoadingSpinner /></div>
            ) : scheduleUsers.length === 0 ? (
              <div className="py-16">
                <EmptyState icon={Users} title="Нет сотрудников" description="Добавьте сотрудников для составления расписания" />
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
                    {/* Employee rows */}
                    {scheduleUsers.map((u) => (
                      <div
                        key={u.id}
                        className="h-12 border-b border-gray-50 px-3 flex items-center"
                      >
                        <span className="text-xs font-medium text-gray-800 truncate max-w-[100px] sm:max-w-[140px]">
                          {u.fullName}
                        </span>
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
                              <span className={`text-[9px] font-medium ${isWeekend ? 'text-red-400' : 'text-gray-400'}`}>
                                {DAY_ABBR[getDay(day)]}
                              </span>
                              <span className={`text-xs font-bold ${
                                isTodayDate ? 'text-blue-600' : isWeekend ? 'text-red-500' : 'text-gray-700'
                              }`}>
                                {format(day, 'd')}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Employee schedule rows */}
                      {scheduleUsers.map((u) => (
                        <div key={u.id} className="flex border-b border-gray-50">
                          {monthDays.map((day) => {
                            const dateStr = format(day, 'yyyy-MM-dd');
                            const entry = entryMap[u.id]?.[dateStr];
                            const cellData = getCellContent(entry);
                            const dayOfWeek = getDay(day);
                            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                            const isTodayDate = isToday(day);

                            return (
                              <div
                                key={dateStr}
                                onClick={() => {
                                  if (!canEdit) return;
                                  setQuickPopup({ userId: u.id, date: dateStr, entry });
                                }}
                                className={`w-11 flex-shrink-0 h-12 flex items-center justify-center border-r border-gray-50 last:border-r-0 transition-colors ${
                                  canEdit ? 'cursor-pointer hover:bg-blue-50/50' : ''
                                } ${isTodayDate ? 'bg-blue-50/40' : isWeekend ? 'bg-red-50/20' : ''}`}
                              >
                                {cellData ? (
                                  <div className={`w-8 h-8 rounded-lg ${cellData.bgColor} border ${cellData.borderColor} flex items-center justify-center`}>
                                    <span className={`text-[10px] font-bold ${cellData.textColor}`}>
                                      {cellData.label}
                                    </span>
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
            <LoadingSpinner />
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
                      <span className="font-medium text-gray-900">
                        {status.fullName}
                      </span>
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
                          <span className="ml-3 text-gray-400">
                            Пришёл: {status.actualArrival.slice(0, 5)}
                          </span>
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
            <LoadingSpinner />
          )}
        </div>
      )}

      {/* Quick Status Popup — simple tap to set status */}
      {quickPopup && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setQuickPopup(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm mx-auto shadow-2xl overflow-hidden animate-fade-in-down"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-2">
              <p className="text-sm font-bold text-gray-900">
                {users.find(u => u.id === quickPopup.userId)?.fullName || ''} — {quickPopup.date.slice(5).replace('-', '.')}
              </p>
            </div>
            <div className="px-3 pb-4 space-y-1">
              <button
                onClick={() => quickSetStatus('shift')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-green-50 transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center text-sm">✅</span>
                <span className="text-sm font-medium text-gray-800">Смена</span>
              </button>
              <button
                onClick={() => quickSetStatus('dayoff')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-gray-200 flex items-center justify-center text-sm">🌙</span>
                <span className="text-sm font-medium text-gray-800">Выходной</span>
              </button>
              <button
                onClick={() => quickSetStatus('sick')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-rose-50 transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center text-sm">🏥</span>
                <span className="text-sm font-medium text-gray-800">Больничный</span>
              </button>
              <button
                onClick={() => quickSetStatus('late_minor')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-yellow-50 transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-yellow-100 flex items-center justify-center text-sm">⏰</span>
                <span className="text-sm font-medium text-gray-800">Опоздал до часа</span>
              </button>
              <button
                onClick={() => quickSetStatus('late_major')}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-orange-50 transition-colors text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center text-sm">⚠️</span>
                <span className="text-sm font-medium text-gray-800">Опоздал больше часа</span>
              </button>
              {quickPopup.entry && (
                <button
                  onClick={() => quickSetStatus('delete')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-50 transition-colors text-left"
                >
                  <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center"><Trash2 className="w-4 h-4 text-red-500" /></span>
                  <span className="text-sm font-medium text-red-600">Удалить запись</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Tab — Work Mode */}
      {tab === 'settings' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Режим работы сервиса</h2>
            <p className="text-xs text-gray-400 mb-4">
              Создайте режимы работы (например, «Основной: Пн-Вс 9:00-19:00») и назначайте их мастерам.
            </p>
            {workModes.length > 0 ? (
              <div className="space-y-3 mb-4">
                {workModes.map((wm: any) => (
                  <div key={wm.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{wm.name}</p>
                      <p className="text-xs text-gray-500">{wm.shiftStart} — {wm.shiftEnd}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-4">Режимы работы не созданы</p>
            )}
            <WorkModeForm onSubmit={(data: any) => createWorkModeMutation.mutate(data)} />
          </div>

          {/* Apply work mode to masters */}
          {workModes.length > 0 && (
            <ApplyWorkModeCard workModes={workModes} users={users} />
          )}

          {/* Per-master days off */}
          <MasterDaysOffCard users={users} />
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
            <select className="input" value={entryForm.userId} onChange={(e) => setEntryForm({ ...entryForm, userId: e.target.value })} required>
              <option value="">Выберите сотрудника</option>
              {users.filter((u) => u.isActive).map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Дата</label>
            <input type="date" className="input" value={entryForm.date} onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })} required />
          </div>
          <div>
            <label className="label">Тип</label>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setEntryForm({ ...entryForm, isDayOff: false, isSickDay: false })}
                className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors ${!entryForm.isDayOff && !entryForm.isSickDay ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                Смена
              </button>
              <button type="button" onClick={() => setEntryForm({ ...entryForm, isDayOff: true, isSickDay: false })}
                className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors ${entryForm.isDayOff && !entryForm.isSickDay ? 'border-gray-500 bg-gray-100 text-gray-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                Выходной
              </button>
              <button type="button" onClick={() => setEntryForm({ ...entryForm, isDayOff: false, isSickDay: true })}
                className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors ${entryForm.isSickDay ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                Больничный
              </button>
            </div>
          </div>
          {!entryForm.isDayOff && !entryForm.isSickDay && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Начало</label>
                <input type="time" className="input" value={entryForm.shiftStart} onChange={(e) => setEntryForm({ ...entryForm, shiftStart: e.target.value })} />
              </div>
              <div>
                <label className="label">Конец</label>
                <input type="time" className="input" value={entryForm.shiftEnd} onChange={(e) => setEntryForm({ ...entryForm, shiftEnd: e.target.value })} />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div>
              {editingEntry && (
                <button type="button" onClick={() => { setDeleteId(editingEntry.id); closeModal(); }} className="btn-danger btn-sm">
                  <Trash2 className="w-3.5 h-3.5" /> Удалить
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={closeModal} className="btn-secondary">Отмена</button>
              <button type="submit" disabled={isSaving} className="btn-primary">
                {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Сохранение...</> : editingEntry ? 'Сохранить' : 'Создать'}
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
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
      <input
        type="text"
        className="input flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Название (напр. Основной)"
        required
      />
      <input
        type="time"
        className="input w-24"
        value={shiftStart}
        onChange={(e) => setShiftStart(e.target.value)}
      />
      <input
        type="time"
        className="input w-24"
        value={shiftEnd}
        onChange={(e) => setShiftEnd(e.target.value)}
      />
      <button type="submit" className="btn-primary px-4 whitespace-nowrap">
        <Plus className="w-4 h-4" /> Создать
      </button>
    </form>
  );
}

const DAY_NAMES_FULL = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const ORDERED_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Пн-Вс

function MasterDaysOffCard({ users }: { users: User[] }) {
  const queryClient = useQueryClient();
  const activeUsers = users.filter(u => u.isActive && (u.role === 'master' || u.role === 'admin'));

  const updateMutation = useMutation({
    mutationFn: ({ userId, daysOff }: { userId: string; daysOff: number[] }) =>
      usersApi.update(userId, { daysOff } as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Выходные дни обновлены');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  const toggleDay = (user: User, day: number) => {
    const current = user.daysOff || [];
    const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day];
    updateMutation.mutate({ userId: user.id, daysOff: next });
  };

  if (activeUsers.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Выходные дни мастеров</h2>
      <p className="text-xs text-gray-400 mb-4">
        Отметьте дни недели, в которые у мастера выходной. При применении графика эти дни будут автоматически проставлены как выходные.
      </p>
      <div className="space-y-3">
        {activeUsers.map((u) => (
          <div key={u.id} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
            <p className="text-sm font-semibold text-gray-800 mb-2">{u.fullName}</p>
            <div className="flex flex-wrap gap-1.5">
              {ORDERED_DAYS.map((day) => {
                const isOff = (u.daysOff || []).includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(u, day)}
                    disabled={updateMutation.isPending}
                    className={`w-10 h-9 rounded-lg text-xs font-bold transition-all ${
                      isOff
                        ? 'bg-red-500 text-white shadow-sm'
                        : 'bg-white text-gray-500 border border-gray-200 hover:border-red-300 hover:text-red-500'
                    } disabled:opacity-50`}
                  >
                    {DAY_NAMES_FULL[day]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApplyWorkModeCard({ workModes, users }: { workModes: any[]; users: User[] }) {
  const queryClient = useQueryClient();
  const [selectedMode, setSelectedMode] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [applyFrom, setApplyFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
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
    if (!selectedMode) { toast.error('Выберите режим работы'); return; }
    if (!applyFrom || !applyTo) { toast.error('Укажите период'); return; }
    applyMutation.mutate({
      workModeId: selectedMode,
      userId: selectedUser || undefined,
      dateFrom: applyFrom,
      dateTo: applyTo,
    });
  };

  const activeUsers = users.filter(u => u.isActive && (u.role === 'master' || u.role === 'admin'));

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Применить график</h2>
      <p className="text-xs text-gray-400 mb-4">
        Заполните расписание для всех мастеров или конкретного сотрудника по выбранному режиму.
      </p>

      <div className="space-y-3">
        <div>
          <label className="label">Режим работы</label>
          <select className="input" value={selectedMode} onChange={(e) => setSelectedMode(e.target.value)}>
            <option value="">Выберите режим</option>
            {workModes.map((wm: any) => (
              <option key={wm.id} value={wm.id}>{wm.name} ({wm.shiftStart}–{wm.shiftEnd})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Сотрудник</label>
          <select className="input" value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}>
            <option value="">Все мастера</option>
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">С</label>
            <input type="date" className="input" value={applyFrom} onChange={(e) => setApplyFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">По</label>
            <input type="date" className="input" value={applyTo} onChange={(e) => setApplyTo(e.target.value)} />
          </div>
        </div>

        <button
          type="button"
          onClick={handleApply}
          disabled={applyMutation.isPending}
          className="btn-primary w-full justify-center"
        >
          {applyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
          Применить расписание
        </button>
      </div>
    </div>
  );
}
