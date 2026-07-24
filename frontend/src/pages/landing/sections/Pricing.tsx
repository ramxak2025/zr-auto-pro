import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, Wrench } from 'lucide-react';
import { gsap, useGSAP, EASE } from '../gsap';
import { b2bNotice, pricing } from '../content';

/**
 * Компактный тизер тарифов на главной. id="pricing" сохранён — старые якоря
 * /#pricing продолжают работать. Полные карточки планов, «Внедрение под ключ»
 * и таблица сравнения переехали на отдельную страницу /tarify (TarifyPage +
 * pricingShared.tsx) — главная стала короче, тяжёлая таблица/карусель ушла.
 *
 * Моушен (замена generic-Reveal на бесподобный, свой для секции): «сборка
 * прайса». Заголовок поднимается → карточка въезжает с лёгким scale → строки
 * планов каскадом печатаются сверху вниз (как чек из принтера) → рекомендованный
 * план (с бейджем) подсвечивается мягким primary-glow'ом и его бейдж делает
 * микро-pop → строка внедрения и CTA оседают последними.
 *
 * Контракт видимости (критично): контент виден по CSS-дефолту. from-состояния
 * ставятся ТОЛЬКО в ветке no-preference и только после инициализации GSAP;
 * при reduced-motion / без JS / в headless секция остаётся видимой. Любой сбой
 * ловится try/catch и форсит показ (clearProps). ScrollTrigger живёт в
 * gsap.context useGSAP и киллится при уходе со страницы (SPA-роутинг).
 */
export default function Pricing() {
  const impl = pricing.implementation;
  const scope = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;

      const head = root.querySelector<HTMLElement>('[data-pricing-head]');
      const card = root.querySelector<HTMLElement>('[data-pricing-card]');
      const rows = gsap.utils.toArray<HTMLElement>('[data-plan-row]', root);
      const glow = root.querySelector<HTMLElement>('[data-plan-glow]');
      const badge = root.querySelector<HTMLElement>('[data-plan-badge]');
      const foot = root.querySelector<HTMLElement>('[data-pricing-foot]');
      const animated = [head, card, ...rows, glow, badge, foot].filter(Boolean) as HTMLElement[];
      if (animated.length === 0) return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          reduce: '(prefers-reduced-motion: reduce)',
          ok: '(prefers-reduced-motion: no-preference)',
        },
        (ctx: gsap.Context) => {
          if (ctx.conditions?.reduce) return; // reduced-motion → ничего не прячем

          try {
            if (head) gsap.set(head, { autoAlpha: 0, y: 24, willChange: 'transform, opacity' });
            if (card) {
              gsap.set(card, {
                autoAlpha: 0,
                y: 40,
                scale: 0.985,
                transformOrigin: '50% 0%',
                willChange: 'transform, opacity',
              });
            }
            if (rows.length) gsap.set(rows, { autoAlpha: 0, y: 16, willChange: 'transform, opacity' });
            if (glow) gsap.set(glow, { autoAlpha: 0, scale: 0.8, willChange: 'transform, opacity' });
            if (badge) gsap.set(badge, { scale: 0.6, autoAlpha: 0, transformOrigin: '50% 50%' });
            if (foot) gsap.set(foot, { autoAlpha: 0, y: 14, willChange: 'transform, opacity' });

            const tl = gsap.timeline({
              defaults: { ease: EASE.out },
              scrollTrigger: { trigger: root, start: 'top 74%', once: true },
              onComplete: () => gsap.set(animated, { clearProps: 'all' }),
            });

            if (head) tl.to(head, { autoAlpha: 1, y: 0, duration: 0.6 });
            if (card) tl.to(card, { autoAlpha: 1, y: 0, scale: 1, duration: 0.75, ease: EASE.outStrong }, '-=0.34');
            if (rows.length) tl.to(rows, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.07 }, '-=0.42');
            if (glow) tl.to(glow, { autoAlpha: 1, scale: 1, duration: 0.7 }, '-=0.28');
            if (badge) tl.to(badge, { autoAlpha: 1, scale: 1, duration: 0.42, ease: EASE.outStrong }, '<0.05');
            if (foot) tl.to(foot, { autoAlpha: 1, y: 0, duration: 0.5 }, '-=0.4');
          } catch {
            gsap.set(animated, { clearProps: 'all' }); // сбой моушена не оставит секцию пустой
          }
        },
      );
    },
    { scope },
  );

  return (
    <section ref={scope} id="pricing" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-24">
        <div data-pricing-head className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            {pricing.title}
          </h2>
          <p className="mt-4 text-lg text-slate-600">{pricing.subtitle}</p>
        </div>

        <div
          data-pricing-card
          className="mx-auto mt-8 max-w-2xl overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-sm sm:mt-12"
        >
          {/* Три мини-строки планов одной карточкой — только возможности, без цен */}
          <ul className="divide-y divide-slate-100">
            {pricing.plans.map((plan) => (
              <li
                key={plan.key}
                data-plan-row
                className={`relative flex items-center justify-between gap-3 px-5 py-4 sm:px-7 ${
                  plan.highlighted ? 'isolate' : ''
                }`}
              >
                {/* Рекомендованный план: мягкий primary-glow (без фиолетового), декоративный */}
                {plan.highlighted && (
                  <span
                    data-plan-glow
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_140%_at_15%_50%,rgba(219,234,254,0.75),transparent_72%)]"
                  />
                )}
                <span className="relative z-10 min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{plan.name}</span>
                    {plan.badge && (
                      <span
                        data-plan-badge
                        className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700"
                      >
                        {plan.badge}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-slate-500">{plan.description}</span>
                </span>
                <span className="relative z-10 shrink-0 whitespace-nowrap text-right text-sm font-medium text-slate-500">
                  {plan.employees}
                </span>
              </li>
            ))}
          </ul>

          {/* Внедрение — одной строкой; подробности на /tarify */}
          <p className="flex items-center gap-2.5 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5 text-sm text-slate-600 sm:px-7">
            <Wrench className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            {impl.title} — {impl.duration.toLowerCase()}
          </p>

          <div data-pricing-foot className="px-5 pb-6 pt-4 sm:px-7">
            <Link
              to="/register"
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 px-6 text-base font-semibold text-white shadow-lg shadow-primary-600/25 transition hover:bg-primary-500 motion-safe:active:scale-[0.98] active:bg-primary-700"
            >
              Оставить заявку
              <ArrowRight className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              to="/tarify"
              className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center text-sm font-semibold text-primary-600 transition-colors hover:text-primary-700"
            >
              Сравнить возможности тарифов
            </Link>
            <p className="mt-4 flex items-start justify-center gap-2 text-center text-sm text-slate-500">
              <Building2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              {b2bNotice}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
