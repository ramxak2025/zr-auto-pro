import { Link } from 'react-router-dom';
import { Check, ChevronDown, MessageCircle, Minus, Wrench } from 'lucide-react';
import { pricing, type PlanCellValue, type PricingPlan } from '../content';
import { getPlanConnectMessage, getWhatsAppUrl, WHATSAPP_IMPLEMENTATION_MESSAGE } from '../config';

/**
 * Общие «тяжёлые» куски тарифов: карточка плана, карта «Внедрение под ключ»,
 * полное сравнение (desktop-таблица + mobile-details). Раньше жили в секции
 * Pricing на главной; с появлением отдельной страницы /tarify главная показывает
 * только компактный тизер (Pricing.tsx), а весь этот блок использует TarifyPage.
 */

const CTA_BASE =
  'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold transition motion-safe:active:scale-[0.98]';

/** CTA «Подключить» → WhatsApp с тарифом в сообщении; контактов нет → «Войти». */
function PlanCta({ plan }: { plan: PricingPlan }) {
  const cls = `${CTA_BASE} ${
    plan.highlighted
      ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/25 hover:bg-primary-500 active:bg-primary-700'
      : 'border border-slate-200 bg-white text-slate-900 shadow-sm hover:border-primary-300 hover:text-primary-600'
  }`;
  const url = getWhatsAppUrl(getPlanConnectMessage(plan.name));
  if (!url) {
    return (
      <Link to="/login" className={cls}>
        Войти
      </Link>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cls}>
      <MessageCircle className="h-4 w-4" />
      Подключить
    </a>
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

/** Мини-чип мобильного сравнения: буква плана + ✓/—/значение. */
function MiniChip({ label, value }: { label: string; value: PlanCellValue }) {
  const included = value !== false;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
        included ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
      }`}
    >
      <span className="font-semibold">{label}</span>
      {value === true ? (
        <>
          <Check aria-hidden className="h-3 w-3" />
          <span className="sr-only">входит</span>
        </>
      ) : value === false ? (
        <>
          <Minus aria-hidden className="h-3 w-3" />
          <span className="sr-only">не входит</span>
        </>
      ) : (
        value
      )}
    </span>
  );
}

/** Карточка тарифа; «Легенда» — primary-бордер, бейдж и подъём на desktop. */
export function PlanCard({ plan }: { plan: PricingPlan }) {
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
        <span className="text-4xl font-extrabold tracking-tight text-slate-900">{plan.price} ₽</span>
        <span className="text-sm font-medium text-slate-400">/мес</span>
      </p>
      <p className="mt-1 text-sm font-medium text-slate-600">{plan.employees}</p>
      <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-400">Что входит</p>
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
          {/* Абзац-описание — только md+: на мобиле карта компактная
              (заголовок + пункты + цена + CTA) */}
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

/** Desktop (md+): полная таблица сравнения — различия сверху, общее ниже. */
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
                <span className="mt-0.5 block text-xs font-medium text-slate-400">{p.price} ₽/мес</span>
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

/** Mobile: полное сравнение — свёрнутый details, без горизонтального скролла. */
export function ComparisonDetails() {
  return (
    <details className="group mt-10 rounded-2xl border border-slate-200/60 bg-white shadow-sm">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        Полное сравнение возможностей
        <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t border-slate-100 px-5 pb-5">
        <p className="pt-4 text-xs text-slate-400">{pricing.planShortLegend}</p>
        <ul className="mt-4 space-y-4">
          {pricing.differences.map((row) => (
            <li key={row.feature}>
              <p className="text-sm font-medium text-slate-700">{row.feature}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {row.values.map((value, i) => (
                  <MiniChip key={pricing.planShortNames[i]} label={pricing.planShortNames[i]} value={value} />
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">{pricing.commonLabel}</p>
        <ul className="mt-3 space-y-2">
          {pricing.commonFeatures.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600">
              <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
