import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Clock,
  Plus,
  Pencil,
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
  addDays,
  parseISO,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  isSameMonth,
  isToday,
  isSameDay,
} from 'date-fns';
import { ru } from 'date-fns/locale';

import { scheduleApi, usersApi } from '../api/services';
import { ScheduleEntry, TodayEmployeeStatus, User } from '../types';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';

type TabType = 'schedule' | 'today';

/** Employee color palette for dot badges in the calendar */
const EMPLOYEE_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-lime-600',
  'bg-orange-500',
  'bg-emerald-500',
  'bg-violet-500',
];

function getEmployeeColor(index: number): string {
  return EMPLOYEE_COLORS[index % EMPLOYEE_COLORS.length];
}

export default function SchedulePage() {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const canEdit =
    authUser?.role === 'director' ||
    authUser?.role === 'superadmin' ||
    authUser?.role === 'admin';

  const [tab, setTab] = useState<TabType>('schedule');

  // Current month for calendar navigation
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today);

  // Compute dateFrom / dateTo covering the entire visible calendar grid
  // (from Monday of the week containing the 1st, to Sunday of the week containing the last day)
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const dateFrom = format(calendarStart, 'yyyy-MM-dd');
  const dateTo = format(calendarEnd, 'yyyy-MM-dd');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Day detail popup (for tapping a day cell on mobile)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const [entryForm, setEntryForm] = useState({
    userId: '',
    date: format(today, 'yyyy-MM-dd'),
    shiftStart: '09:00',
    shiftEnd: '18:00',
    isDayOff: false,
    isSickDay: false,
    note: '',
  });

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

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(),
    select: (res) => res.data as User[],
  });

  const entries = scheduleData ?? [];
  const todayStatuses = todayData ?? [];
  const users = usersData ?? [];

  // Compute days in visible calendar grid
  const calendarDays = useMemo(() => {
    try {
      return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    } catch {
      return [];
    }
  }, [dateFrom, dateTo]);

  // Group entries by date -> userId
  const dateEntryMap = useMemo(() => {
    const map: Record<string, Record<string, ScheduleEntry>> = {};
    entries.forEach((entry) => {
      const d = entry.date.slice(0, 10);
      if (!map[d]) map[d] = {};
      map[d][entry.userId] = entry;
    });
    return map;
  }, [entries]);

  // Also keep user->date map for the day detail view
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

  // Stable user -> color index map
  const userColorMap = useMemo(() => {
    const map: Record<string, number> = {};
    scheduleUsers.forEach((u, i) => {
      map[u.id] = i;
    });
    return map;
  }, [scheduleUsers]);

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

  // Helper: get entries for a given day
  const getEntriesForDay = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayEntries = dateEntryMap[dateStr];
    if (!dayEntries) return [];
    return Object.values(dayEntries);
  };

  // Handle day cell click
  const handleDayCellClick = (day: Date) => {
    if (!isSameMonth(day, currentMonth)) return;
    setSelectedDay(day);
  };

  // Handle adding schedule from day detail
  const handleAddFromDayDetail = (date: string, userId?: string) => {
    setSelectedDay(null);
    openCreate(userId, date);
  };

  // Handle editing from day detail
  const handleEditFromDayDetail = (entry: ScheduleEntry) => {
    setSelectedDay(null);
    openEdit(entry);
  };

  // Entry status helpers
  const getEntryDotColor = (entry: ScheduleEntry): string => {
    const isSick = (entry.note || '').toLowerCase().includes('больнич');
    if (isSick) return 'bg-red-500';
    if (entry.isDayOff) return 'bg-gray-400';
    return 'bg-green-500';
  };

  const getEntryStatusLabel = (entry: ScheduleEntry): string => {
    const isSick = (entry.note || '').toLowerCase().includes('больнич');
    if (isSick) return 'Больничный';
    if (entry.isDayOff) return 'Выходной';
    return `${entry.shiftStart?.slice(0, 5)} - ${entry.shiftEnd?.slice(0, 5)}`;
  };

  const getEntryStatusBadge = (entry: ScheduleEntry) => {
    const isSick = (entry.note || '').toLowerCase().includes('больнич');
    if (isSick) {
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-700">
          Б/Л
        </span>
      );
    }
    if (entry.isDayOff) {
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600">
          Вых
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-700">
        {entry.shiftStart?.slice(0, 5)}-{entry.shiftEnd?.slice(0, 5)}
      </span>
    );
  };

  // Today tab helpers
  const getStatusColor = (status: TodayEmployeeStatus) => {
    if (status.isDayOff) return 'text-gray-500';
    if (status.lateStatus === 'late_major') return 'text-red-600';
    if (status.lateStatus === 'late_minor') return 'text-yellow-600';
    if (status.isWorking) return 'text-green-600';
    return 'text-gray-500';
  };

  const getStatusBadge = (status: TodayEmployeeStatus) => {
    if (status.isDayOff)
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
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
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">
          Опоздание &gt;1ч
        </span>
      );
    if (status.lateStatus === 'late_minor')
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700">
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
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-600">
        Не пришёл
      </span>
    );
  };

  const getStatusIcon = (status: TodayEmployeeStatus) => {
    if (status.isDayOff) return <XCircle className="w-5 h-5 text-gray-400" />;
    if (status.lateStatus === 'late_major') return <AlertTriangle className="w-5 h-5 text-red-500" />;
    if (status.lateStatus === 'late_minor') return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    if (status.isWorking) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    return <Clock className="w-5 h-5 text-gray-400" />;
  };

  // Weekday header names (Mon-Sun)
  const weekdayNames = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) =>
      format(addDays(start, i), 'EEEEEE', { locale: ru }).toUpperCase()
    );
  }, []);

  // Split calendar days into weeks (rows of 7)
  const calendarWeeks = useMemo(() => {
    const weeks: Date[][] = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      weeks.push(calendarDays.slice(i, i + 7));
    }
    return weeks;
  }, [calendarDays]);

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
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 mb-6 max-w-xs">
        <button
          onClick={() => setTab('schedule')}
          className={`flex-1 py-2 px-4 text-sm font-medium rounded-xl transition-all duration-200 ${
            tab === 'schedule'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <CalendarDays className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
          Расписание
        </button>
        <button
          onClick={() => setTab('today')}
          className={`flex-1 py-2 px-4 text-sm font-medium rounded-xl transition-all duration-200 ${
            tab === 'today'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Clock className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
          Сегодня
        </button>
      </div>

      {/* Schedule Tab - Month Calendar */}
      {tab === 'schedule' && (
        <div>
          {/* Month Navigation */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={goToPrevMonth}
                  className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-all duration-200 active:scale-95"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-center">
                  <h2 className="text-white font-semibold text-lg sm:text-xl capitalize">
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

            {/* Color Legend */}
            <div className="px-4 py-2.5 sm:px-6 border-b border-gray-100 bg-gray-50/50">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
                  Работает
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" />
                  Выходной
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                  Больничный
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full border-2 border-dashed border-gray-300 inline-block" />
                  Нет записи
                </span>
              </div>
            </div>

            {scheduleLoading ? (
              <div className="py-16">
                <LoadingSpinner />
              </div>
            ) : (
              <>
                {/* Desktop Calendar Grid */}
                <div className="hidden md:block">
                  {/* Weekday Headers */}
                  <div className="grid grid-cols-7 border-b border-gray-100">
                    {weekdayNames.map((name, i) => (
                      <div
                        key={i}
                        className="px-2 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider"
                      >
                        {name}
                      </div>
                    ))}
                  </div>

                  {/* Calendar Weeks */}
                  {calendarWeeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-b-0">
                      {week.map((day) => {
                        const inMonth = isSameMonth(day, currentMonth);
                        const todayHighlight = isToday(day);
                        const dayEntries = getEntriesForDay(day);
                        const dateStr = format(day, 'yyyy-MM-dd');

                        return (
                          <div
                            key={dateStr}
                            onClick={() => handleDayCellClick(day)}
                            className={`
                              min-h-[100px] p-2 border-r border-gray-50 last:border-r-0
                              transition-all duration-150 group
                              ${inMonth ? 'bg-white hover:bg-blue-50/50 cursor-pointer' : 'bg-gray-50/60'}
                              ${todayHighlight ? 'ring-2 ring-inset ring-blue-400/50 bg-blue-50/30' : ''}
                            `}
                          >
                            {/* Day number */}
                            <div className="flex items-center justify-between mb-1.5">
                              <span
                                className={`
                                  text-sm font-medium leading-none
                                  ${todayHighlight ? 'bg-blue-600 text-white w-7 h-7 rounded-full flex items-center justify-center' : ''}
                                  ${inMonth ? (todayHighlight ? '' : 'text-gray-900') : 'text-gray-300'}
                                `}
                              >
                                {format(day, 'd')}
                              </span>
                              {canEdit && inMonth && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openCreate(undefined, dateStr);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded-md hover:bg-blue-100 text-blue-500 transition-all duration-150"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            {/* Employee entries as badges */}
                            {inMonth && (
                              <div className="space-y-0.5">
                                {dayEntries.slice(0, 4).map((entry) => {
                                  const userName = entry.user?.fullName || 'Сотрудник';
                                  const shortName = userName.split(' ')[0];
                                  const dotColor = getEntryDotColor(entry);
                                  return (
                                    <div
                                      key={entry.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (canEdit) {
                                          openEdit(entry);
                                        } else {
                                          handleDayCellClick(day);
                                        }
                                      }}
                                      className={`
                                        flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] leading-tight truncate
                                        ${canEdit ? 'hover:bg-gray-100 cursor-pointer' : ''}
                                        transition-colors duration-100
                                      `}
                                      title={`${userName}: ${getEntryStatusLabel(entry)}`}
                                    >
                                      <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
                                      <span className="truncate text-gray-700">{shortName}</span>
                                    </div>
                                  );
                                })}
                                {dayEntries.length > 4 && (
                                  <div className="text-[10px] text-gray-400 px-1.5 font-medium">
                                    +{dayEntries.length - 4} ещё
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Mobile Calendar Grid */}
                <div className="md:hidden">
                  {/* Weekday Headers */}
                  <div className="grid grid-cols-7 border-b border-gray-100">
                    {weekdayNames.map((name, i) => (
                      <div
                        key={i}
                        className="px-0.5 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider"
                      >
                        {name}
                      </div>
                    ))}
                  </div>

                  {/* Calendar Weeks (mobile) */}
                  {calendarWeeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 border-b border-gray-50 last:border-b-0">
                      {week.map((day) => {
                        const inMonth = isSameMonth(day, currentMonth);
                        const todayHighlight = isToday(day);
                        const dayEntries = getEntriesForDay(day);
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const isSelected = selectedDay && isSameDay(day, selectedDay);

                        return (
                          <button
                            key={dateStr}
                            type="button"
                            onClick={() => handleDayCellClick(day)}
                            className={`
                              min-h-[60px] p-1 border-r border-gray-50 last:border-r-0
                              flex flex-col items-center transition-all duration-150
                              ${inMonth ? 'bg-white active:bg-blue-50' : 'bg-gray-50/60'}
                              ${todayHighlight ? 'ring-2 ring-inset ring-blue-400/40' : ''}
                              ${isSelected ? 'bg-blue-50' : ''}
                            `}
                            disabled={!inMonth}
                          >
                            {/* Day number */}
                            <span
                              className={`
                                text-xs font-medium mb-1
                                ${todayHighlight ? 'bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center' : ''}
                                ${inMonth ? (todayHighlight ? '' : 'text-gray-900') : 'text-gray-300'}
                              `}
                            >
                              {format(day, 'd')}
                            </span>

                            {/* Dots for employees */}
                            {inMonth && dayEntries.length > 0 && (
                              <div className="flex flex-wrap justify-center gap-[3px] mt-auto">
                                {dayEntries.slice(0, 6).map((entry) => (
                                  <span
                                    key={entry.id}
                                    className={`w-[6px] h-[6px] rounded-full ${getEntryDotColor(entry)}`}
                                  />
                                ))}
                                {dayEntries.length > 6 && (
                                  <span className="text-[8px] text-gray-400 leading-none">+</span>
                                )}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Employee Legend */}
          {!scheduleLoading && scheduleUsers.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-700">Сотрудники</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {scheduleUsers.map((u, i) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-700 border border-gray-100"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${getEmployeeColor(i)}`} />
                    {u.fullName}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Day Detail Panel (shows when a day is selected) */}
          {selectedDay && isSameMonth(selectedDay, currentMonth) && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="bg-gradient-to-r from-gray-700 to-gray-800 px-4 py-3 sm:px-6 flex items-center justify-between">
                <h3 className="text-white font-semibold text-sm sm:text-base capitalize">
                  {format(selectedDay, 'EEEE, d MMMM yyyy', { locale: ru })}
                </h3>
                <div className="flex items-center gap-2">
                  {canEdit && (
                    <button
                      onClick={() => handleAddFromDayDetail(format(selectedDay, 'yyyy-MM-dd'))}
                      className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-5">
                {(() => {
                  const dayEntries = getEntriesForDay(selectedDay);
                  if (dayEntries.length === 0) {
                    return (
                      <div className="text-center py-6">
                        <CalendarDays className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">Нет записей на этот день</p>
                        {canEdit && (
                          <button
                            onClick={() =>
                              handleAddFromDayDetail(format(selectedDay, 'yyyy-MM-dd'))
                            }
                            className="mt-3 btn-primary btn-sm"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Добавить запись
                          </button>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2.5">
                      {dayEntries.map((entry) => {
                        const userName = entry.user?.fullName || 'Сотрудник';
                        const colorIdx = userColorMap[entry.userId] ?? 0;
                        const isSick = (entry.note || '').toLowerCase().includes('больнич');

                        return (
                          <div
                            key={entry.id}
                            className={`
                              flex items-center gap-3 p-3 rounded-xl border border-gray-100
                              ${canEdit ? 'hover:border-gray-200 hover:shadow-sm cursor-pointer' : ''}
                              transition-all duration-150
                            `}
                            onClick={() => {
                              if (canEdit) handleEditFromDayDetail(entry);
                            }}
                          >
                            <div
                              className={`w-9 h-9 rounded-xl ${getEmployeeColor(colorIdx)} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}
                            >
                              {userName.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{userName}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {isSick
                                  ? 'Больничный'
                                  : entry.isDayOff
                                    ? 'Выходной'
                                    : `Смена: ${entry.shiftStart?.slice(0, 5)} - ${entry.shiftEnd?.slice(0, 5)}`}
                              </p>
                            </div>
                            <div className="flex-shrink-0">
                              {getEntryStatusBadge(entry)}
                            </div>
                            {canEdit && (
                              <Pencil className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                            )}
                          </div>
                        );
                      })}

                      {canEdit && (
                        <button
                          onClick={() =>
                            handleAddFromDayDetail(format(selectedDay, 'yyyy-MM-dd'))
                          }
                          className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-all duration-150 text-sm"
                        >
                          <Plus className="w-4 h-4" />
                          Добавить запись
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
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
                      <span className={`font-medium ${getStatusColor(status)}`}>
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

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingEntry ? 'Редактировать запись' : 'Новая запись расписания'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* User */}
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

          {/* Date */}
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

          {/* Type selector: Work / Day Off / Sick Day */}
          <div>
            <label className="label">Тип</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setEntryForm({ ...entryForm, isDayOff: false, isSickDay: false })}
                className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors ${
                  !entryForm.isDayOff && !entryForm.isSickDay
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Смена
              </button>
              <button
                type="button"
                onClick={() => setEntryForm({ ...entryForm, isDayOff: true, isSickDay: false })}
                className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors ${
                  entryForm.isDayOff && !entryForm.isSickDay
                    ? 'border-gray-500 bg-gray-100 text-gray-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Выходной
              </button>
              <button
                type="button"
                onClick={() => setEntryForm({ ...entryForm, isDayOff: false, isSickDay: true })}
                className={`py-2.5 px-3 text-sm font-medium rounded-xl border-2 transition-colors ${
                  entryForm.isSickDay
                    ? 'border-red-400 bg-red-50 text-red-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Больничный
              </button>
            </div>
          </div>

          {/* Shift Times (hidden when day off or sick day) */}
          {!entryForm.isDayOff && !entryForm.isSickDay && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Начало смены</label>
                <input
                  type="time"
                  className="input"
                  value={entryForm.shiftStart}
                  onChange={(e) => setEntryForm({ ...entryForm, shiftStart: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Конец смены</label>
                <input
                  type="time"
                  className="input"
                  value={entryForm.shiftEnd}
                  onChange={(e) => setEntryForm({ ...entryForm, shiftEnd: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* Note */}
          <div>
            <label className="label">Заметка</label>
            <input
              type="text"
              className="input"
              value={entryForm.note}
              onChange={(e) => setEntryForm({ ...entryForm, note: e.target.value })}
              placeholder="Необязательно"
            />
          </div>

          {/* Actions */}
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
                  <Trash2 className="w-3.5 h-3.5" />
                  Удалить
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
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Сохранение...
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
