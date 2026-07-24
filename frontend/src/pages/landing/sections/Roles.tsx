import { useRef } from 'react';
import { CheckCircle2, Crown, Minus, PhoneCall, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import CarouselDots from './CarouselDots';
import { GsapReveal, gsap, useGSAP, EASE, DUR } from '../gsap';
import { roles } from '../content';
import type { RoleKey } from '../content';

/** Иконка и акцент для каждой персоны — презентация, тексты из content.ts. */
const ROLE_STYLE: Record<RoleKey, { icon: LucideIcon; iconCls: string; iconBg: string }> = {
  owner: { icon: Crown, iconCls: 'text-primary-600', iconBg: 'bg-primary-50' },
  // rose вместо violet: палитра лендинга сознательно без violet (анти-паттерн «AI purple»)
  admin: { icon: PhoneCall, iconCls: 'text-rose-600', iconBg: 'bg-rose-50' },
  master: { icon: Wrench, iconCls: 'text-amber-600', iconBg: 'bg-amber-50' },
};

/** Направленный «раскладной» вход трёх персон: центр-якорь глубже, фланги —
 *  с лёгким наклоном внутрь; y+rotation (без x) чтобы не давать горизонтальный
 *  overflow страницы. Индекс → своя амплитуда: движение НЕ одинаковое. */
const ENTER = [
  { y: 46, rot: -2 }, // owner — левый, лёгкий наклон внутрь
  { y: 62, rot: 0 }, // admin — центр-якорь, глубже всех, прямо
  { y: 46, rot: 2 }, // master — правый, зеркальный наклон
];

/**
 * «Кому» — три персоны (владелец / администратор / мастер):
 * узнаваемые боли без продукта → что человек получает с Autexa.
 *
 * Моушен (GSAP): десктоп — направленный «раскладной» стаггер карточек +
 * pointer-tilt под @media(hover:hover); мобилка — единый reveal ленты (peek-
 * карточки не гаснут) + тонкий scrub эмфазы пиковой (центральной) карточки.
 * Контент виден по CSS-дефолту; from-состояние ставится только в ветке
 * no-preference внутри matchMedia — reduced-motion / без JS секция не пустая.
 */
export default function Roles() {
  const sectionRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const mm = gsap.matchMedia();

      // ── Десктоп: направленный «раскладной» вход карточек ──────────────────
      mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        const cells = gsap.utils.toArray<HTMLElement>('[data-role-cell]', sectionRef.current);
        if (!cells.length) return;
        try {
          gsap.set(cells, {
            autoAlpha: 0,
            y: (i: number) => ENTER[i]?.y ?? 46,
            rotationZ: (i: number) => ENTER[i]?.rot ?? 0,
            scale: 0.985,
            transformOrigin: '50% 100%',
            willChange: 'transform, opacity',
          });
          gsap.to(cells, {
            autoAlpha: 1,
            y: 0,
            rotationZ: 0,
            scale: 1,
            duration: DUR.base,
            ease: EASE.outStrong,
            stagger: 0.12,
            overwrite: 'auto',
            onComplete: () => gsap.set(cells, { clearProps: 'all' }),
            scrollTrigger: { trigger: scroller, start: 'top 80%', once: true },
          });
        } catch {
          gsap.set(cells, { clearProps: 'all' });
        }
      });

      // ── Десктоп + мышь: pointer-tilt (лёгкий 3D-наклон к курсору + подъём) ──
      mm.add(
        '(min-width: 768px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
        () => {
          const cards = gsap.utils.toArray<HTMLElement>('[data-role-card]', sectionRef.current);
          const cleanups: (() => void)[] = [];
          cards.forEach((card) => {
            gsap.set(card, { transformPerspective: 800, transformOrigin: '50% 50%' });
            const rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3' });
            const ry = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3' });
            const ty = gsap.quickTo(card, 'y', { duration: 0.5, ease: 'power3' });
            const sc = gsap.quickTo(card, 'scale', { duration: 0.5, ease: 'power3' });
            const onMove = (e: MouseEvent) => {
              const r = card.getBoundingClientRect();
              const px = (e.clientX - r.left) / r.width - 0.5;
              const py = (e.clientY - r.top) / r.height - 0.5;
              ry(px * 6);
              rx(-py * 6);
              ty(-6);
              sc(1.012);
            };
            const onLeave = () => {
              rx(0);
              ry(0);
              ty(0);
              sc(1);
            };
            card.addEventListener('mousemove', onMove);
            card.addEventListener('mouseleave', onLeave);
            cleanups.push(() => {
              card.removeEventListener('mousemove', onMove);
              card.removeEventListener('mouseleave', onLeave);
              gsap.set(card, { clearProps: 'all' });
            });
          });
          return () => cleanups.forEach((fn) => fn());
        },
      );

      // ── Мобилка: reveal ленты + scrub эмфазы пиковой карточки ──────────────
      mm.add('(max-width: 767px) and (prefers-reduced-motion: no-preference)', () => {
        const cells = gsap.utils.toArray<HTMLElement>('[data-role-cell]', sectionRef.current);

        // Вход всей ленты как единого блока — peek-карточки не гаснут поодиночке.
        // try/catch-страховка: любой сбой между set(autoAlpha:0) и tween вернул бы
        // ленту невидимой — на ошибке немедленно раскрываем (как в desktop-ветке).
        if (scroller) {
          try {
            gsap.set(scroller, { autoAlpha: 0, y: 24, willChange: 'transform, opacity' });
            gsap.to(scroller, {
              autoAlpha: 1,
              y: 0,
              duration: DUR.base,
              ease: EASE.out,
              onComplete: () => gsap.set(scroller, { clearProps: 'all' }),
              scrollTrigger: { trigger: scroller, start: 'top 88%', once: true },
            });
          } catch {
            gsap.set(scroller, { clearProps: 'all' });
          }
        }

        // Пиковая карточка (ближайшая к центру вьюпорта скроллера) — крупнее и
        // ярче соседних. Passive-слушатель + rAF: transform/opacity, 60fps.
        const setters = cells.map((c) => ({
          s: gsap.quickSetter(c, 'scale'),
          o: gsap.quickSetter(c, 'opacity'),
        }));
        let raf = 0;
        const update = () => {
          raf = 0;
          const rect = scroller.getBoundingClientRect();
          const center = rect.left + rect.width / 2;
          cells.forEach((c, i) => {
            const r = c.getBoundingClientRect();
            const f = Math.min(Math.abs(r.left + r.width / 2 - center) / r.width, 1);
            setters[i].s(1 - 0.07 * f);
            setters[i].o(1 - 0.2 * f);
          });
        };
        const onScroll = () => {
          if (!raf) raf = requestAnimationFrame(update);
        };
        scroller.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        update();
        return () => {
          scroller.removeEventListener('scroll', onScroll);
          window.removeEventListener('resize', onScroll);
          if (raf) cancelAnimationFrame(raf);
          gsap.set(cells, { clearProps: 'transform,opacity' });
        };
      });
    },
    { scope: sectionRef },
  );

  return (
    <section ref={sectionRef} id="roles" className="scroll-mt-24 border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-28">
        <GsapReveal type="blur-rise" className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance">
            Кому подходит Autexa
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Каждый в сервисе видит своё — и у каждого своя причина открыть приложение.
          </p>
        </GsapReveal>

        {/* < md: горизонтальная snap-карусель (чистый CSS, без JS-жестов) —
            карточка ~82vw + peek следующей как аффорданс свайпа; md+ — сетка.
            Вход/эмфаза — через useGSAP выше (лента целиком на мобиле, per-card
            «раскладной» стаггер на десктопе): per-card opacity-гейта тут нет. */}
        <div>
          <div
            ref={scrollerRef}
            className="no-scrollbar -mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-2 [overscroll-behavior-x:contain] md:mx-0 md:mt-14 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0"
          >
            {roles.map((role) => {
              const style = ROLE_STYLE[role.key];
              return (
                <div
                  key={role.key}
                  data-role-cell
                  className="w-[82vw] max-w-md shrink-0 snap-start md:w-auto md:max-w-none"
                >
                  <div
                    data-role-card
                    className="flex h-full flex-col rounded-3xl border border-slate-200/60 bg-white p-6 shadow-sm transition-shadow duration-300 hover:shadow-md motion-safe:active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${style.iconBg}`}>
                        <style.icon className={`h-5 w-5 ${style.iconCls}`} />
                      </span>
                      <h3 className="text-xl font-semibold text-slate-900">{role.title}</h3>
                    </div>

                    <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Знакомо?</p>
                    <ul className="mt-2 space-y-2">
                      {role.pains.map((p) => (
                        <li key={p} className="flex items-start gap-2 text-sm leading-relaxed text-slate-500">
                          <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                          {/* мобиле — до 2 строк: карусель ниже, текст короче */}
                          <span className="line-clamp-2 md:line-clamp-none">{p}</span>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-5 border-t border-slate-100 pt-4 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                      С Autexa
                    </p>
                    <ul className="mt-2 space-y-2">
                      {role.gains.map((g, gi) => (
                        <li
                          key={g}
                          // на мобиле — только 3 главные выгоды; полный список с md+
                          className={`items-start gap-2 text-sm leading-relaxed text-slate-700 ${
                            gi >= 3 ? 'hidden md:flex' : 'flex'
                          }`}
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                          {g}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Точки-индикаторы карусели — только мобилка (md+ это сетка) */}
          <CarouselDots scrollerRef={scrollerRef} count={roles.length} itemLabel="Роль" className="mt-1 md:hidden" />
        </div>
      </div>
    </section>
  );
}
