import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, MessageCircle, Minus, Wrench } from 'lucide-react';
import { formatRub, pricing, yearlyMonthly, type PlanCellValue, type PricingPlan } from '../content';
import { getWhatsAppUrl, WHATSAPP_IMPLEMENTATION_MESSAGE } from '../config';

/**
 * Общие «тяжёлые» куски тарифов: карточка плана (с переключателем месяц/год),
 * карта «Внедрение под ключ», полное сравнение (desktop-таблица + mobile —
 * горизонтально листаемая таблица со «липкой» первой колонкой). Используются
 * страницей /tarify; главная показывает компактный тизер (Pricing.tsx).
 */

export type Billing = 'monthly' | 'yearly';

const CTA_BASE =
  'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold transition motion-safe:active:scale-[0.98]';

/** CTA «Оставить заявку» → B2B-заявка на подключение автосервиса (/register). */
function PlanCta({ plan }: { plan: PricingPlan }) {
  const cls = `${CTA_BASE} ${
    plan.highlighted
      ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/25 hover:bg-primary-500 active:bg-primary-700'
      : 'border border-slate-200 bg-white text-slate-900 shadow-sm hover:border-primary-300 hover:text-primary-600'
  }`;
  return (
    <Link to="/register" className={cls}>
      Оставить заявку
    </Link>
  );
}

/** Ячейка сравнения: ✓ emerald / — slate-300 / текст («до 10», «1000 мин/мес»). */
function CompareCell({ value }: { value: PlanCellValue }) {
  if (value === true) {
    return (
      <>
        <Check aria-hidden className="mx-auto h-5 w-5 text-emerald-500" />
        <span className="sr-only">Входит</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus aria-hidden className="mx-auto h-4 w-4 text-slate-300" />
        <span className="sr-only">Не входит</span>
      </>
    );
  }
  return <span className="text-sm font-semibold text-slate-900">{value}</span>;
}

/** Карточка тарифа; «Легенда» — primary-бордер, бейдж и подъём на desktop. */
export function PlanCard({ plan, billing }: { plan: PricingPlan; billing: Billing }) {
  const monthly = billing === 'yearly' ? yearlyMonthly(plan.priceMonthly) : plan.priceMonthly;
  return (
    <div
      className={`relative flex h-full flex-col rounded-3xl bg-white p-6 sm:p-7 ${
        plan.highlighted
          ? 'border border-primary-300 shadow-md ring-1 ring-primary-200/60 md:-translate-y-2'
          : 'border border-slate-200/60 shadow-sm'
      }`}
    >
      {plan.badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary-600 px-3 py-1 text-[11px] font-semibold text-white shadow-md shadow-primary-600/25">
          {plan.badge}
        </span>
      )}
      <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
      <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
      <p className="mt-5 flex items-baseline gap-1.5">
        <span className="text-4xl font-extrabold tracking-tight text-slate-900">{formatRub(monthly)} ₽</span>
        <span className="text-sm font-medium text-slate-400">/мес</span>
      </p>
      {billing === 'yearly' ? (
        <p className="mt-1 text-sm text-slate-500">
          {formatRub(monthly * 12)} ₽ в год ·{' '}
          <span className="text-slate-400 line-through">{formatRub(plan.priceMonthly)} ₽/мес</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500">При оплате за год — дешевле на 20%</p>
      )}
      <p className="mt-4 text-sm font-medium text-slate-600">{plan.employees}</p>
      <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">Что входит</p>
      <ul className="mt-3 space-y-2.5">
        {plan.includes.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            {item}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6">
        <PlanCta plan={plan} />
        <p className="mt-2 text-center text-xs text-slate-400">Для организаций — юрлиц и ИП · менеджер подключит</p>
      </div>
    </div>
  );
}

/** Широкая карта «Внедрение под ключ». */
export function ImplementationCard() {
  const impl = pricing.implementation;
  const implUrl = getWhatsAppUrl(WHATSAPP_IMPLEMENTATION_MESSAGE);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white p-5 shadow-sm sm:p-8">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 -top-24 h-56 w-[420px] rounded-full bg-primary-200/40 blur-[90px]" />
      </div>
      <div className="relative flex flex-col gap-5 md:gap-8 lg:flex-row lg:items-center lg:gap-12">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100">
              <Wrench className="h-5 w-5 text-amber-700" />
            </span>
            <h3 className="text-xl font-bold text-slate-900">{impl.title}</h3>
          </div>
          <p className="mt-3 hidden text-sm leading-relaxed text-slate-600 md:block">{impl.text}</p>
          <ul className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {impl.includes.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
                <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <span className="line-clamp-1 md:line-clamp-none">{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="shrink-0 text-center lg:w-60 lg:text-right">
          <p className="flex items-baseline justify-center gap-1.5 lg:justify-end">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900">{impl.price}</span>
            <span className="text-sm font-medium text-slate-400">{impl.priceNote}</span>
          </p>
          <p className="mt-1 text-sm text-slate-500">{impl.duration}</p>
          {implUrl && (
            <a
              href={implUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 motion-safe:active:scale-[0.98] active:bg-emerald-600 lg:w-auto"
            >
              <MessageCircle className="h-4 w-4" />
              {impl.ctaLabel}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Ряды таблицы сравнения: различия сверху + «Во всех тарифах» ниже. */
function comparisonRows(): { section?: string; feature: string; values: PlanCellValue[] }[] {
  const diff = pricing.differences.map((r) => ({ feature: r.feature, values: r.values as PlanCellValue[] }));
  const common = pricing.commonFeatures.map((f, i) => ({
    section: i === 0 ? pricing.commonLabel : undefined,
    feature: f,
    values: pricing.plans.map(() => true as PlanCellValue),
  }));
  return [...diff, ...common];
}

/** Desktop (md+): полная таблица сравнения. */
export function ComparisonTable() {
  const highlightIdx = pricing.plans.findIndex((p) => p.highlighted);
  return (
    <div className="mt-8 overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-sm">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200/60">
            <th scope="col" className="px-6 py-4 text-sm font-semibold text-slate-500">
              Возможность
            </th>
            {pricing.plans.map((p, i) => (
              <th
                key={p.key}
                scope="col"
                className={`w-[17%] px-4 py-4 text-center ${i === highlightIdx ? 'bg-primary-50/60' : ''}`}
              >
                <span className={`block text-sm font-bold ${p.highlighted ? 'text-primary-700' : 'text-slate-900'}`}>
                  {p.name}
                </span>
                <span className="mt-0.5 block text-xs font-medium text-slate-400">
                  {formatRub(p.priceMonthly)} ₽/мес
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pricing.differences.map((row, ri) => (
            <tr key={row.feature} className={`border-b border-slate-100 ${ri % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
              <td className="px-6 py-3.5 text-sm text-slate-700">{row.feature}</td>
              {row.values.map((value, i) => (
                <td key={i} className={`px-4 py-3.5 text-center ${i === highlightIdx ? 'bg-primary-50/40' : ''}`}>
                  <CompareCell value={value} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tbody>
          <tr className="border-b border-slate-100 bg-slate-100/70">
            <th
              scope="rowgroup"
              colSpan={pricing.plans.length + 1}
              className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              {pricing.commonLabel}
            </th>
          </tr>
          {pricing.commonFeatures.map((feature, ri) => (
            <tr
              key={feature}
              className={`border-b border-slate-100 last:border-0 ${ri % 2 === 1 ? 'bg-slate-50/60' : ''}`}
            >
              <td className="px-6 py-3 text-sm text-slate-700">{feature}</td>
              {pricing.plans.map((p, i) => (
                <td key={p.key} className={`px-4 py-3 text-center ${i === highlightIdx ? 'bg-primary-50/40' : ''}`}>
                  <CompareCell value={true} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Mobile: та же таблица, но горизонтально листаемая. Первая колонка
 * «возможность» — sticky left-0 (не уезжает при свайпе), справа edge-fade
 * подсказывает, что есть ещё колонки; подсказка «Листайте вбок →» гаснет
 * после первого горизонтального сдвига. overscroll-behavior-x: contain —
 * горизонтальный жест не тянет страницу, вертикальный скролл не ломается.
 */
export function ComparisonTableMobile() {
  const [scrolled, setScrolled] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const highlightIdx = pricing.plans.findIndex((p) => p.highlighted);
  const rows = comparisonRows();

  return (
    <div className="mt-8">
      <p
        className={`mb-2 text-right text-xs text-slate-400 transition-opacity duration-300 ${
          scrolled ? 'opacity-0' : 'opacity-100'
        }`}
      >
        Листайте таблицу вбок →
      </p>
      <div className="relative">
        <div
          ref={scrollerRef}
          onScroll={(e) => {
            if (!scrolled && e.currentTarget.scrollLeft > 8) setScrolled(true);
          }}
          className="no-scrollbar overflow-x-auto rounded-2xl border border-slate-200/60 bg-white shadow-sm [overscroll-behavior-x:contain]"
        >
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200/60">
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-[150px] bg-white px-4 py-3 text-xs font-semibold text-slate-500 shadow-[1px_0_0_rgba(226,232,240,0.8)]"
                >
                  Возможность
                </th>
                {pricing.plans.map((p, i) => (
                  <th
                    key={p.key}
                    scope="col"
                    className={`min-w-[104px] px-3 py-3 text-center ${i === highlightIdx ? 'bg-primary-50/60' : ''}`}
                  >
                    <span
                      className={`block text-sm font-bold ${p.highlighted ? 'text-primary-700' : 'text-slate-900'}`}
                    >
                      {p.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-medium text-slate-400">
                      {formatRub(p.priceMonthly)} ₽
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={row.feature} className="border-b border-slate-100 last:border-0">
                  <td
                    className={`sticky left-0 z-10 min-w-[150px] px-4 py-3 text-sm text-slate-700 shadow-[1px_0_0_rgba(226,232,240,0.8)] ${
                      ri % 2 === 1 ? 'bg-slate-50' : 'bg-white'
                    }`}
                  >
                    {row.section && (
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {row.section}
                      </span>
                    )}
                    {row.feature}
                  </td>
                  {row.values.map((value, i) => (
                    <td
                      key={i}
                      className={`min-w-[104px] px-3 py-3 text-center ${
                        i === highlightIdx ? 'bg-primary-50/40' : ri % 2 === 1 ? 'bg-slate-50/60' : ''
                      }`}
                    >
                      <CompareCell value={value} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* edge-fade справа — подсказка, что таблица шире экрана */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-2xl bg-gradient-to-l from-white to-transparent transition-opacity duration-300 ${
            scrolled ? 'opacity-0' : 'opacity-100'
          }`}
        />
      </div>
    </div>
  );
}
