import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Minus } from 'lucide-react';
import { GsapReveal, gsap, useGSAP, EASE } from '../gsap';
import CtaButton from './CtaButton';
import { netProfit } from '../content';

/**
 * Разбирает строку числа из content («42 300 ₽», «≈ 470 000 ₽») на префикс +
 * числовое значение + суффикс. Позволяет считать число вверх, НЕ меняя тексты:
 * во время анимации перерисовываем только числовую часть, на финише возвращаем
 * ИСХОДНУЮ строку байт-в-байт — она же CSS-дефолт (виден без JS / в headless).
 */
const NUM_RE = /^(.*?)((?:\d[\d\s]*)?\d)(.*)$/;

/**
 * Добавляет в timeline счётчик числа на элементе `el`. immediateRender:false —
 * до проигрывания timeline (пауза до ScrollTrigger) в DOM остаётся children из
 * content, ничего не обнуляется. onComplete восстанавливает точный оригинал.
 */
function addCount(tl: gsap.core.Timeline, el: HTMLElement | null, duration: number, position: number): void {
  if (!el) return;
  const original = el.textContent ?? '';
  const m = original.match(NUM_RE);
  if (!m) return;
  const value = Number(m[2].replace(/[^\d]/g, ''));
  if (!value) return;
  const prefix = m[1];
  const suffix = m[3];
  const nf = new Intl.NumberFormat('ru-RU');
  const proxy = { v: 0 };
  tl.to(
    proxy,
    {
      v: value,
      duration,
      ease: EASE.out,
      immediateRender: false,
      onUpdate: () => {
        el.textContent = `${prefix}${nf.format(Math.round(proxy.v))}${suffix}`;
      },
      onComplete: () => {
        el.textContent = original;
      },
    },
    position,
  );
}

/**
 * «Чистая прибыль в реальном времени» — маркерная финансовая секция главной.
 * Слева: продающая копия (каскад-stagger при въезде). Справа: CSS-мокап виджета,
 * где формула прибыли собирается на глазах — карточка проявляется, крупная
 * цифра «сегодня» отсчитывается вверх, выручка считается, статьи расходов
 * по очереди «вычитаются» (въезд справа), итог-прибыль акцентируется pop-ом,
 * прогноз досчитывается. Осмысленно: зритель видит, КАК получилась цифра.
 *
 * Тема светлая, изумруд = деньги (DESIGN.md). Все числа иллюстративные.
 *
 * Контракт видимости: числа/строки в разметке = финальные значения из content
 * (CSS-дефолт). from-состояние (autoAlpha:0) ставится ТОЛЬКО в ветке
 * no-preference; при reduced-motion / без JS / в headless виджет виден сразу с
 * итоговыми числами. Любой сбой моушена ловится try/catch → clearProps.
 */
export default function NetProfit() {
  const { title, tagline, lead, amortized, benefits, mock } = netProfit;
  const widgetRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = widgetRef.current;
      if (!root) return;

      const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
      const card = q('[data-np="card"]');
      const big = q('[data-np="big"]');
      const breakdown = q('[data-np="breakdown"]');
      const revenueRow = q('[data-np="revenue-row"]');
      const revenueVal = q('[data-np="revenue-val"]');
      const costRows = gsap.utils.toArray<HTMLElement>('[data-np="cost-row"]', root);
      const netRow = q('[data-np="net-row"]');
      const netVal = q('[data-np="net-val"]');
      const projection = q('[data-np="projection"]');
      const projectionVal = q('[data-np="projection-val"]');

      const revealTargets = [card, big, breakdown, revenueRow, ...costRows, netRow, projection].filter(
        Boolean,
      ) as HTMLElement[];

      const mm = gsap.matchMedia();
      mm.add({ reduce: '(prefers-reduced-motion: reduce)', ok: '(prefers-reduced-motion: no-preference)' }, (ctx) => {
        if (ctx.conditions?.reduce) return; // content уже финальный и видимый

        try {
          // Прячем ТОЛЬКО сейчас (immediateRender при создании → без вспышки).
          gsap.set(card, { autoAlpha: 0, y: 26, scale: 0.985, transformOrigin: '50% 35%' });
          gsap.set([big, breakdown, revenueRow, projection].filter(Boolean), { autoAlpha: 0, y: 12 });
          gsap.set(netRow, { autoAlpha: 0, y: 10, scale: 0.92, transformOrigin: 'left center' });
          gsap.set(costRows, { autoAlpha: 0, x: 16 });

          const tl = gsap.timeline({
            defaults: { ease: EASE.out },
            scrollTrigger: { trigger: root, start: 'top 78%', once: true },
            onComplete: () => gsap.set(revealTargets, { clearProps: 'all' }),
          });

          // Карточка «прилетает».
          tl.to(card, { autoAlpha: 1, y: 0, scale: 1, duration: 0.6, ease: EASE.outStrong }, 0);

          // Крупная цифра «сегодня» — заголовок-климакс, считается медленнее.
          tl.to(big, { autoAlpha: 1, y: 0, duration: 0.5 }, 0.28);
          addCount(tl, big, 1.15, 0.32);

          // Разбивка проявляется, выручка отсчитывается.
          tl.to(breakdown, { autoAlpha: 1, y: 0, duration: 0.4 }, 0.5);
          tl.to(revenueRow, { autoAlpha: 1, y: 0, duration: 0.4 }, 0.66);
          addCount(tl, revenueVal, 0.7, 0.72);

          // Статьи расходов «вычитаются» по очереди — въезд справа.
          tl.to(costRows, { autoAlpha: 1, x: 0, duration: 0.45, stagger: 0.13 }, 0.9);

          // Итог-прибыль: pop (scale) + отсчёт синхронно — «ответ сходится».
          tl.to(netRow, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: EASE.outStrong }, 1.45);
          addCount(tl, netVal, 0.7, 1.5);

          // Прогноз досчитывается последним.
          tl.to(projection, { autoAlpha: 1, y: 0, duration: 0.5 }, 1.95);
          addCount(tl, projectionVal, 0.85, 2.0);
        } catch {
          gsap.set(revealTargets, { clearProps: 'all' });
        }
      });
    },
    { scope: widgetRef },
  );

  return (
    <section id="profit" className="scroll-mt-24 border-t border-slate-200/60">
      {/* grid-cols-1 обязателен: без базовой колонки неявная grid-колонка на
          мобиле = auto (max-content) и растягивается по виджету за экран (это и
          был корень «выходит за рамки» + распирало всю страницу). minmax(0,1fr)
          из grid-cols-1 даёт колонке усадку по вьюпорту — виджет и glow влезают. */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:items-center lg:gap-16">
        {/* ── Левая колонка: копия (каскад-stagger при въезде) ── */}
        <GsapReveal type="stagger" stagger={0.07}>
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

          {/* Мостик к разделу-карточке /f/pribyl: showcase остаётся флагманом,
              а «Подробнее» ведёт в углублённую статью — без ощущения дубля. */}
          <Link
            to="/f/pribyl"
            className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-primary-600 transition-colors hover:text-primary-700"
          >
            Подробнее о расчёте прибыли
            <ArrowRight className="h-4 w-4" />
          </Link>
        </GsapReveal>

        {/* ── Правая колонка: мокап виджета «Чистая прибыль» (оркестрованный timeline) ── */}
        <div ref={widgetRef} className="relative mx-auto w-full max-w-md">
          {/* Мягкая изумрудная подсветка под карточкой */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] bg-emerald-200/30 blur-3xl"
          />
          <div
            data-np="card"
            className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-xl shadow-slate-900/[0.06] sm:p-7"
          >
            {/* Шапка виджета + «живой» индикатор */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{mock.dayLabel}</p>
              <span className="relative flex h-2.5 w-2.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
            </div>
            <p data-np="big" className="mt-1 text-4xl font-extrabold tracking-tight text-emerald-600 tabular-nums">
              {mock.netValue}
            </p>

            {/* Разбивка: выручка − расходы = чистая прибыль */}
            <div data-np="breakdown" className="mt-6 space-y-2.5 rounded-2xl bg-slate-50 p-4">
              <div data-np="revenue-row" className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-slate-600">{mock.revenueLabel}</span>
                <span data-np="revenue-val" className="text-sm font-semibold text-slate-900 tabular-nums">
                  {mock.revenueValue}
                </span>
              </div>
              {mock.rows.map((row) => (
                <div key={row.label} data-np="cost-row" className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
                    <Minus className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" strokeWidth={2.5} aria-hidden />
                    <span className="truncate">{row.label}</span>
                  </span>
                  <span className="flex-shrink-0 text-sm text-slate-600 tabular-nums">{row.value}</span>
                </div>
              ))}
              <div
                data-np="net-row"
                className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2.5"
              >
                <span className="text-sm font-semibold text-slate-900">{mock.netLabel}</span>
                <span data-np="net-val" className="text-base font-bold text-emerald-600 tabular-nums">
                  {mock.netValue}
                </span>
              </div>
            </div>

            {/* Прогноз на месяц */}
            <div
              data-np="projection"
              className="mt-3 flex items-baseline justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3"
            >
              <span className="text-sm font-medium text-emerald-800">{mock.projectionLabel}</span>
              <span data-np="projection-val" className="text-base font-bold text-emerald-700 tabular-nums">
                {mock.projectionValue}
              </span>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-400">{mock.footnote}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
