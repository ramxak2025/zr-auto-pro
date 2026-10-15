import type { Plan } from '../../../shared/types';
/** Public plan metadata; totals always come from the server quote. */
export function planCompositionLabel(plan: Plan): string {
  const p = plan.pricing;
  if (!p) return `До ${plan.maxUsers} сотрудников`;
  const money = (v: number) => `${v.toLocaleString('ru-RU')} ₽`;
  return `Включено ${p.includedEmployees} сотрудников${p.code === 'max' ? ' на всех филиалах вместе' : ''}, включая владельца; +${money(p.extraEmployeeMonthlyPrice)}/мес за каждого сверх включённых. ${p.includedPoints != null ? `Филиалов включено ${p.includedPoints}; +${money(p.extraPointMonthlyPrice ?? 0)}/мес за каждый дополнительный.` : 'Дополнительные филиалы — по согласованию.'} Год: полная стоимость × 10 за 12 месяцев.`;
}
