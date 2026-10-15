import type { SubscriptionQuotePreview } from '../../../shared/types';
const money = (value: number) => `${value.toLocaleString('ru-RU')} ₽`;
export default function SubscriptionQuoteBreakdown({ preview }: { preview: SubscriptionQuotePreview }) {
  const q = preview.quote;
  return (
    <div className="space-y-2 text-sm text-ink-2" aria-label="Расчёт по текущему составу">
      <p>
        Сотрудники, включая владельца: включено {q.includedEmployees}, используется {preview.usage.employees},
        дополнительно в расчёте {q.extraEmployees}.
      </p>
      <p>
        Филиалы: используется {preview.usage.activePoints}
        {q.includedPoints != null ? `, включено ${q.includedPoints}, дополнительно в расчёте ${q.extraPoints}` : ''}.
      </p>
      <p>
        База {money(q.baseMonthlyAmount)} + сотрудники {money(q.employeesMonthlyAmount)} + филиалы{' '}
        {money(q.pointsMonthlyAmount)} = {money(q.monthlyTotal)}/мес.
      </p>
      <p className="font-semibold text-ink">
        {q.period === 'yearly'
          ? `12 месяцев по цене 10: ${money(q.total)} за год, включая все доплаты.`
          : `Расчёт на месяц: ${money(q.total)}.`}
      </p>
    </div>
  );
}
