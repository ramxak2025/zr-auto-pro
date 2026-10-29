import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, BookOpen, ClipboardList, Info, Loader2, Receipt, Wallet } from 'lucide-react';
import toast from 'react-hot-toast';

import { notificationsApi } from '../api/services';
import type { NotificationCategory, NotificationPreferences } from '../types';
import { Card, PageHeader, QueryState, SkeletonCard } from '../ui';
import ToggleRow from '../components/company/ToggleRow';
import { apiErrorMessage } from '../../../shared/utils/apiError';

interface CategoryDef {
  key: NotificationCategory;
  label: string;
  description: string;
  icon: typeof Bell;
}

// Подписи совпадают с мобильным приложением (mobile NotificationSettings).
const CATEGORIES: CategoryDef[] = [
  {
    key: 'salary',
    label: 'Начисления зарплаты',
    description: 'Когда вам начислена зарплата или премия',
    icon: Wallet,
  },
  {
    key: 'penalty',
    label: 'Штрафы',
    description: 'Когда вам выписан штраф или удержание',
    icon: AlertTriangle,
  },
  {
    key: 'check_assigned',
    label: 'Новые заказ-наряды',
    description: 'Когда на вас назначен новый заказ-наряд',
    icon: ClipboardList,
  },
  {
    key: 'check_closed',
    label: 'Закрытые чеки',
    description: 'Когда заказ-наряд закрыт и оплачен',
    icon: Receipt,
  },
  {
    key: 'knowledge',
    label: 'Обязательные регламенты',
    description: 'Новые статьи и регламенты, обязательные к прочтению',
    icon: BookOpen,
  },
];

const PREFS_KEY = ['notification-preferences'] as const;

export default function NotificationSettingsPage() {
  const queryClient = useQueryClient();

  // В слоте — сами настройки (не ответ axios): так их пишет и оптимистичное
  // обновление ниже, и ответ сервера — одна форма слота.
  const {
    data: prefs,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<NotificationPreferences>({
    queryKey: PREFS_KEY,
    queryFn: async () => (await notificationsApi.getPreferences()).data as NotificationPreferences,
    staleTime: 5 * 60 * 1000,
  });

  const muted = useMemo<NotificationCategory[]>(() => {
    const raw = prefs?.muted;
    return Array.isArray(raw) ? raw : [];
  }, [prefs]);

  const updateMutation = useMutation({
    mutationFn: (next: NotificationCategory[]) => notificationsApi.updatePreferences(next),
    // Оптимистично — переключатель должен щёлкать мгновенно.
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: PREFS_KEY });
      const prev = queryClient.getQueryData<NotificationPreferences>(PREFS_KEY);
      queryClient.setQueryData<NotificationPreferences>(
        PREFS_KEY,
        (old) => ({ ...(old ?? {}), muted: next }) as NotificationPreferences,
      );
      return { prev };
    },
    onError: (err: unknown, _next, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(PREFS_KEY, ctx.prev);
      toast.error(apiErrorMessage(err) ?? 'Не удалось сохранить настройки');
    },
    onSuccess: (res) => {
      if (res?.data) queryClient.setQueryData(PREFS_KEY, res.data as NotificationPreferences);
    },
  });

  // ВКЛ = категория НЕ в muted. Выключение добавляет категорию в muted.
  const toggle = (key: NotificationCategory) => {
    const isMuted = muted.includes(key);
    const next = isMuted ? muted.filter((c) => c !== key) : [...muted, key];
    updateMutation.mutate(next);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Уведомления" icon={Bell} subtitle="Какие push-уведомления приходят на ваши устройства" />

      <div className="max-w-3xl space-y-5">
        {/* Лестница состояний: при ошибке загрузки переключатели скрыты — иначе
            каждый читался бы как ВКЛ (muted по умолчанию пуст), а переключение
            сохраняло бы неизвестную базу. */}
        <QueryState
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          isFetching={isFetching}
          loader={<SkeletonCard lines={5} />}
          minHeight="min-h-[40vh]"
          errorTitle="Не удалось загрузить настройки"
          errorDescription="Переключатели скрыты, чтобы не сохранить их в неверном состоянии. Повторите загрузку."
        >
          <Card padding="none">
            <ul className="divide-y divide-line">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const enabled = !muted.includes(cat.key);
                return (
                  <li key={cat.key} className="flex items-start gap-4 px-5 py-4">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <ToggleRow
                      className="min-w-0 flex-1"
                      label={cat.label}
                      description={cat.description}
                      checked={enabled}
                      onChange={() => toggle(cat.key)}
                      disabled={updateMutation.isPending}
                    />
                  </li>
                );
              })}
            </ul>
          </Card>

          <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-4 py-3">
            {updateMutation.isPending ? (
              <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-ink-3" aria-hidden="true" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-3" aria-hidden="true" />
            )}
            <p className="text-xs leading-relaxed text-ink-2">
              {updateMutation.isPending ? 'Сохраняем…' : 'Важные объявления от поддержки приходят всегда.'}
            </p>
          </div>
        </QueryState>
      </div>
    </div>
  );
}
