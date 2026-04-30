import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ChevronRight, Users } from 'lucide-react';
import { usersApi, scheduleApi } from '../api/services';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import type { User, TodayEmployeeStatus } from '../types';
import { roleLabels } from '../../../shared/utils/formatters';

const roleBadgeColors: Record<string, string> = {
  superadmin: 'bg-red-50 text-red-700',
  director: 'bg-purple-50 text-purple-700',
  admin: 'bg-blue-50 text-blue-700',
  master: 'bg-green-50 text-green-700',
};

const statusDotColor = (s?: TodayEmployeeStatus): string => {
  if (!s) return 'bg-gray-200';
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return 'bg-rose-400';
  if (s.isDayOff) return 'bg-gray-400';
  if (s.lateStatus === 'late_major') return 'bg-orange-500';
  if (s.lateStatus === 'late_minor') return 'bg-yellow-300';
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time') return 'bg-green-500';
  if (note.includes('прогул')) return 'bg-red-500';
  if (s.hasSchedule) return 'bg-gray-300';
  return 'bg-gray-200';
};

const statusLabel = (s?: TodayEmployeeStatus): string => {
  if (!s) return 'Нет данных';
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return 'Больничный';
  if (s.isDayOff) return 'Выходной';
  if (s.lateStatus === 'late_major') return `Опозд. >1 ч (${s.lateMinutes} мин)`;
  if (s.lateStatus === 'late_minor') return `Опозд. ${s.lateMinutes} мин`;
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time') return 'На смене';
  if (note.includes('прогул')) return 'Прогул';
  if (s.hasSchedule) return 'Не пришёл';
  return '—';
};

export default function EmployeesPage() {
  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users-all'],
    queryFn: async () => { const res = await usersApi.getAll(); return res.data; },
    staleTime: 60_000,
  });

  const { data: today } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => { const res = await scheduleApi.getToday(); return res.data; },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const todayMap = useMemo(() => {
    const map = new Map<string, TodayEmployeeStatus>();
    (today ?? []).forEach((s) => map.set(s.userId, s));
    return map;
  }, [today]);

  // Active first, then alphabetical
  const sortedUsers = useMemo(() => {
    return (users ?? [])
      .filter((u) => u.isActive)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
  }, [users]);

  if (isLoading) return <LoadingSpinner />;

  if (sortedUsers.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Сотрудников пока нет"
        description="Пригласите команду через раздел «Пользователи»."
      />
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <header className="page-header">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="page-title">Сотрудники</h1>
            <p className="text-sm text-gray-500">{sortedUsers.length} активных</p>
          </div>
        </div>
      </header>

      <ul className="space-y-2">
        {sortedUsers.map((u, idx) => {
          const status = todayMap.get(u.id);
          const initials = u.fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
          const roleClass = roleBadgeColors[u.role] || roleBadgeColors.master;
          return (
            <motion.li
              key={u.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: Math.min(idx * 0.02, 0.2), ease: [0.2, 0, 0, 1] }}
            >
              <Link
                to={`/employees/${u.id}`}
                className="card-interactive flex items-center gap-3 px-4 py-3 no-underline"
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  {u.avatar ? (
                    <img src={u.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700 font-bold text-sm">
                      {initials}
                    </div>
                  )}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white ${statusDotColor(status)}`}
                    aria-hidden
                  />
                </div>

                {/* Name + status */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{u.fullName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${roleClass}`}>
                      {roleLabels[u.role] || u.role}
                    </span>
                    <span className="text-xs text-gray-500 truncate">{statusLabel(status)}</span>
                  </div>
                </div>

                <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
