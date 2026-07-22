import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, CheckCircle, ArrowUpCircle, ArrowLeft, Sparkles, MessageCircle } from 'lucide-react';
import { subscriptionApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import type { SubscriptionInfo, Plan } from '../types';
import { featureLabel } from '../../../shared/constants/features';
import { getWhatsAppChatUrl } from '../config/contacts';

interface FeatureGateProps {
  featureKey: string;
  title: string;
  description: string;
  benefits: string[];
  children: ReactNode;
}

/**
 * Resolve the cheapest ACTIVE plan whose feature set includes `featureKey`.
 * Returns the plan the owner should upgrade to in order to unlock the screen,
 * or `null` if no plan offers the capability (e.g. it was retired).
 */
function findUnlockingPlan(plans: Plan[] | undefined, featureKey: string): Plan | null {
  if (!Array.isArray(plans)) return null;
  return (
    plans
      .filter((p) => p.isActive && Array.isArray(p.features) && p.features.includes(featureKey))
      .sort((a, b) => a.monthlyPrice - b.monthlyPrice)[0] ?? null
  );
}

/**
 * Wraps a page and shows a paywall stub if the feature
 * is not included in the tenant's current plan.
 * Web equivalent of mobile FeatureGate.
 *
 * Gating is resolved DIRECTLY from `sub.features` — the server-computed feature
 * keys of the tenant's current plan (linked by planId). The old name-match
 * (`plans.find(p => p.name === sub.planName)`) was fragile: any rename or
 * duplicate name silently mis-gated screens. See shared/constants/features.ts.
 */
export default function FeatureGate({ featureKey, title, description, benefits, children }: FeatureGateProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: sub, isError: subIsError } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => {
      const res = await subscriptionApi.get();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    // Подписка гейтит целые разделы — одна сетевая осечка не должна отключать
    // план-гейтинг (глобальный дефолт retry: 1 здесь слишком робкий).
    retry: 3,
  });

  // Only superadmin bypasses feature gates
  if (user?.role === UserRole.SUPERADMIN) {
    return <>{children}</>;
  }

  // Optimistic: show children while loading. При ОКОНЧАТЕЛЬНОЙ ошибке (все
  // ретраи исчерпаны) тоже fail-open — владелец не должен терять кассу из-за
  // 5xx на /subscription — но обход гейтинга фиксируем, а не молчим.
  if (!sub) {
    if (subIsError) {
      console.warn(`[FeatureGate] запрос /subscription не удался — «${featureKey}» показан без проверки тарифа`);
    }
    return <>{children}</>;
  }

  // Authoritative check: the resolved feature keys of the current plan.
  if (Array.isArray(sub.features) && sub.features.includes(featureKey)) {
    return <>{children}</>;
  }

  const openWhatsApp = (planName?: string) => {
    const what = planName ? `тариф «${planName}» (функция «${title}»)` : `функцию «${title}»`;
    window.open(getWhatsAppChatUrl(`Здравствуйте! Хочу подключить ${what}.`), '_blank');
  };

  const unlockingPlan = findUnlockingPlan(sub.plans, featureKey);

  // ─── Polished, plan-aware locked card ──────────────────────────────────────
  // When a concrete plan unlocks this screen, we NAME it, show its price + the
  // features it brings, and route the primary CTA to the in-app tariff page.
  if (unlockingPlan) {
    const highlights = (Array.isArray(unlockingPlan.features) ? unlockingPlan.features : [])
      .slice(0, 6)
      .map((key) => featureLabel(key));

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-primary-50 mb-5">
          <Lock className="w-9 h-9 text-primary-500" />
        </div>

        <h2 className="text-2xl font-bold text-gray-900 text-center">{title}</h2>
        <p className="text-sm text-gray-500 text-center max-w-md leading-relaxed mt-2 mb-5">{description}</p>

        {/* Plan offer card */}
        <div className="relative w-full max-w-md rounded-2xl border border-primary-100 bg-gradient-to-b from-primary-50/60 to-white p-5 mb-5 shadow-sm">
          <div className="flex items-center gap-2 text-primary-600 mb-1">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">Доступно на тарифе</span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xl font-bold text-gray-900 truncate">«{unlockingPlan.name}»</span>
            <span className="whitespace-nowrap text-lg font-bold text-primary-600">
              {unlockingPlan.monthlyPrice.toLocaleString('ru-RU')}{' '}
              <span className="text-sm font-medium text-gray-500">₽/мес</span>
            </span>
          </div>

          {unlockingPlan.description && <p className="text-sm text-gray-500 mt-1.5">{unlockingPlan.description}</p>}

          <div className="mt-4 pt-4 border-t border-primary-100/70">
            <p className="text-xs font-semibold text-gray-500 mb-2.5">Что входит в тариф:</p>
            <div className="grid grid-cols-1 gap-1.5">
              {highlights.map((label, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm text-gray-700">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Primary CTA → in-app tariff page */}
        <button
          onClick={() => navigate('/tariff')}
          className="flex items-center justify-center gap-2 w-full max-w-md bg-primary-600 hover:bg-primary-700 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm"
        >
          <ArrowUpCircle className="w-5 h-5" />
          Перейти к тарифам
        </button>

        {/* Secondary fallback → WhatsApp */}
        <button
          onClick={() => openWhatsApp(unlockingPlan.name)}
          className="flex items-center justify-center gap-2 w-full max-w-md mt-3 bg-white border border-gray-200 text-gray-700 font-medium py-3 rounded-xl hover:bg-gray-50 transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          Написать в поддержку
        </button>

        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 mt-3 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Вернуться назад
        </button>
      </div>
    );
  }

  // ─── Fallback: no plan offers this key → generic copy ──────────────────────
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      {/* Lock icon */}
      <div className="flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 mb-5">
        <Lock className="w-9 h-9 text-gray-400" />
      </div>

      <h2 className="text-2xl font-bold text-gray-900 text-center">{title}</h2>
      <span className="text-sm font-semibold text-red-500 mt-2 mb-2">Недоступно в вашем тарифе</span>
      <p className="text-sm text-gray-500 text-center max-w-md leading-relaxed mb-5">{description}</p>

      {/* Benefits card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 w-full max-w-md mb-5">
        <p className="text-sm font-bold text-gray-800 mb-3">Что вы получите:</p>
        {benefits.map((b, i) => (
          <div key={i} className="flex items-center gap-2.5 py-1.5">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            <span className="text-sm text-gray-700">{b}</span>
          </div>
        ))}
      </div>

      {/* CTA button */}
      <button
        onClick={() => openWhatsApp()}
        className="flex items-center justify-center gap-2 w-full max-w-md bg-primary-600 hover:bg-primary-700 text-white font-bold py-3.5 rounded-xl transition-colors"
      >
        <ArrowUpCircle className="w-5 h-5" />
        Улучшить тариф
      </button>

      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 mt-3 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Вернуться назад
      </button>
    </div>
  );
}
