import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LogOut, Mail, PauseCircle } from 'lucide-react';

import { subscriptionApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { SubscriptionInfo, SubscriptionStatus } from '../types';
import { Button, Card, Money, buttonClasses, cn } from '../ui';
import { toneChip } from '../ui/tokens';

// Почта оплаты/поддержки на экране жёсткой блокировки (102).
const SUPPORT_EMAIL = 'info@autexa.pw';

/**
 * Экран жёсткой блокировки для КАЖДОГО сотрудника тенанта, чья подписка больше
 * не `active`. App.tsx уводит сюда все пути по авторитетному
 * `SubscriptionInfo.status`; страница лишь выбирает текст (истекла / приостановлена)
 * и не имеет пути назад в приложение, пока статус не станет `active` на сервере.
 */
export default function SubscriptionBlockedPage() {
  const { user, logout } = useAuth();

  // Слот ['subscription'] хранит сам объект подписки — та же форма, что у
  // оболочки, FeatureGate и App (одна форма слота на всех потребителей).
  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
    staleTime: 5 * 60 * 1000,
  });

  const tenantName = sub?.tenantName || user?.tenant?.name || 'Автосервис';

  // Авторитетный статус из GET /subscription. Пока запрос не ответил — берём
  // из me()-тенанта: явный маркер приостановки важнее, иначе считаем истечением.
  const status: SubscriptionStatus = sub?.status ?? (user?.tenant?.suspendedAt ? 'suspended' : 'expired');

  const planName = sub?.planName?.trim() || null;
  const planPrice = sub?.planPrice ?? sub?.monthlyPrice ?? 0;

  const isSuspended = status === 'suspended';

  const heading = isSuspended ? 'Подписка приостановлена' : 'Срок действия подписки истёк';

  const mailSubject = encodeURIComponent(
    isSuspended ? `Возобновление доступа — ${tenantName}` : `Продление подписки — ${tenantName}`,
  );
  const mailUrl = `mailto:${SUPPORT_EMAIL}?subject=${mailSubject}`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <main className="w-full max-w-md">
        <Card padding="none" className="p-8">
          <div className="mb-6 flex justify-center">
            <img src="/logo.png" alt="Autexa" className="h-11 w-auto object-contain" />
          </div>

          <div
            className={cn(
              'mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl',
              isSuspended ? toneChip.bad : toneChip.warn,
            )}
          >
            {isSuspended ? (
              <PauseCircle className="h-8 w-8" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-8 w-8" aria-hidden="true" />
            )}
          </div>

          <h1 className="text-center text-title text-ink">{heading}</h1>
          <p className="mb-5 mt-1.5 text-center text-sm text-ink-3">{tenantName}</p>

          {isSuspended ? (
            <p className="mb-6 text-center text-sm leading-relaxed text-ink-2">
              Работа в приложении временно недоступна. Для возобновления свяжитесь с нами:{' '}
              <a href={mailUrl} className="rounded font-medium text-accent hover:text-accent-hover focus-ring">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          ) : (
            <p className="mb-6 text-center text-sm leading-relaxed text-ink-2">
              К сожалению, действие вашей подписки на Autexa завершилось. Чтобы продолжить работу,{' '}
              {planName ? (
                <>
                  продлите тариф «<span className="font-semibold text-ink">{planName}</span>» —{' '}
                  <Money value={planPrice} className="font-semibold text-ink" />
                  <span className="font-semibold text-ink">/мес</span>
                </>
              ) : (
                'продлите подписку'
              )}
              . До оплаты доступ к разделам ограничен. По вопросам оплаты:{' '}
              <a href={mailUrl} className="rounded font-medium text-accent hover:text-accent-hover focus-ring">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          )}

          <a href={mailUrl} className={buttonClasses({ variant: 'primary', size: 'lg', fullWidth: true })}>
            <Mail className="h-5 w-5" aria-hidden="true" />
            Написать в поддержку
          </a>

          <Button variant="ghost" icon={LogOut} fullWidth onClick={logout} className="mt-3">
            Выйти из аккаунта
          </Button>
        </Card>

        <p className="mt-6 text-center text-xs text-ink-3">Autexa &copy; 2026</p>
      </main>
    </div>
  );
}
