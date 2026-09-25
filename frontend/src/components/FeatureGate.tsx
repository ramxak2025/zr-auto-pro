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
import { Button } from '../ui/Button';

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
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
          <Lock className="h-7 w-7 text-accent" aria-hidden="true" />
        </div>

        <h2 className="text-center text-title text-ink">{title}</h2>
        <p className="mb-5 mt-2 max-w-md text-center text-sm leading-relaxed text-ink-3">{description}</p>

        {/* Карточка тарифа, который открывает раздел */}
        <div className="mb-5 w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-card">
          <div className="mb-1 flex items-center gap-2 text-accent-text">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-semibold">Доступно на тарифе</span>
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-lg font-semibold text-ink">«{unlockingPlan.name}»</span>
            <span className="whitespace-nowrap text-lg font-semibold tabular-nums text-ink">
              {unlockingPlan.monthlyPrice.toLocaleString('ru-RU')}{' '}
              <span className="text-sm font-medium text-ink-3">₽/мес</span>
            </span>
          </div>

          {unlockingPlan.description && <p className="mt-1.5 text-sm text-ink-3">{unlockingPlan.description}</p>}

          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2.5 text-xs font-semibold text-ink-3">Что входит в тариф:</p>
            <ul className="grid grid-cols-1 gap-1.5">
              {highlights.map((label, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <CheckCircle className="h-4 w-4 flex-shrink-0 text-ok" aria-hidden="true" />
                  <span className="text-sm text-ink-2">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Главное действие → страница тарифов */}
        <Button size="lg" fullWidth icon={ArrowUpCircle} className="max-w-md" onClick={() => navigate('/tariff')}>
          Перейти к тарифам
        </Button>

        {/* Запасной путь → поддержка в WhatsApp */}
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          icon={MessageCircle}
          className="mt-3 max-w-md"
          onClick={() => openWhatsApp(unlockingPlan.name)}
        >
          Написать в поддержку
        </Button>

        <Button variant="ghost" size="sm" icon={ArrowLeft} className="mt-3" onClick={() => navigate(-1)}>
          Вернуться назад
        </Button>
      </div>
    );
  }

  // ─── Fallback: no plan offers this key → generic copy ──────────────────────
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface-3">
        <Lock className="h-7 w-7 text-ink-3" aria-hidden="true" />
      </div>

      <h2 className="text-center text-title text-ink">{title}</h2>
      <span className="mb-2 mt-2 text-sm font-semibold text-bad-text">Недоступно в вашем тарифе</span>
      <p className="mb-5 max-w-md text-center text-sm leading-relaxed text-ink-3">{description}</p>

      {/* Что даёт раздел */}
      <div className="mb-5 w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-card">
        <p className="mb-3 text-sm font-semibold text-ink">Что вы получите:</p>
        <ul>
          {benefits.map((b, i) => (
            <li key={i} className="flex items-center gap-2.5 py-1.5">
              <CheckCircle className="h-5 w-5 flex-shrink-0 text-ok" aria-hidden="true" />
              <span className="text-sm text-ink-2">{b}</span>
            </li>
          ))}
        </ul>
      </div>

      <Button size="lg" fullWidth icon={ArrowUpCircle} className="max-w-md" onClick={() => openWhatsApp()}>
        Улучшить тариф
      </Button>

      <Button variant="ghost" size="sm" icon={ArrowLeft} className="mt-3" onClick={() => navigate(-1)}>
        Вернуться назад
      </Button>
    </div>
  );
}
