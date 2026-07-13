import { Check, Minus } from 'lucide-react';
import Reveal from './Reveal';
import CtaButton from './CtaButton';
import { netProfit } from '../content';

/**
 * «Чистая прибыль в реальном времени» — маркерная финансовая секция главной.
 * Слева: продающая копия + чипы «с учётом всех расходов» + 3 выгоды + CTA.
 * Справа: CSS-мокап виджета приложения (идиома CheckMock/PlateMock) — выручка
 * минус амортизированные по дням расходы = честная чистая прибыль + прогноз.
 *
 * Тема светлая, изумруд = деньги (DESIGN.md). Все числа иллюстративные —
 * это пример экрана, а не цена продукта (сайт остаётся B2B и без цен).
 */
export default function NetProfit() {
  const { title, tagline, lead, amortized, benefits, mock } = netProfit;

  return (
    <section id="profit" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:items-center lg:gap-16">
        {/* ── Левая колонка: копия ── */}
        <Reveal>
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl text-balance">{title}</h2>
          <p className="mt-4 text-lg text-slate-600 text-pretty">{tagline}</p>
          <p className="mt-4 max-w-xl leading-relaxed text-slate-500 text-pretty">{lead}</p>

          {/* Чипы «с учётом всех расходов» */}
          <div className="mt-6">
            <p className="text-sm font-semibold text-slate-700">С учётом всех расходов:</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {amortized.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* 3 выгоды — список, не сетка карточек */}
          <ul className="mt-8 space-y-4">
            {benefits.map((b) => (
              <li key={b.title} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-3.5 w-3.5 text-emerald-700" strokeWidth={3} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-slate-900">{b.title}</h3>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{b.text}</p>
                </div>
              </li>
            ))}
          </ul>

          <CtaButton className="mt-9" />
        </Reveal>

        {/* ── Правая колонка: мокап виджета «Чистая прибыль» ── */}
        <Reveal delay={0.1}>
          <div className="relative mx-auto w-full max-w-md">
            {/* Мягкая изумрудная подсветка под карточкой */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] bg-emerald-200/30 blur-3xl"
            />
            <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-xl shadow-slate-900/[0.06] sm:p-7">
              {/* Шапка виджета + «живой» индикатор */}
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">{mock.dayLabel}</p>
                <span className="relative flex h-2.5 w-2.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
              </div>
              <p className="mt-1 text-4xl font-extrabold tracking-tight text-emerald-600 tabular-nums">
                {mock.netValue}
              </p>

              {/* Разбивка: выручка − расходы = чистая прибыль */}
              <div className="mt-6 space-y-2.5 rounded-2xl bg-slate-50 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-slate-600">{mock.revenueLabel}</span>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums">{mock.revenueValue}</span>
                </div>
                {mock.rows.map((row) => (
                  <div key={row.label} className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
                      <Minus className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" strokeWidth={2.5} aria-hidden />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className="flex-shrink-0 text-sm text-slate-600 tabular-nums">{row.value}</span>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2.5">
                  <span className="text-sm font-semibold text-slate-900">{mock.netLabel}</span>
                  <span className="text-base font-bold text-emerald-600 tabular-nums">{mock.netValue}</span>
                </div>
              </div>

              {/* Прогноз на месяц */}
              <div className="mt-3 flex items-baseline justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                <span className="text-sm font-medium text-emerald-800">{mock.projectionLabel}</span>
                <span className="text-base font-bold text-emerald-700 tabular-nums">{mock.projectionValue}</span>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-slate-400">{mock.footnote}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
