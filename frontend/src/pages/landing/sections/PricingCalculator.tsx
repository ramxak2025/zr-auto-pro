import { useId, useState } from 'react';
import { ArrowRight, ChevronDown, Minus, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  formatSubscriptionMoney as money,
  parseSubscriptionCount,
  subscriptionMonthlyLabel,
} from '../../../utils/subscriptionPricingText';
import {
  calculateSubscriptionQuote,
  SUBSCRIPTION_PLAN_PRICING,
  type SubscriptionBillingPeriod,
  type SubscriptionPlanCode,
} from '../../../../../shared/utils/subscriptionPricing';
import { pricingCalculator } from '../content';
import { ComparisonTable, ComparisonTableMobile } from './pricingShared';

const controlFocus =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600';

export function BillingPeriodSwitch({
  period,
  onChange,
}: {
  period: SubscriptionBillingPeriod;
  onChange: (period: SubscriptionBillingPeriod) => void;
}) {
  return (
    <div role="group" aria-label="Срок оплаты" className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {(['monthly', 'yearly'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={period === value}
          onClick={() => onChange(value)}
          className={`min-h-[44px] rounded-lg px-4 text-sm font-semibold transition-colors ${controlFocus} ${period === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {value === 'yearly' ? 'За год · 12 за 10' : 'За месяц'}
        </button>
      ))}
    </div>
  );
}

function CountField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId(),
    count = parseSubscriptionCount(value);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-900">
        {label}
      </label>
      <div className="mt-2 flex h-12 items-center rounded-xl border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-primary-500">
        <button
          type="button"
          aria-label={`Уменьшить: ${label}`}
          disabled={count === undefined || count <= 1}
          onClick={() => onChange(String((count ?? 1) - 1))}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-l-xl text-slate-600 hover:bg-slate-50 disabled:opacity-30 ${controlFocus}`}
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          aria-label={label}
          aria-invalid={count === undefined}
          onChange={(event) => onChange(event.target.value)}
          className="w-full min-w-0 bg-transparent text-center text-lg font-semibold tabular-nums text-slate-900 outline-none"
        />
        <button
          type="button"
          aria-label={`Увеличить: ${label}`}
          disabled={count === undefined || !Number.isSafeInteger(count + 1)}
          onClick={() => onChange(String((count ?? 1) + 1))}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-r-xl text-slate-600 hover:bg-slate-50 disabled:opacity-30 ${controlFocus}`}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** One composition, one monthly headline. Plan and period never alter entered counts. */
export function PricingCalculator() {
  const id = useId();
  const [plan, setPlan] = useState<SubscriptionPlanCode>('baza');
  const [period, setPeriod] = useState<SubscriptionBillingPeriod>('yearly');
  const [employees, setEmployees] = useState('1');
  const [points, setPoints] = useState('1');
  const pricing = SUBSCRIPTION_PLAN_PRICING[plan];
  const result = calculateSubscriptionQuote(pricing, {
    period,
    employees: parseSubscriptionCount(employees) ?? 0,
    points: parseSubscriptionCount(points) ?? 0,
  });
  const quote = result.ok ? result.quote : null;
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="public-pricing-calculator"
      className="overflow-hidden rounded-3xl border border-slate-200 bg-white"
    >
      <div className="grid lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5 p-5 sm:p-8">
          <h2 id={`${id}-title`} className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {pricingCalculator.title}
          </h2>
          <div>
            <div className="grid grid-cols-2 gap-4">
              <CountField label="Всего сотрудников" value={employees} onChange={setEmployees} />
              <CountField label="Всего филиалов" value={points} onChange={setPoints} />
            </div>
            <div role="group" aria-label="Быстрый выбор сотрудников" className="mt-3 flex flex-wrap gap-2">
              {[1, 2, 3, 5, 10].map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-label={`${count} сотрудников`}
                  aria-pressed={employees === String(count)}
                  onClick={() => setEmployees(String(count))}
                  className={`min-h-[44px] min-w-[44px] rounded-lg px-3 text-sm font-semibold tabular-nums ${controlFocus} ${employees === String(count) ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  {count}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">{pricingCalculator.countHint}</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">Тариф</p>
            <div role="group" aria-label="Тариф для расчёта" className="grid grid-cols-3 gap-2">
              {pricingCalculator.plans.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  aria-label={SUBSCRIPTION_PLAN_PRICING[option.code].name}
                  aria-pressed={plan === option.code}
                  onClick={() => setPlan(option.code)}
                  className={`min-h-[64px] min-w-0 rounded-xl border px-2 py-2 text-left transition-colors ${controlFocus} ${plan === option.code ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-700 hover:border-primary-300'}`}
                >
                  <span className="block text-sm font-bold">{SUBSCRIPTION_PLAN_PRICING[option.code].name}</span>
                  <span className="mt-0.5 block text-xs">{option.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 min-h-[40px] text-sm leading-relaxed text-slate-600">
              {pricingCalculator.plans.find((option) => option.code === plan)?.description}
            </p>
          </div>
          <BillingPeriodSwitch period={period} onChange={setPeriod} />
        </div>
        <div
          className="flex flex-col justify-center border-t border-slate-200 bg-primary-50/50 p-5 sm:p-8 lg:border-l lg:border-t-0"
          aria-live="polite"
          aria-atomic="true"
        >
          {quote ? (
            <>
              <p className="text-sm font-semibold text-slate-700">{pricing.name} · для вашей команды</p>
              <p
                className="mt-3 text-4xl font-extrabold tracking-tight tabular-nums text-primary-700 sm:text-5xl"
                data-testid="subscription-total"
              >
                {subscriptionMonthlyLabel(quote)}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {period === 'yearly' ? 'в месяц при оплате за год' : 'в месяц'}
              </p>
              {period === 'yearly' && (
                <p data-testid="subscription-upfront" className="mt-4 text-sm leading-relaxed text-slate-700">
                  К оплате сразу за 12 месяцев:{' '}
                  <strong className="whitespace-nowrap tabular-nums">{money(quote.total)}</strong>
                </p>
              )}
              <Link
                to="/register"
                className={`mt-6 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 font-semibold text-white transition-colors hover:bg-primary-700 ${controlFocus}`}
              >
                Оставить заявку
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <p className="mt-2 text-xs text-slate-600">{pricingCalculator.ctaHint}</p>
            </>
          ) : (
            <div role="status" className="space-y-4 text-sm leading-relaxed text-slate-700">
              <p>
                {!result.ok && result.code === 'UNPRICED_POINTS'
                  ? 'Для нескольких филиалов нужен MAX. Состав команды сохранён.'
                  : 'Укажите целое количество сотрудников и филиалов от 1. Слишком большое число не подходит для расчёта.'}
              </p>
              {!result.ok && result.code === 'UNPRICED_POINTS' && (
                <button
                  type="button"
                  onClick={() => setPlan('max')}
                  className={`min-h-[44px] rounded-xl bg-primary-600 px-5 font-semibold text-white hover:bg-primary-700 ${controlFocus}`}
                >
                  Рассчитать MAX
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {quote && (
        <details className="border-t border-slate-200 px-5 sm:px-8">
          <summary
            className={`flex min-h-[52px] cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-slate-700 ${controlFocus}`}
          >
            Из чего складывается стоимость
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          </summary>
          <dl
            className="space-y-2 pb-5 text-sm text-slate-600"
            aria-label={period === 'yearly' ? 'Стоимость за 12 месяцев' : 'Стоимость за месяц'}
          >
            <div className="flex justify-between gap-4">
              <dt>Включено сотрудников</dt>
              <dd>
                {quote.includedEmployees}
                {plan === 'max' ? ' на все филиалы' : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{period === 'yearly' ? 'База за 12 месяцев' : 'База за месяц'}</dt>
              <dd className="whitespace-nowrap tabular-nums">{money(quote.baseMonthlyAmount * quote.chargedMonths)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Доп. сотрудники · {quote.extraEmployees}</dt>
              <dd className="whitespace-nowrap tabular-nums">
                {money(quote.employeesMonthlyAmount * quote.chargedMonths)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Доп. филиалы · {quote.extraPoints}</dt>
              <dd className="whitespace-nowrap tabular-nums">
                {money(quote.pointsMonthlyAmount * quote.chargedMonths)}
              </dd>
            </div>
            {period === 'yearly' && (
              <div className="flex justify-between gap-4">
                <dt>Экономия за год</dt>
                <dd className="whitespace-nowrap tabular-nums">{money(quote.monthlyTotal * 2)}</dd>
              </div>
            )}
          </dl>
        </details>
      )}
      <details className="border-t border-slate-200 px-5 sm:px-8">
        <summary
          className={`flex min-h-[52px] cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-slate-700 ${controlFocus}`}
        >
          Сравнить все возможности тарифов
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
        </summary>
        <div className="hidden pb-5 md:block">
          <ComparisonTable />
        </div>
        <div className="pb-5 md:hidden">
          <ComparisonTableMobile />
        </div>
      </details>
    </section>
  );
}
