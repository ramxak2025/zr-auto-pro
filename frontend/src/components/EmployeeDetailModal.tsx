import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Calendar, Clock, Mail, Phone, Shield, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { usersApi, salaryApi } from '../api/services';
import type { TodayEmployeeStatus, User, MasterSalary } from '../types';
import { roleLabels } from '../../../shared/utils/formatters';

interface EmployeeDetailModalProps {
  status: TodayEmployeeStatus | null;
  onClose: () => void;
}

const roleBadgeColors: Record<string, string> = {
  superadmin: 'bg-red-50 text-red-700 ring-red-100',
  director: 'bg-purple-50 text-purple-700 ring-purple-100',
  admin: 'bg-blue-50 text-blue-700 ring-blue-100',
  master: 'bg-green-50 text-green-700 ring-green-100',
};

function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatMoney(v: number): string {
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

function statusLabel(s: TodayEmployeeStatus): { text: string; tone: 'green' | 'orange' | 'yellow' | 'red' | 'gray' | 'rose' } {
  const note = (s.note || '').toLowerCase();
  if (note.includes('больнич')) return { text: 'Больничный', tone: 'rose' };
  if (s.isDayOff) return { text: 'Выходной', tone: 'gray' };
  if (s.lateStatus === 'late_major') return { text: `Опоздание >1 ч (${s.lateMinutes} мин)`, tone: 'orange' };
  if (s.lateStatus === 'late_minor') return { text: `Опоздание ${s.lateMinutes} мин`, tone: 'yellow' };
  if (s.isWorking || s.actualArrival || s.lateStatus === 'on_time') return { text: 'На смене', tone: 'green' };
  if (note.includes('прогул')) return { text: 'Прогул', tone: 'red' };
  if (s.hasSchedule) return { text: 'Не пришёл', tone: 'red' };
  return { text: 'Нет данных', tone: 'gray' };
}

const toneClasses: Record<string, string> = {
  green: 'bg-green-50 text-green-700 ring-green-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  gray: 'bg-gray-100 text-gray-600 ring-gray-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export default function EmployeeDetailModal({ status, onClose }: EmployeeDetailModalProps) {
  // Lock body scroll while open
  useEffect(() => {
    if (!status) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [status]);

  // ESC to close
  useEffect(() => {
    if (!status) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [status, onClose]);

  // Pull full user record for avatar / phone / permissions
  const { data: user } = useQuery<User>({
    queryKey: ['user', status?.userId],
    queryFn: async () => {
      const res = await usersApi.getById(status!.userId);
      return res.data;
    },
    enabled: !!status?.userId,
    staleTime: 5 * 60_000,
  });

  // Pull master salary summary so the card shows today/month earnings + check count
  const { data: salaryRows } = useQuery<MasterSalary[]>({
    queryKey: ['salary-all'],
    queryFn: async () => { const res = await salaryApi.getAll(); return res.data; },
    enabled: !!status?.userId && (status?.role === 'master'),
    staleTime: 60_000,
  });
  const salary = salaryRows?.find((m) => m.userId === status?.userId);

  if (!status) return null;

  const initials = status.fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const roleClass = roleBadgeColors[status.role] || roleBadgeColors.master;
  const sl = statusLabel(status);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.7 }}
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90dvh] flex flex-col overflow-hidden"
      >
        {/* Hero */}
        <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-6 pt-6 pb-5 relative">
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="absolute top-4 right-4 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={status.fullName}
                className="w-16 h-16 rounded-full object-cover ring-2 ring-white/20"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-white/10 ring-2 ring-white/20 flex items-center justify-center text-white text-xl font-bold">
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-white text-lg font-bold truncate">{status.fullName}</h3>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ${roleClass}`}>
                  {roleLabels[status.role] || status.role}
                </span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-inset ${toneClasses[sl.tone]}`}>
                  {sl.text}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
          {/* Today schedule row */}
          <section>
            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Сегодня</h4>
            <div className="grid grid-cols-3 gap-2">
              <InfoTile
                icon={<Clock className="w-3.5 h-3.5" />}
                label="Смена"
                value={
                  status.shiftStart && status.shiftEnd
                    ? `${formatTime(status.shiftStart)} – ${formatTime(status.shiftEnd)}`
                    : status.isDayOff ? 'Выходной' : '—'
                }
              />
              <InfoTile
                icon={<Calendar className="w-3.5 h-3.5" />}
                label="Пришёл"
                value={status.actualArrival ? formatTime(status.actualArrival) : '—'}
              />
              <InfoTile
                icon={<Shield className="w-3.5 h-3.5" />}
                label="Опоздание"
                value={status.lateMinutes > 0 ? `${status.lateMinutes} мин` : '—'}
              />
            </div>
            {status.note && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-[12px] text-amber-800">
                {status.note}
              </div>
            )}
          </section>

          {/* Salary if master */}
          {status.role === 'master' && salary && (
            <section>
              <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Заработок</h4>
              <div className="grid grid-cols-2 gap-2">
                <InfoTile label="Сегодня" value={formatMoney(salary.today ?? 0)} highlight />
                <InfoTile label="За месяц" value={formatMoney(salary.month ?? 0)} highlight />
                <InfoTile label="Чеков сегодня" value={String(salary.todayChecks ?? 0)} />
                <InfoTile label="Чеков за месяц" value={String(salary.monthChecks ?? 0)} />
              </div>
            </section>
          )}

          {/* Contact */}
          {user && (
            <section>
              <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Контакт</h4>
              <div className="rounded-xl border border-gray-100 divide-y divide-gray-100">
                <ContactRow icon={<Phone className="w-4 h-4 text-gray-400" />} label="Телефон" value={user.phone} />
                {user.username && (
                  <ContactRow icon={<Mail className="w-4 h-4 text-gray-400" />} label="Логин" value={user.username} />
                )}
                <ContactRow
                  icon={<Shield className="w-4 h-4 text-gray-400" />}
                  label="Доля с услуг"
                  value={`${user.salaryPercent || 0}%`}
                />
                {typeof user.productSalaryPercent === 'number' && (
                  <ContactRow
                    icon={<Shield className="w-4 h-4 text-gray-400" />}
                    label="Доля с товаров"
                    value={`${user.productSalaryPercent}%`}
                  />
                )}
              </div>
            </section>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function InfoTile({
  icon,
  label,
  value,
  highlight,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border ${highlight ? 'border-blue-100 bg-blue-50/40' : 'border-gray-100 bg-gray-50/60'} px-3 py-2`}>
      <div className="flex items-center gap-1 text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`text-sm font-semibold tabular-nums ${highlight ? 'text-blue-900' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function ContactRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon}
      <span className="text-xs text-gray-500 flex-1">{label}</span>
      <span className="text-sm font-medium text-gray-900 tabular-nums">{value}</span>
    </div>
  );
}
