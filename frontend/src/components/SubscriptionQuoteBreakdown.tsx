import type { SubscriptionQuotePreview } from '../../../shared/types';
import { formatSubscriptionMoney as money, subscriptionMonthlyLabel } from '../utils/subscriptionPricingText';
export default function SubscriptionQuoteBreakdown({ preview }: { preview: SubscriptionQuotePreview }) {
  const q = preview.quote;
  const multiplier = q.chargedMonths;
  return (
    <div className="space-y-2 text-sm text-ink-2" aria-label="Расчёт выбранного состава" aria-live="polite">
      <p>
        Сейчас используется: {preview.usage.employees} сотрудников, включая владельца; филиалов:{' '}
        {preview.usage.activePoints}.
      </p>
      <p>
        В расчёте: {q.employees} сотрудников (включено {q.includedEmployees}, дополнительно {q.extraEmployees});
        филиалов: {q.points}
        {q.includedPoints != null ? ` (включено ${q.includedPoints}, дополнительно ${q.extraPoints})` : ''}.
      </p>
      <p className="text-2xl font-semibold tabular-nums text-ink" data-testid="subscription-monthly-display">
        {subscriptionMonthlyLabel(q)}
      </p>
      <p>{q.period === 'yearly' ? 'в месяц при оплате за год' : 'в месяц'}</p>
      {q.period === 'yearly' && (
        <p className="font-semibold text-ink">К оплате сразу за 12 месяцев: {money(q.total)}</p>
      )}
      <p>
        {q.period === 'yearly' ? 'За 12 месяцев: ' : 'За месяц: '}
        база {money(q.baseMonthlyAmount * multiplier)} + сотрудники {money(q.employeesMonthlyAmount * multiplier)} +
        филиалы {money(q.pointsMonthlyAmount * multiplier)} = {money(q.total)}.
      </p>
      {q.period === 'yearly' && <p>12 месяцев по цене 10, включая все доплаты.</p>}
    </div>
  );
}
