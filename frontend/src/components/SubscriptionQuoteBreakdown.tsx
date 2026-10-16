import { ChevronDown } from 'lucide-react';
import type { SubscriptionQuotePreview } from '../../../shared/types';
import { formatSubscriptionMoney as money, subscriptionMonthlyLabel } from '../utils/subscriptionPricingText';
export default function SubscriptionQuoteBreakdown({
  preview,
  compact = false,
}: {
  preview: SubscriptionQuotePreview;
  compact?: boolean;
}) {
  const q = preview.quote;
  const multiplier = q.chargedMonths;
  return (
    <div className="space-y-2 text-sm text-ink-2" aria-label="Расчёт выбранного состава" aria-live="polite">
      {!compact && (
        <>
          <p>
            Сейчас сотрудников: {preview.usage.employees}, включая владельца; филиалов: {preview.usage.activePoints}.
          </p>
          <p>
            В расчёте сотрудников: {q.employees} (включено {q.includedEmployees}, дополнительно {q.extraEmployees});
            филиалов: {q.points}
            {q.includedPoints != null ? ` (включено ${q.includedPoints}, дополнительно ${q.extraPoints})` : ''}.
          </p>
        </>
      )}
      <p className="text-2xl font-semibold tabular-nums text-ink" data-testid="subscription-monthly-display">
        {subscriptionMonthlyLabel(q)}
      </p>
      <p>{q.period === 'yearly' ? 'в месяц при оплате за год' : 'в месяц'}</p>
      {q.period === 'yearly' && (
        <p className="font-semibold text-ink">К оплате сразу за 12 месяцев: {money(q.total)}</p>
      )}
      {compact ? (
        <details className="border-t border-line pt-1">
          <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 font-medium text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            Из чего складывается стоимость
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          </summary>
          <div className="space-y-2 pb-2">
            <p>
              Сейчас сотрудников: {preview.usage.employees}, включая владельца; филиалов: {preview.usage.activePoints}.
            </p>
            <p>
              В расчёте сотрудников: {q.employees} (включено {q.includedEmployees}, дополнительно {q.extraEmployees});
              филиалов: {q.points}
              {q.includedPoints != null ? ` (включено ${q.includedPoints}, дополнительно ${q.extraPoints})` : ''}.
            </p>
            <p>
              {q.period === 'yearly' ? 'За 12 месяцев: ' : 'За месяц: '}
              база {money(q.baseMonthlyAmount * multiplier)} + сотрудники {money(q.employeesMonthlyAmount * multiplier)}{' '}
              + филиалы {money(q.pointsMonthlyAmount * multiplier)} = {money(q.total)}.
            </p>
            {q.period === 'yearly' && <p>12 месяцев по цене 10, включая все доплаты.</p>}
          </div>
        </details>
      ) : (
        <>
          <p>
            {q.period === 'yearly' ? 'За 12 месяцев: ' : 'За месяц: '}
            база {money(q.baseMonthlyAmount * multiplier)} + сотрудники {money(q.employeesMonthlyAmount * multiplier)} +
            филиалы {money(q.pointsMonthlyAmount * multiplier)} = {money(q.total)}.
          </p>
          {q.period === 'yearly' && <p>12 месяцев по цене 10, включая все доплаты.</p>}
        </>
      )}
    </div>
  );
}
