import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, CheckCircle, ArrowUpCircle, ArrowLeft } from 'lucide-react';
import { subscriptionApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import type { SubscriptionInfo } from '../types';

interface FeatureGateProps {
  featureKey: string;
  title: string;
  description: string;
  benefits: string[];
  children: ReactNode;
}

/**
 * Wraps a page and shows a paywall stub if the feature
 * is not included in the tenant's current plan.
 * Web equivalent of mobile FeatureGate.
 */
export default function FeatureGate({ featureKey, title, description, benefits, children }: FeatureGateProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => { const res = await subscriptionApi.get(); return res.data; },
    staleTime: 5 * 60 * 1000,
  });

  // Superadmin & director always have access
  if (user?.role === UserRole.SUPERADMIN || user?.role === UserRole.DIRECTOR) {
    return <>{children}</>;
  }

  // Optimistic: show children while loading
  if (!sub) return <>{children}</>;

  // Check if feature is in current plan
  const currentPlan = sub.plans?.find(p => p.name === sub.planName);
  const planFeatures: string[] = Array.isArray(currentPlan?.features) ? currentPlan!.features : [];

  if (planFeatures.includes(featureKey)) {
    return <>{children}</>;
  }

  const openWhatsApp = () => {
    const msg = encodeURIComponent(`Здравствуйте! Хочу подключить функцию "${title}".`);
    window.open(`https://wa.me/79884444436?text=${msg}`, '_blank');
  };

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
        onClick={openWhatsApp}
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
