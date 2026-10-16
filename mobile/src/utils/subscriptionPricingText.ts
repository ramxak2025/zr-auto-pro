import type { Plan, SubscriptionQuotePreview } from '../../../shared/types';
export const subscriptionMoney = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
/** Public plan metadata; totals always come from the server quote. */
export function planCompositionLabel(plan: Plan): string {
  const p = plan.pricing;
  if (!p) return `Лимит сотрудников: ${plan.maxUsers}`;
  return `Сотрудников включено: ${p.includedEmployees}${p.code === 'max' ? ' на всех филиалах вместе' : ''}, включая владельца. Каждый сверх включённых при помесячной оплате: ${subscriptionMoney(p.extraEmployeeMonthlyPrice)}/мес. ${p.includedPoints != null ? `Филиалов включено ${p.includedPoints}; каждый дополнительный при помесячной оплате: ${subscriptionMoney(p.extraPointMonthlyPrice ?? 0)}/мес.` : 'Для нескольких филиалов выберите MAX.'} При оплате за год скидка действует и на доплаты.`;
}
export function subscriptionCount(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
export function subscriptionQuoteError(error: unknown) {
  return (
    error as {
      response?: {
        status?: number;
        data?: { code?: string; message?: string; minimumEmployees?: number; minimumPoints?: number };
      };
    }
  )?.response;
}

export function subscriptionContactText(planName?: string, preview?: SubscriptionQuotePreview): string {
  const intro = planName
    ? `Здравствуйте! Хочу подключить тариф "${planName}".`
    : 'Здравствуйте! Хочу оплатить подписку.';
  if (!preview) return intro;
  const q = preview.quote;
  return `${intro} Расчёт: ${preview.pricing.name}. Сотрудники: ${q.employees} · Филиалы: ${q.points}. Период: ${q.period === 'yearly' ? '12 месяцев' : 'месяц'}. К оплате: ${subscriptionMoney(q.total)}.`;
}
