import { useState, useMemo, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  Calendar,
  Clock,
  Moon,
  Sun,
  AlertTriangle,
  Settings,
  Trash2,
  Users,
} from 'lucide-react';
import { scheduleApi, usersApi } from '../api/services';
import { getApiError } from '../api/axios';
import type { ScheduleEntry, WorkMode, User, PaginatedResponse } from '../types';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWeekDates(offset: number): { from: string; to: string; dates: Date[] } {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);

  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }

  return {
    from: dates[0].toISOString().slice(0, 10),
    to: dates[6].toISOString().slice(0, 10),
    dates,
  };
}

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = ['Янв', 'Фев', 'Мар', 'Апр', 'Мая', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

function isToday(d: Date): boolean {
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

// ---------------------------------------------------------------------------
// Work Mode Modal
// ---------------------------------------------------------------------------

function WorkModeModal({
  isOpen,
  onClose,
  mode,
  onSubmit,
  isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  mode?: WorkMode | null;
  onSubmit: (data: Partial<WorkMode>) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState(mode?.name || '');
  const [type, setType] = useState<'weekly' | 'rotating'>(mode?.type || 'weekly');
  const [workDays, setWorkDays] = useState(mode?.workDays?.toString() || '2');
  const [offDays, setOffDays] = useState(mode?.offDays?.toString() || '2');
  const [weekDays, setWeekDays] = useState<number[]>(mode?.weekDays || [1, 2, 3, 4, 5]);
  const [shiftStart, setShiftStart] = useState(mode?.shiftStart || '09:00');
  const [shiftEnd, setShiftEnd] = useState(mode?.shiftEnd || '18:00');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error('Введите название'); return; }
    onSubmit({
      name: name.trim(),
      type,
      workDays: parseInt(workDays) || 2,
      offDays: parseInt(offDays) || 2,
      weekDays,
      shiftStart,
      shiftEnd,
    });
  }

  function toggleWeekDay(d: number) {
    setWeekDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={mode ? 'Редактировать режим' : 'Новый режим работы'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Название</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: 2/2 или Пн-Пт"
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Тип графика</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setType('weekly')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-all ${type === 'weekly' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              Еженедельный
            </button>
            <button type="button" onClick={() => setType('rotating')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-all ${type === 'rotating' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              Сменный
            </button>
          </div>
        </div>

        {type === 'weekly' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Рабочие дни</label>
            <div className="flex gap-1.5">
              {DAY_NAMES.map((d, i) => (
                <button key={i} type="button" onClick={() => toggleWeekDay(i + 1)}
                  className={`flex-1 rounded-lg py-2 text-xs font-bold transition-all ${weekDays.includes(i + 1) ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Рабочих дней</label>
              <input type="number" value={workDays} onChange={(e) => setWorkDays(e.target.value)} min="1" max="30"
                className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Выходных дней</label>
              <input type="number" value={offDays} onChange={(e) => setOffDays(e.target.value)} min="1" max="30"
                className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Начало смены</label>
            <input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)}
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Конец смены</label>
            <input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)}
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={isLoading}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Отмена</button>
          <button type="submit" disabled={isLoading}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Generate Schedule Modal
// ---------------------------------------------------------------------------

function GenerateModal({
  isOpen,
  onClose,
  users,
  workModes,
  onSubmit,
  isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  workModes: WorkMode[];
  onSubmit: (data: { userId: string; workModeId: string; dateFrom: string; dateTo: string }) => void;
  isLoading: boolean;
}) {
  const [userId, setUserId] = useState('');
  const [workModeId, setWorkModeId] = useState('');

  const now = new Date();
  const [dateFrom, setDateFrom] = useState(now.toISOString().slice(0, 10));
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const [dateTo, setDateTo] = useState(endOfMonth.toISOString().slice(0, 10));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId) { toast.error('Выберите сотрудника'); return; }
    if (!workModeId) { toast.error('Выберите режим работы'); return; }
    onSubmit({ userId, workModeId, dateFrom, dateTo });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Сгенерировать график">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Сотрудник</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
            <option value="">Выберите...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName} ({u.role})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Режим работы</label>
          <select value={workModeId} onChange={(e) => setWorkModeId(e.target.value)}
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
            <option value="">Выберите...</option>
            {workModes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.shiftStart}-{m.shiftEnd})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">С</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">По</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={isLoading}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Отмена</button>
          <button type="submit" disabled={isLoading}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Сгенерировать
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Schedule Cell
// ---------------------------------------------------------------------------

function ScheduleCell({
  entry,
  date,
  canEdit,
  onToggle,
}: {
  entry?: ScheduleEntry;
  date: Date;
  canEdit: boolean;
  onToggle: () => void;
}) {
  const today = isToday(date);

  if (!entry) {
    return (
      <button
        type="button"
        onClick={canEdit ? onToggle : undefined}
        className={`w-full h-full min-h-[52px] rounded-lg border-2 border-dashed transition-all ${
          today ? 'border-primary-300 bg-primary-50/30' : 'border-gray-200 bg-gray-50/50'
        } ${canEdit ? 'hover:border-primary-400 cursor-pointer' : 'cursor-default'}`}
      />
    );
  }

  if (entry.isDayOff) {
    return (
      <button
        type="button"
        onClick={canEdit ? onToggle : undefined}
        className={`w-full h-full min-h-[52px] rounded-lg transition-all flex flex-col items-center justify-center gap-0.5 ${
          today ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-blue-50'
        } ${canEdit ? 'hover:bg-blue-100 cursor-pointer' : 'cursor-default'}`}
      >
        <Moon className="h-3.5 w-3.5 text-blue-400" />
        <span className="text-[9px] font-bold text-blue-500">ВЫХ</span>
      </button>
    );
  }

  // Working day
  let bgClass = today ? 'bg-green-100 ring-2 ring-green-400' : 'bg-green-50';
  let dotColor = 'bg-green-400';
  let statusIcon = <Sun className="h-3.5 w-3.5 text-green-500" />;

  if (entry.lateStatus === 'late_minor') {
    bgClass = today ? 'bg-yellow-100 ring-2 ring-yellow-400' : 'bg-yellow-50';
    dotColor = 'bg-yellow-400';
    statusIcon = <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
  } else if (entry.lateStatus === 'late_major') {
    bgClass = today ? 'bg-orange-100 ring-2 ring-orange-400' : 'bg-orange-50';
    dotColor = 'bg-orange-400';
    statusIcon = <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />;
  }

  return (
    <button
      type="button"
      onClick={canEdit ? onToggle : undefined}
      className={`w-full h-full min-h-[52px] rounded-lg transition-all flex flex-col items-center justify-center gap-0.5 relative ${bgClass} ${
        canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'
      }`}
    >
      {statusIcon}
      <span className="text-[9px] font-bold text-gray-700">{entry.shiftStart}</span>
      {entry.lateMinutes > 0 && (
        <span className="text-[8px] font-bold text-orange-600">+{entry.lateMinutes}м</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SchedulePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('user_management');

  const [weekOffset, setWeekOffset] = useState(0);
  const [showWorkModeModal, setShowWorkModeModal] = useState(false);
  const [editingWorkMode, setEditingWorkMode] = useState<WorkMode | null>(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { from, to, dates } = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  // Queries
  const { data: scheduleData, isLoading } = useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', from, to],
    queryFn: async () => {
      const res = await scheduleApi.getSchedule({ dateFrom: from, dateTo: to });
      return res.data;
    },
  });

  const { data: usersData } = useQuery<PaginatedResponse<User>>({
    queryKey: ['users-list'],
    queryFn: async () => {
      const res = await usersApi.getAll({ limit: 100 });
      return res.data;
    },
  });

  const { data: workModes = [] } = useQuery<WorkMode[]>({
    queryKey: ['work-modes'],
    queryFn: async () => {
      const res = await scheduleApi.getWorkModes();
      return res.data;
    },
  });

  const users = useMemo(() =>
    (usersData?.data || []).filter((u) => u.role !== 'superadmin'),
    [usersData],
  );

  const scheduleMap = useMemo(() => {
    const map = new Map<string, ScheduleEntry>();
    for (const entry of scheduleData || []) {
      map.set(`${entry.userId}_${entry.date}`, entry);
    }
    return map;
  }, [scheduleData]);

  // Mutations
  const toggleMutation = useMutation({
    mutationFn: async ({ userId, date, entry }: { userId: string; date: string; entry?: ScheduleEntry }) => {
      if (entry) {
        return scheduleApi.updateEntry(entry.id, { isDayOff: !entry.isDayOff });
      }
      return scheduleApi.createEntry({ userId, date, isDayOff: false, shiftStart: '09:00', shiftEnd: '18:00' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
    onError: (err) => toast.error(getApiError(err, 'Ошибка')),
  });

  const createWorkModeMutation = useMutation({
    mutationFn: (data: Partial<WorkMode>) => scheduleApi.createWorkMode(data),
    onSuccess: () => {
      toast.success('Режим создан');
      queryClient.invalidateQueries({ queryKey: ['work-modes'] });
      setShowWorkModeModal(false);
      setEditingWorkMode(null);
    },
    onError: (err) => toast.error(getApiError(err, 'Ошибка')),
  });

  const updateWorkModeMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WorkMode> }) =>
      scheduleApi.updateWorkMode(id, data),
    onSuccess: () => {
      toast.success('Режим обновлён');
      queryClient.invalidateQueries({ queryKey: ['work-modes'] });
      setShowWorkModeModal(false);
      setEditingWorkMode(null);
    },
    onError: (err) => toast.error(getApiError(err, 'Ошибка')),
  });

  const deleteWorkModeMutation = useMutation({
    mutationFn: (id: string) => scheduleApi.deleteWorkMode(id),
    onSuccess: () => {
      toast.success('Режим удалён');
      queryClient.invalidateQueries({ queryKey: ['work-modes'] });
    },
    onError: (err) => toast.error(getApiError(err, 'Ошибка')),
  });

  const generateMutation = useMutation({
    mutationFn: (data: { userId: string; workModeId: string; dateFrom: string; dateTo: string }) =>
      scheduleApi.generateSchedule(data),
    onSuccess: () => {
      toast.success('График сгенерирован');
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      setShowGenerateModal(false);
    },
    onError: (err) => toast.error(getApiError(err, 'Ошибка')),
  });

  const monthLabel = useMemo(() => {
    const m1 = MONTH_NAMES[dates[0].getMonth()];
    const m2 = MONTH_NAMES[dates[6].getMonth()];
    const y = dates[0].getFullYear();
    return m1 === m2 ? `${m1} ${y}` : `${m1} — ${m2} ${y}`;
  }, [dates]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">График работы</h1>
          <p className="text-xs text-gray-400 mt-0.5">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <button type="button" onClick={() => setShowSettings(!showSettings)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <Settings className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setShowGenerateModal(true)}
                className="flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 active:scale-[0.97] transition-all">
                <Calendar className="h-4 w-4" />
                <span className="hidden sm:inline">Создать график</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Work Mode Settings Panel */}
      {showSettings && canEdit && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Режимы работы</h3>
            <button type="button" onClick={() => { setEditingWorkMode(null); setShowWorkModeModal(true); }}
              className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700">
              <Plus className="h-3.5 w-3.5" /> Добавить
            </button>
          </div>
          {workModes.length === 0 ? (
            <p className="text-xs text-gray-400">Нет режимов работы</p>
          ) : (
            <div className="space-y-2">
              {workModes.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{m.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {m.type === 'weekly'
                        ? `${m.weekDays.map((d) => DAY_NAMES[d - 1]).join(', ')}`
                        : `${m.workDays}/${m.offDays}`}
                      {' '} {m.shiftStart}—{m.shiftEnd}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => { setEditingWorkMode(m); setShowWorkModeModal(true); }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-200 hover:text-gray-600">
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => deleteWorkModeMutation.mutate(m.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setWeekOffset((p) => p - 1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setWeekOffset(0)}
          className="text-sm font-medium text-primary-600 hover:text-primary-700">Сегодня</button>
        <button type="button" onClick={() => setWeekOffset((p) => p + 1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Schedule Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 rounded-2xl border border-gray-200 bg-white">
          <Users className="h-12 w-12 mb-3" />
          <p className="text-sm">Нет сотрудников</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full border-collapse min-w-[600px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-[140px] border-b border-r border-gray-200">
                  Сотрудник
                </th>
                {dates.map((d, i) => {
                  const today = isToday(d);
                  return (
                    <th key={i} className={`px-1.5 py-2.5 text-center border-b border-gray-200 min-w-[70px] ${
                      today ? 'bg-primary-50' : i >= 5 ? 'bg-blue-50/30' : 'bg-gray-50'
                    }`}>
                      <div className={`text-[10px] uppercase font-bold ${today ? 'text-primary-600' : i >= 5 ? 'text-blue-400' : 'text-gray-400'}`}>
                        {DAY_NAMES[i]}
                      </div>
                      <div className={`text-sm font-bold mt-0.5 ${today ? 'text-primary-600' : 'text-gray-700'}`}>
                        {d.getDate()}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 border-r border-gray-100">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-600 flex-shrink-0">
                        {user.fullName.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">{user.fullName}</p>
                        <p className="text-[10px] text-gray-400 truncate">{user.role}</p>
                      </div>
                    </div>
                  </td>
                  {dates.map((d, i) => {
                    const dateStr = d.toISOString().slice(0, 10);
                    const entry = scheduleMap.get(`${user.id}_${dateStr}`);
                    return (
                      <td key={i} className="px-1 py-1">
                        <ScheduleCell
                          entry={entry}
                          date={d}
                          canEdit={canEdit}
                          onToggle={() => toggleMutation.mutate({ userId: user.id, date: dateStr, entry })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-green-200" /> Рабочий
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-blue-200" /> Выходной
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-yellow-200" /> Опоздание &lt;1ч
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded bg-orange-200" /> Опоздание &gt;1ч
        </div>
      </div>

      {/* Modals */}
      {showWorkModeModal && (
        <WorkModeModal
          isOpen
          onClose={() => { setShowWorkModeModal(false); setEditingWorkMode(null); }}
          mode={editingWorkMode}
          onSubmit={(data) => {
            if (editingWorkMode) {
              updateWorkModeMutation.mutate({ id: editingWorkMode.id, data });
            } else {
              createWorkModeMutation.mutate(data);
            }
          }}
          isLoading={createWorkModeMutation.isPending || updateWorkModeMutation.isPending}
        />
      )}

      {showGenerateModal && (
        <GenerateModal
          isOpen
          onClose={() => setShowGenerateModal(false)}
          users={users}
          workModes={workModes}
          onSubmit={(data) => generateMutation.mutate(data)}
          isLoading={generateMutation.isPending}
        />
      )}
    </div>
  );
}
