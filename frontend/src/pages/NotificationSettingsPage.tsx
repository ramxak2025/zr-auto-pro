import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Wallet, AlertTriangle, ClipboardList, Receipt, BookOpen, Info, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { notificationsApi } from '../api/services';
import type { NotificationCategory, NotificationPreferences } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';

interface CategoryDef {
  key: NotificationCategory;
  label: string;
  description: string;
  icon: typeof Bell;
  color: string;
  iconColor: string;
}

// Russian labels match the mobile app (mobile NotificationSettings).
const CATEGORIES: CategoryDef[] = [
  {
    key: 'salary',
    label: 'Начисления зарплаты',
    description: 'Когда вам начислена зарплата или премия',
    icon: Wallet,
    color: 'bg-green-50',
    iconColor: 'text-green-600',
  },
  {
    key: 'penalty',
    label: 'Штрафы',
    description: 'Когда вам выписан штраф или удержание',
    icon: AlertTriangle,
    color: 'bg-rose-50',
    iconColor: 'text-rose-600',
  },
  {
    key: 'check_assigned',
    label: 'Новые заказ-наряды',
    description: 'Когда на вас назначен новый заказ-наряд',
    icon: ClipboardList,
    color: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  {
    key: 'check_closed',
    label: 'Закрытые чеки',
    description: 'Когда заказ-наряд закрыт и оплачен',
    icon: Receipt,
    color: 'bg-teal-50',
    iconColor: 'text-teal-600',
  },
  {
    key: 'knowledge',
    label: 'Обязательные регламенты',
    description: 'Новые статьи и регламенты, обязательные к прочтению',
    icon: BookOpen,
    color: 'bg-sky-50',
    iconColor: 'text-sky-600',
  },
];

export default function NotificationSettingsPage() {
  const queryClient = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => notificationsApi.getPreferences(),
    select: (res) => res.data as NotificationPreferences,
    staleTime: 5 * 60 * 1000,
  });

  const muted = useMemo<NotificationCategory[]>(() => (Array.isArray(prefs?.muted) ? prefs!.muted : []), [prefs]);

  const updateMutation = useMutation({
    mutationFn: (next: NotificationCategory[]) => notificationsApi.updatePreferences(next),
    // Optimistic toggle so the switch feels instant.
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ['notification-preferences'] });
      const prev = queryClient.getQueryData<{ data: NotificationPreferences }>(['notification-preferences']);
      queryClient.setQueryData(['notification-preferences'], { data: { muted: next } });
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['notification-preferences'], ctx.prev);
      toast.error('Не удалось сохранить настройки');
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['notification-preferences'], res);
    },
  });

  // ON = enabled = NOT in the muted set. Toggling OFF adds the category to muted.
  const toggle = (key: NotificationCategory) => {
    const isMuted = muted.includes(key);
    const next = isMuted ? muted.filter((c) => c !== key) : [...muted, key];
    updateMutation.mutate(next);
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Уведомления</h1>
      </div>

      <div className="max-w-2xl space-y-5">
        <div className="flex items-start gap-3 text-sm text-gray-500">
          <Bell className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Выберите, какие push-уведомления вы хотите получать. Отключённые категории не будут приходить на ваши
            устройства.
          </p>
        </div>

        {/* Category toggles */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const enabled = !muted.includes(cat.key);
            return (
              <div key={cat.key} className="flex items-center gap-4 px-5 py-4">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${cat.color}`}>
                  <Icon className={`h-5 w-5 ${cat.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{cat.label}</p>
                  <p className="text-xs text-gray-500">{cat.description}</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={enabled}
                    onChange={() => toggle(cat.key)}
                    disabled={updateMutation.isPending}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600 peer-disabled:opacity-60" />
                </label>
              </div>
            );
          })}
        </div>

        {/* Footer note — broadcasts are always-on */}
        <div className="flex items-start gap-2.5 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
          {updateMutation.isPending ? (
            <Loader2 className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5 animate-spin" />
          ) : (
            <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
          )}
          <p className="text-xs text-gray-500 leading-relaxed">Важные объявления от поддержки приходят всегда.</p>
        </div>
      </div>
    </div>
  );
}
