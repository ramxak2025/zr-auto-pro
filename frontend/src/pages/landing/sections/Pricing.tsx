import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Wrench } from 'lucide-react';
import Reveal from './Reveal';
import { pricing } from '../content';

/**
 * Компактный тизер тарифов на главной. id="pricing" сохранён — старые якоря
 * /#pricing продолжают работать. Полные карточки планов, «Внедрение под ключ»
 * и таблица сравнения переехали на отдельную страницу /tarify (TarifyPage +
 * pricingShared.tsx) — главная стала короче, тяжёлая таблица/карусель ушла.
 */
export default function Pricing() {
  const impl = pricing.implementation;

  return (
    <section id="pricing" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            {pricing.title}
          </h2>
          <p className="mt-4 text-lg text-slate-600">{pricing.subtitle}</p>
        </Reveal>

        <Reveal delay={0.05}>
          <div className="mx-auto mt-8 max-w-2xl overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-sm sm:mt-12">
            {/* Три мини-строки планов одной карточкой */}
            <ul className="divide-y divide-slate-100">
              {pricing.plans.map((plan) => (
                <li key={plan.key} className="flex items-center justify-between gap-3 px-5 py-4 sm:px-7">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{plan.name}</span>
                      {plan.badge && (
                        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">
                          {plan.badge}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-sm text-slate-500">{plan.employees}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right">
                    <span className="text-lg font-extrabold tracking-tight text-slate-900">{plan.price} ₽</span>
                    <span className="text-sm font-medium text-slate-400">/мес</span>
                  </span>
                </li>
              ))}
            </ul>

            {/* Внедрение — одной строкой; подробности на /tarify */}
            <p className="flex items-center gap-2.5 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5 text-sm text-slate-600 sm:px-7">
              <Wrench className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              {impl.title} — {impl.price} {impl.priceNote}
            </p>

            <div className="px-5 pb-6 pt-4 sm:px-7">
              <Link
                to="/tarify"
                className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 px-6 text-base font-semibold text-white shadow-lg shadow-primary-600/25 transition hover:bg-primary-500 motion-safe:active:scale-[0.98] active:bg-primary-700"
              >
                Смотреть тарифы
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
              <p className="mt-4 flex items-center justify-center gap-2 text-center text-sm text-slate-500">
                <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-emerald-500" />
                {pricing.honestyNote}
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
