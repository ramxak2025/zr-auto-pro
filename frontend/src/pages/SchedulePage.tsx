import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, addDays, parseISO, eachDayOfInterval, startOfWeek, endOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';

import { scheduleApi, usersApi } from '../api/services';
import { ScheduleEntry, TodayEmployeeStatus, User } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';

type TabType = 'schedule' | 'today';

export default function SchedulePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabType>('schedule');

  // Date range for schedule view
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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

  // Compute days in range
  const daysInRange = useMemo(() => {
    try {
      return eachDayOfInterval({
        start: parseISO(dateFrom),
        end: parseISO(dateTo),
      });
    } catch {
      return [];
    }
  }, [dateFrom, dateTo]);

  // Group entries by userId and date
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

  // Unique users from entries
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
    // Merge with users list for those not in entries
    const allUsers = [...entryUsers];
    users.forEach((u) => {
      if (!userIds.has(u.id) && u.isActive) {
        allUsers.push(u);
      }
    });
    return allUsers;
  }, [entries, users]);

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
    const note = entryForm.isSickDay ? 'Больничный' : (entryForm.note || undefined);
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

  const getStatusColor = (status: TodayEmployeeStatus) => {
    if (status.isDayOff) return 'text-gray-500';
    if (status.lateStatus === 'late_major') return 'text-red-600';
    if (status.lateStatus === 'late_minor') return 'text-yellow-600';
    if (status.isWorking) return 'text-green-600';
    return 'text-gray-500';
  };

  const getStatusBadge = (status: TodayEmployeeStatus) => {
    if (status.isDayOff) return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">Выходной</span>;
    if (!status.hasSchedule) return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">Нет расписания</span>;
    if (status.lateStatus === 'late_major') return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">Опоздание &gt;1ч</span>;
    if (status.lateStatus === 'late_minor') return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700">Опоздание &lt;1ч</span>;
    if (status.isWorking) return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">На смене</span>;
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-600">Не пришёл</span>;
  };

  const getStatusIcon = (status: TodayEmployeeStatus) => {
    if (status.isDayOff) return <XCircle className="w-5 h-5 text-gray-400" />;
    if (status.lateStatus === 'late_major') return <AlertTriangle className="w-5 h-5 text-red-500" />;
    if (status.lateStatus === 'late_minor') return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    if (status.isWorking) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    return <Clock className="w-5 h-5 text-gray-400" />;
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Расписание</h1>
        <button onClick={() => openCreate()} className="btn-primary">
          <Plus className="w-4 h-4" />
          Добавить
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 max-w-xs">
        <button
          onClick={() => setTab('schedule')}
          className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors ${
            tab === 'schedule'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Расписание
        </button>
        <button
          onClick={() => setTab('today')}
          className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors ${
            tab === 'today'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Сегодня
        </button>
      </div>

      {/* Schedule Tab */}
      {tab === 'schedule' && (
        <div>
          {/* Date Range */}
          <div className="mb-6">
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => {
                  setDateFrom(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
                  setDateTo(format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
                }}
                className="btn-secondary btn-sm flex-1 md:flex-none"
              >
                Эта неделя
              </button>
              <button
                onClick={() => {
                  const next = addDays(today, 7);
                  setDateFrom(format(startOfWeek(next, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
                  setDateTo(format(endOfWeek(next, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
                }}
                className="btn-secondary btn-sm flex-1 md:flex-none"
              >
                След. неделя
              </button>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1 md:flex-none">
                <label className="label">С</label>
                <input
                  type="date"
                  className="input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="flex-1 md:flex-none">
                <label className="label">По</label>
                <input
                  type="date"
                  className="input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </div>

          {scheduleLoading ? (
            <LoadingSpinner />
          ) : daysInRange.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Выберите период" />
          ) : (
            <>
              {/* Mobile: cards per employee */}
              <div className="md:hidden space-y-4">
                {scheduleUsers.map((user) => (
                  <div key={user.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <span className="font-semibold text-gray-900 text-sm">{user.fullName}</span>
                    </div>
                    <div className="grid grid-cols-7 divide-x divide-gray-100">
                      {daysInRange.slice(0, 7).map((day) => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const entry = entryMap[user.id]?.[dateStr];
                        const isSick = entry && (entry.note || '').toLowerCase().includes('больнич');
                        return (
                          <button
                            key={dateStr}
                            type="button"
                            onClick={() => entry ? openEdit(entry) : openCreate(user.id, dateStr)}
                            className="flex flex-col items-center py-2.5 px-1 hover:bg-primary-50 transition-colors"
                          >
                            <span className="text-[10px] text-gray-400 uppercase">{format(day, 'EE', { locale: ru })}</span>
                            <span className="text-[10px] text-gray-500 mb-1">{format(day, 'd')}</span>
                            {entry ? (
                              isSick ? (
                                <span className="text-[9px] font-medium text-red-500">Б/Л</span>
                              ) : entry.isDayOff ? (
                                <span className="text-[9px] font-medium text-gray-400">Вых</span>
                              ) : (
                                <div className="text-center">
                                  <span className="text-[10px] font-medium text-green-600 block">{entry.shiftStart?.slice(0, 5)}</span>
                                  <span className="text-[9px] text-gray-400">{entry.shiftEnd?.slice(0, 5)}</span>
                                </div>
                              )
                            ) : (
                              <span className="text-[10px] text-gray-200">—</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-gray-50 z-10">Сотрудник</th>
                      {daysInRange.map((day) => (
                        <th key={day.toISOString()} className="text-center whitespace-nowrap">
                          <div>{format(day, 'EEE', { locale: ru })}</div>
                          <div className="text-[10px] font-normal">{format(day, 'd MMM', { locale: ru })}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleUsers.map((user) => (
                      <tr key={user.id}>
                        <td className="sticky left-0 bg-white z-10 font-medium text-gray-900 whitespace-nowrap">
                          {user.fullName}
                        </td>
                        {daysInRange.map((day) => {
                          const dateStr = format(day, 'yyyy-MM-dd');
                          const entry = entryMap[user.id]?.[dateStr];
                          const isSick = entry && (entry.note || '').toLowerCase().includes('больнич');
                          return (
                            <td
                              key={dateStr}
                              className="text-center cursor-pointer hover:bg-primary-50 transition-colors"
                              onClick={() => {
                                if (entry) {
                                  openEdit(entry);
                                } else {
                                  openCreate(user.id, dateStr);
                                }
                              }}
                            >
                              {entry ? (
                                isSick ? (
                                  <span className="text-xs text-red-500 font-medium">Больнич.</span>
                                ) : entry.isDayOff ? (
                                  <span className="text-xs text-gray-400">Выходной</span>
                                ) : (
                                  <div className="text-xs">
                                    <div className="text-green-700 font-medium">
                                      {entry.shiftStart?.slice(0, 5)}
                                    </div>
                                    <div className="text-gray-500">
                                      {entry.shiftEnd?.slice(0, 5)}
                                    </div>
                                  </div>
                                )
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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
                  className="card card-body flex items-center gap-4"
                >
                  <div className="flex-shrink-0">
                    {getStatusIcon(status)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-medium ${getStatusColor(status)}`}>
                        {status.fullName}
                      </span>
                      {getStatusBadge(status)}
                    </div>
                    {!status.isDayOff && status.hasSchedule && (
                      <div className="text-sm text-gray-500 mt-1">
                        <span>Смена: {status.shiftStart?.slice(0, 5)} - {status.shiftEnd?.slice(0, 5)}</span>
                        {status.lateMinutes > 0 && (
                          <span className="ml-3 text-red-600">
                            Опоздание: {status.lateMinutes} мин.
                          </span>
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
