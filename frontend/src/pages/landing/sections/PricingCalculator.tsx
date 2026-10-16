import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  formatSubscriptionMoney,
  parseSubscriptionCount,
  subscriptionMonthlyLabel,
} from '../../../utils/subscriptionPricingText';
import {
  calculateSubscriptionQuote,
  SUBSCRIPTION_PLAN_PRICING,
  type SubscriptionBillingPeriod,
  type SubscriptionPlanCode,
} from '../../../../../shared/utils/subscriptionPricing';

export const formatPlanMoney = formatSubscriptionMoney;

export function BillingPeriodSwitch({
  period,
  onChange,
}: {
  period: SubscriptionBillingPeriod;
  onChange: (period: SubscriptionBillingPeriod) => void;
}) {
  return (
    <div className="mt-7 flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Срок оплаты" className="inline-flex rounded-2xl bg-slate-100 p-1">
        {(['monthly', 'yearly'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            onClick={() => onChange(value)}
            className={`min-h-[44px] rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${period === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {value === 'yearly' ? 'За год' : 'За месяц'}
          </button>
        ))}
      </div>
      <span className="text-sm text-slate-600">За год — 12 месяцев по цене 10</span>
    </div>
  );
}

function CountField({
  label,
  value,
  onChange,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  note: string;
}) {
  const count = Number(value);
  const valid = /^\d+$/.test(value) && Number.isSafeInteger(count) && count >= 1;
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-900">{label}</span>
      <span className="mt-2 flex h-12 max-w-[230px] items-center overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-primary-500">
        <button
          type="button"
          aria-label={`Уменьшить: ${label}`}
          disabled={!valid || count <= 1}
          onClick={() => onChange(String(count - 1))}
          className="flex h-12 w-12 shrink-0 items-center justify-center text-slate-600 disabled:opacity-30 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          aria-label={label}
          aria-invalid={!valid}
          onChange={(event) => onChange(event.target.value)}
          className="w-full min-w-0 bg-transparent text-center text-base font-semibold tabular-nums text-slate-900 outline-none"
        />
        <button
          type="button"
          aria-label={`Увеличить: ${label}`}
          disabled={!valid || !Number.isSafeInteger(count + 1)}
          onClick={() => onChange(String(count + 1))}
          className="flex h-12 w-12 shrink-0 items-center justify-center text-slate-600 disabled:opacity-30 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          <Plus className="h-4 w-4" />
        </button>
      </span>
      <span className="mt-2 block text-xs leading-relaxed text-slate-500">{note}</span>
    </label>
  );
}

export function PricingCalculator({ period }: { period: SubscriptionBillingPeriod }) {
  const [plan, setPlan] = useState<SubscriptionPlanCode>('pro');
  const [employees, setEmployees] = useState('5');
  const [points, setPoints] = useState('1');
  const [employeesEdited, setEmployeesEdited] = useState(false);
  const pricing = SUBSCRIPTION_PLAN_PRICING[plan];
  const result = calculateSubscriptionQuote(pricing, {
    period,
    employees: parseSubscriptionCount(employees) ?? 0,
    points: parseSubscriptionCount(points) ?? 0,
  });
  const quote = result.ok ? result.quote : null;
  const multiplier = period === 'yearly' ? 10 : 1;
  return (
    <section
      aria-labelledby="pricing-calculator-title"
      className="mt-12 rounded-3xl border border-slate-200 bg-white p-5 sm:p-8"
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:gap-14">
        <div>
          <h2 id="pricing-calculator-title" className="text-2xl font-bold tracking-tight text-slate-900">
            Сколько стоит для вашей команды
          </h2>
          <div role="group" aria-label="Тариф для расчёта" className="mt-5 flex flex-wrap gap-2">
            {(Object.keys(SUBSCRIPTION_PLAN_PRICING) as SubscriptionPlanCode[]).map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={code === plan}
                onClick={() => {
                  setPlan(code);
                  if (!employeesEdited) setEmployees(String(SUBSCRIPTION_PLAN_PRICING[code].includedEmployees));
                }}
                className={`min-h-[44px] rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${code === plan ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {SUBSCRIPTION_PLAN_PRICING[code].name}
              </button>
            ))}
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <CountField
              label="Всего сотрудников"
              value={employees}
              onChange={(value) => {
                setEmployeesEdited(true);
                setEmployees(value);
              }}
              note="Включая владельца. Человек в нескольких филиалах считается один раз."
            />
            <CountField
              label="Всего филиалов"
              value={points}
              onChange={setPoints}
              note="50 включённых сотрудников — на все филиалы суммарно."
            />
          </div>
          {plan !== 'max' && (
            <p className="mt-4 text-xs text-slate-500">Расчёт для одного филиала. Для сети выберите MAX.</p>
          )}
        </div>
        <div
          className="border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
          aria-live="polite"
          aria-atomic="true"
        >
          {quote ? (
            <>
              <p className="text-sm text-slate-600">
                {period === 'yearly' ? 'в месяц при оплате за год' : 'В месяц'} · {pricing.name}
              </p>
              <p
                className="mt-2 text-4xl font-bold tracking-tight tabular-nums text-slate-900"
                data-testid="subscription-total"
              >
                {subscriptionMonthlyLabel(quote)}
              </p>
              {period === 'yearly' && (
                <p className="mt-2 text-sm text-slate-600">
                  К оплате сразу за 12 месяцев: <strong>{formatPlanMoney(quote.total)}</strong>
                </p>
              )}
              <dl
                aria-label={period === 'yearly' ? 'Стоимость за 12 месяцев' : 'Стоимость за месяц'}
                className="mt-6 space-y-3 text-sm"
              >
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">{period === 'yearly' ? 'База за 12 месяцев' : 'Базовая стоимость'}</dt>
                  <dd className="whitespace-nowrap font-medium tabular-nums text-slate-900">
                    {formatPlanMoney(quote.baseMonthlyAmount * multiplier)}
                  </dd>
                </div>
                {quote.extraEmployees > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Доп. сотрудники · {quote.extraEmployees}</dt>
                    <dd className="whitespace-nowrap font-medium tabular-nums text-slate-900">
                      {formatPlanMoney(quote.employeesMonthlyAmount * multiplier)}
                    </dd>
                  </div>
                )}
                {quote.extraPoints > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Доп. филиалы · {quote.extraPoints}</dt>
                    <dd className="whitespace-nowrap font-medium tabular-nums text-slate-900">
                      {formatPlanMoney(quote.pointsMonthlyAmount * multiplier)}
                    </dd>
                  </div>
                )}
                {period === 'yearly' && (
                  <div className="flex justify-between gap-4 border-t border-slate-100 pt-3">
                    <dt className="text-emerald-700">Экономия за год</dt>
                    <dd className="whitespace-nowrap font-semibold tabular-nums text-emerald-700">
                      {formatPlanMoney(quote.monthlyTotal * 2)}
                    </dd>
                  </div>
                )}
              </dl>
              <p className="mt-5 text-xs leading-relaxed text-slate-500">
                {period === 'yearly'
                  ? 'Один платёж за год. Скидка действует и на дополнительных сотрудников, и на филиалы.'
                  : 'Итог включает доплаты за сотрудников и филиалы.'}
              </p>
            </>
          ) : (
            <p role="status" className="text-sm leading-relaxed text-red-700">
              {!result.ok && result.code === 'UNPRICED_POINTS'
                ? 'Для нескольких филиалов выберите MAX. Количество филиалов сохранено.'
                : 'Укажите целое количество сотрудников и филиалов от 1. Число слишком велико или указано неверно.'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
