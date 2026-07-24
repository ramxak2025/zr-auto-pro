import { useRef } from 'react';
import { ArrowRight, Database, History, Lock, Server, Signal, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GsapReveal, useReveal, gsap, useGSAP, EASE } from '../gsap';
import { features } from '../content';

/**
 * Иконки по порядку capabilities раздела nadezhnost в content.ts:
 * офлайн → резервные каналы → серверы в РФ → копии → изоляция → корзина.
 */
const ICONS: LucideIcon[] = [WifiOff, Signal, Server, Database, Lock, History];

/**
 * Декоративное «кольцо из независимых путей» — метафора надёжности: кольцо
 * собрано из ТРЁХ независимых дуг (резервные пути). При въезде дуги «включаются»
 * по очереди (draw через strokeDashoffset — без плагинов), затем в центре
 * проявляется защищённый узел. Спокойно и уверенно.
 *
 * Контракт видимости: в CSS-дефолте strokeDashoffset не задан → кольцо
 * нарисовано целиком (виден без JS / при reduced-motion / в headless).
 * «Спрятанное» состояние (dashoffset:1) ставится ТОЛЬКО в ветке no-preference.
 */
function ReliabilityRing() {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const arcs = gsap.utils.toArray<SVGPathElement>('[data-ring="arc"]', root);
      const dots = gsap.utils.toArray<SVGElement>('[data-ring="dot"]', root);
      const center = root.querySelector<SVGElement>('[data-ring="center"]');
      if (arcs.length === 0) return;

      const mm = gsap.matchMedia();
      mm.add({ reduce: '(prefers-reduced-motion: reduce)', ok: '(prefers-reduced-motion: no-preference)' }, (ctx) => {
        if (ctx.conditions?.reduce) return; // кольцо уже нарисовано целиком

        const all = [...arcs, ...dots, center].filter(Boolean) as Element[];
        try {
          // pathLength="1" в разметке → дуга нормализована: dasharray=1 (весь
          // путь), dashoffset:1 полностью «сдвигает» штрих → дуга не видна.
          gsap.set(arcs, { strokeDasharray: 1, strokeDashoffset: 1 });
          gsap.set(dots, { transformOrigin: '50% 50%', scale: 0, autoAlpha: 0 });
          gsap.set(center, { transformOrigin: '50% 50%', scale: 0.6, autoAlpha: 0 });

          const tl = gsap.timeline({
            scrollTrigger: { trigger: root, start: 'top 80%', once: true },
            onComplete: () => gsap.set(all, { clearProps: 'all' }),
          });

          arcs.forEach((arc, i) => {
            const at = i * 0.45;
            const dot = dots[i];
            if (dot) tl.to(dot, { scale: 1, autoAlpha: 1, duration: 0.3, ease: EASE.outStrong }, at);
            tl.to(arc, { strokeDashoffset: 0, duration: 0.7, ease: EASE.out }, at + 0.05);
          });
          tl.to(center, { scale: 1, autoAlpha: 1, duration: 0.5, ease: EASE.outStrong }, '>-0.15');
        } catch {
          gsap.set(all, { clearProps: 'all' });
        }
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="mt-14 flex justify-center" aria-hidden>
      <svg viewBox="0 0 200 200" className="h-40 w-40" fill="none">
        {/* Три независимые дуги кольца (три пути) — разные оттенки синего бренда. */}
        <path
          data-ring="arc"
          pathLength={1}
          d="M 100 24 A 76 76 0 0 1 171.4 126.0"
          stroke="#2563eb"
          strokeWidth={6}
          strokeLinecap="round"
        />
        <path
          data-ring="arc"
          pathLength={1}
          d="M 165.8 138.0 A 76 76 0 0 1 41.8 148.8"
          stroke="#3b82f6"
          strokeWidth={6}
          strokeLinecap="round"
        />
        <path
          data-ring="arc"
          pathLength={1}
          d="M 34.2 138.0 A 76 76 0 0 1 86.8 25.2"
          stroke="#60a5fa"
          strokeWidth={6}
          strokeLinecap="round"
        />

        {/* Узлы-истоки независимых путей. */}
        <circle data-ring="dot" cx={100} cy={24} r={5} fill="#2563eb" />
        <circle data-ring="dot" cx={165.8} cy={138} r={5} fill="#3b82f6" />
        <circle data-ring="dot" cx={34.2} cy={138} r={5} fill="#60a5fa" />

        {/* Защищённый центральный узел — «ваши данные», куда сходятся пути. */}
        <g data-ring="center">
          <circle cx={100} cy={100} r={26} fill="#eff6ff" stroke="#bfdbfe" strokeWidth={2} />
          <path
            d="M 89 100.5 L 97 108 L 112 92"
            stroke="#2563eb"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </div>
  );
}

export default function Reliability() {
  const section = features.find((f) => f.slug === 'nadezhnost');
  const gridRef = useReveal<HTMLDivElement>({
    type: 'stagger',
    childSelector: '[data-reveal-item]',
    start: 'top 80%',
    stagger: 0.1,
    duration: 0.7,
    ease: EASE.out,
  });

  if (!section) return null;

  return (
    // На мобиле секция скрыта целиком: её роль выполняют TrustStrip под hero
    // и чип «Надёжность» в сетке «Все возможности» (жалоба владельца на длинный скролл)
    <section id="reliability" className="hidden scroll-mt-24 border-t border-slate-200/60 md:block">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <GsapReveal type="blur-rise" className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            {section.title} — не опция
          </h2>
          <p className="mt-4 text-lg text-slate-600">{section.tagline}</p>
        </GsapReveal>

        {/* Кольцо из независимых путей — визуальная метафора над сеткой. */}
        <ReliabilityRing />

        <div ref={gridRef} className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {section.detail.capabilities.map((item, i) => {
            const Icon = ICONS[i] ?? Server;
            return (
              <div
                key={item.title}
                data-reveal-item
                className="h-full rounded-3xl border border-slate-200/60 bg-white p-6 shadow-sm transition-all duration-300 motion-safe:hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50">
                  <Icon className="h-5 w-5 text-primary-600" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{item.text}</p>
              </div>
            );
          })}
        </div>

        <GsapReveal delay={0.1} className="mt-10 text-center">
          <Link
            to="/f/nadezhnost"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-primary-600 transition-colors hover:text-primary-700"
          >
            Подробнее о надёжности
            <ArrowRight className="h-4 w-4" />
          </Link>
        </GsapReveal>
      </div>
    </section>
  );
}
