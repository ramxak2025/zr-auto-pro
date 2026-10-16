import type { Plan } from '../../../shared/types';
import { getSubscriptionMonthlyDisplay, type SubscriptionQuote } from '../../../shared/utils/subscriptionPricing';

export const formatSubscriptionMoney = (amount: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

export function subscriptionMonthlyLabel(quote: Pick<SubscriptionQuote, 'total' | 'serviceMonths'>): string {
  const display = getSubscriptionMonthlyDisplay(quote);
  return `${display.approximate ? '≈ ' : ''}${formatSubscriptionMoney(display.amount)}`;
}

export const parseSubscriptionCount = (value: string): number | undefined => {
  const count = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(count) && count >= 1 ? count : undefined;
};

/** Server plan metadata also covers inactive and individually priced plans. */
export function planCompositionLabel(plan: Plan): string {
  const p = plan.pricing;
  if (!p) return `До ${plan.maxUsers} сотрудников. Условия оплаты уточняются отдельно.`;
  return `Сотрудников включено: ${p.includedEmployees}${p.code === 'max' ? ' на всех филиалах вместе' : ''}, включая владельца. При оплате по месяцам: +${formatSubscriptionMoney(p.extraEmployeeMonthlyPrice)} за каждого сверх включённых. ${p.includedPoints != null ? `Филиалов включено: ${p.includedPoints}; +${formatSubscriptionMoney(p.extraPointMonthlyPrice ?? 0)}/мес. за каждый дополнительный.` : 'Один филиал. Для сети выберите MAX.'} За год — 12 месяцев по цене 10, включая доплаты.`;
}
