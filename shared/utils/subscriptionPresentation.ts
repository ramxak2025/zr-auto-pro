import type { Plan, SubscriptionInfo, SubscriptionQuotePreview } from '../types';
import type { SubscriptionBillingPeriod } from './subscriptionPricing';

/** Absence from the active catalogue says nothing about an assigned plan's status. */
export function assignedSubscriptionPlan(sub?: SubscriptionInfo): Plan | undefined {
  if (!sub?.planId) return undefined;
  if (sub.currentPlan?.id === sub.planId) return sub.currentPlan;
  return sub.plans?.find((plan) => plan.id === sub.planId);
}

export function subscriptionOffers(sub?: SubscriptionInfo): Plan[] {
  return (sub?.plans ?? []).filter((plan) => plan.isActive === true && !!plan.pricing);
}

export function initialSubscriptionOffer(sub?: SubscriptionInfo): string | undefined {
  const current = assignedSubscriptionPlan(sub);
  if (current?.isActive === false) return undefined;
  return subscriptionOffers(sub).find((plan) => plan.id === sub?.planId)?.id;
}

/** Only a complete quote matching the visible controls can be displayed or contacted about. */
export function matchesSubscriptionQuote(
  preview: SubscriptionQuotePreview | undefined,
  planId: string | undefined,
  period: SubscriptionBillingPeriod,
  employees: number | undefined,
  points: number | undefined,
): preview is SubscriptionQuotePreview {
  return (
    !!preview &&
    !!planId &&
    preview.planId === planId &&
    preview.quote.period === period &&
    preview.quote.employees === employees &&
    preview.quote.points === points
  );
}
