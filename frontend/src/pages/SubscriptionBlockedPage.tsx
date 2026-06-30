import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, PauseCircle, Mail, LogOut } from 'lucide-react';
import { subscriptionApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { SubscriptionInfo, SubscriptionStatus } from '../types';

// Payment / support inbox surfaced on the hard-gate screen (102).
const SUPPORT_EMAIL = 'info@autexa.pw';

/**
 * Hard-gate screen shown to EVERY employee of a tenant whose subscription is no
 * longer `active`. App.tsx routes all paths here off the authoritative
 * `SubscriptionInfo.status`; this page only chooses the message (expired vs
 * suspended) and is otherwise read-only — there is no way back into the app
 * until the status flips back to `active` server-side.
 */
export default function SubscriptionBlockedPage() {
  const { user, logout } = useAuth();

  const { data: sub } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => subscriptionApi.get(),
    select: (res) => res.data as SubscriptionInfo,
    staleTime: 5 * 60 * 1000,
  });

  const tenantName = sub?.tenantName || user?.tenant?.name || 'Автосервис';

  // Authoritative status from GET /subscription. If the request hasn't resolved,
  // fall back to the me()-embedded tenant: an explicit suspension marker wins,
  // otherwise we treat the block as an expiry (the common case App gated on).
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          {/* Brand */}
          <div className="flex justify-center mb-6">
            <img src="/logo.png" alt="Autexa" className="h-11 w-auto object-contain" />
          </div>

          {/* Status icon */}
          <div
            className={`w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center ${
              isSuspended ? 'bg-red-50' : 'bg-amber-50'
            }`}
          >
            {isSuspended ? (
              <PauseCircle className="w-8 h-8 text-red-500" />
            ) : (
              <AlertTriangle className="w-8 h-8 text-amber-500" />
            )}
          </div>

          {/* Heading */}
          <h1 className="text-xl font-bold text-gray-900 text-center mb-1.5">{heading}</h1>
          <p className="text-sm text-gray-400 text-center mb-5">{tenantName}</p>

          {/* Message */}
          {isSuspended ? (
            <p className="text-sm text-gray-600 leading-relaxed text-center mb-6">
              Работа в приложении временно недоступна. Для возобновления свяжитесь с нами:{' '}
              <a href={mailUrl} className="font-medium text-primary-600 hover:text-primary-700">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          ) : (
            <p className="text-sm text-gray-600 leading-relaxed text-center mb-6">
              К сожалению, действие вашей подписки на Autexa завершилось. Чтобы продолжить работу,{' '}
              {planName ? (
                <>
                  продлите тариф «<span className="font-semibold text-gray-800">{planName}</span>» —{' '}
                  <span className="font-semibold text-gray-800">{planPrice.toLocaleString('ru-RU')} ₽/мес</span>
                </>
              ) : (
                'продлите подписку'
              )}
              . До оплаты доступ к разделам ограничен. По вопросам оплаты:{' '}
              <a href={mailUrl} className="font-medium text-primary-600 hover:text-primary-700">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          )}

          {/* Primary contact — email support */}
          <a
            href={mailUrl}
            className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-xl transition-colors mb-3"
          >
            <Mail className="w-5 h-5" />
            Написать в поддержку
          </a>

          {/* Logout */}
          <button
            onClick={logout}
            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Выйти из аккаунта
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">Autexa &copy; 2026</p>
      </div>
    </div>
  );
}
