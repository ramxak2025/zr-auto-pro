import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle, Send } from 'lucide-react';
import { gsap, useGSAP, EASE } from '../gsap';
import OptionalImage from '../OptionalImage';
import { ctaSection } from '../content';
import { getTelegramUrl, getWhatsAppUrl } from '../config';

const PRIMARY_BTN =
  'inline-flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl bg-primary-600 px-8 text-base font-semibold text-white shadow-lg shadow-primary-600/25 transition hover:bg-primary-500 motion-safe:active:scale-[0.98] active:bg-primary-700 sm:w-auto sm:text-lg';

// Secondary «написать нам» — тот же тинт-паттерн, что у контактов в футере.
const CONTACT_BTN =
  'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold transition motion-safe:active:scale-[0.98] sm:w-auto';

const CLAMP = 16; // максимум магнитного смещения кнопки, px

/**
 * Финальный CTA. Моушен (свой для секции, не generic-Reveal):
 *   • карточка въезжает с лёгким scale + rise, затем контент внутри проявляется
 *     каскадом (frame → содержимое);
 *   • пастельные подсветки (primary + emerald) медленно «дышат» в противофазе —
 *     тонко, без мигания (sine.inOut, 4.5–5.2 c);
 *   • primary-кнопка «Оставить заявку» на desktop с настоящим hover'ом —
 *     магнитная: тянется к курсору (quickTo, power3.out), возвращается на место
 *     при уходе. Смещается ВНЕШНИЙ слой, сама ссылка сохраняет CSS active:scale.
 *
 * Контракт видимости: контент виден по CSS-дефолту; from-состояния и «дыхание»
 * ставятся ТОЛЬКО в no-preference. При reduced-motion / без JS ничего не
 * прячется и не двигается. Любой сбой ловится try/catch → clearProps. Все
 * ScrollTrigger'ы и слушатели живут в gsap.context useGSAP и киллятся при уходе.
 */
export default function CtaSection() {
  const whatsapp = getWhatsAppUrl();
  const telegram = getTelegramUrl();

  const scope = useRef<HTMLElement>(null);
  const sensorRef = useRef<HTMLDivElement>(null);
  const moverRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;

      const card = root.querySelector<HTMLElement>('[data-cta-card]');
      const items = gsap.utils.toArray<HTMLElement>('[data-cta-item]', root);
      const glowPrimary = root.querySelector<HTMLElement>('[data-cta-glow-primary]');
      const glowEmerald = root.querySelector<HTMLElement>('[data-cta-glow-emerald]');
      const revealTargets = [card, ...items].filter(Boolean) as HTMLElement[];

      const mm = gsap.matchMedia();

      // ── Вход карточки + каскад контента (no-preference; reduced → видимо сразу)
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        try {
          if (card) {
            gsap.set(card, {
              autoAlpha: 0,
              y: 36,
              scale: 0.96,
              transformOrigin: '50% 50%',
              willChange: 'transform, opacity',
            });
          }
          if (items.length) gsap.set(items, { autoAlpha: 0, y: 16, willChange: 'transform, opacity' });

          const tl = gsap.timeline({
            defaults: { ease: EASE.out },
            scrollTrigger: { trigger: root, start: 'top 80%', once: true },
            onComplete: () => gsap.set(revealTargets, { clearProps: 'all' }),
          });
          if (card) tl.to(card, { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, ease: EASE.outStrong });
          if (items.length) tl.to(items, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.08 }, '-=0.34');
        } catch {
          gsap.set(revealTargets, { clearProps: 'all' });
        }
      });

      // ── Тонкое «дыхание» подсветок (декоративно, aria-hidden; всегда видимы).
      // Только desktop: бесконечный yoyo на мобиле зря греет батарею.
      mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        if (glowPrimary) {
          gsap.fromTo(
            glowPrimary,
            { opacity: 0.72, scale: 0.98, xPercent: -50 },
            {
              opacity: 1,
              scale: 1.08,
              xPercent: -50,
              transformOrigin: '50% 50%',
              duration: 4.5,
              ease: 'sine.inOut',
              repeat: -1,
              yoyo: true,
            },
          );
        }
        if (glowEmerald) {
          gsap.fromTo(
            glowEmerald,
            { opacity: 0.6, scale: 0.96 },
            {
              opacity: 0.95,
              scale: 1.1,
              transformOrigin: '50% 50%',
              duration: 5.2,
              ease: 'sine.inOut',
              repeat: -1,
              yoyo: true,
              delay: 0.6,
            },
          );
        }
      });

      // ── Магнитная primary-кнопка: только desktop + настоящий hover + no-preference
      mm.add('(min-width: 640px) and (pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
        const sensor = sensorRef.current;
        const mover = moverRef.current;
        if (!sensor || !mover) return;

        const xTo = gsap.quickTo(mover, 'x', { duration: 0.4, ease: 'power3.out' });
        const yTo = gsap.quickTo(mover, 'y', { duration: 0.4, ease: 'power3.out' });

        const onMove = (e: PointerEvent) => {
          const r = sensor.getBoundingClientRect();
          const relX = e.clientX - (r.left + r.width / 2);
          const relY = e.clientY - (r.top + r.height / 2);
          xTo(gsap.utils.clamp(-CLAMP, CLAMP, relX * 0.4));
          yTo(gsap.utils.clamp(-CLAMP, CLAMP, relY * 0.4));
        };
        const onLeave = () => {
          xTo(0);
          yTo(0);
        };

        sensor.addEventListener('pointermove', onMove);
        sensor.addEventListener('pointerleave', onLeave);
        return () => {
          sensor.removeEventListener('pointermove', onMove);
          sensor.removeEventListener('pointerleave', onLeave);
          gsap.set(mover, { clearProps: 'transform' });
        };
      });
    },
    { scope },
  );

  return (
    <section ref={scope}>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-24">
        <div
          data-cta-card
          className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white px-6 py-12 text-center shadow-sm sm:px-12 sm:py-16"
        >
          {/* Пастельная подсветка внутри карточки — «дышит» в no-preference */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div
              data-cta-glow-primary
              className="absolute -top-24 left-1/2 h-64 w-[560px] -translate-x-1/2 rounded-full bg-primary-200/50 blur-[100px]"
            />
            <div
              data-cta-glow-emerald
              className="absolute -bottom-24 right-0 h-48 w-[360px] rounded-full bg-emerald-200/40 blur-[100px]"
            />
          </div>

          <div className="relative flex flex-col items-center gap-10 lg:flex-row lg:gap-12">
            <div className="min-w-0 flex-1">
              <h2
                data-cta-item
                className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl text-balance"
              >
                {ctaSection.title}
              </h2>

              {/* Primary — B2B-заявка на подключение автосервиса; магнитная на desktop */}
              <div data-cta-item className="mt-8 flex justify-center">
                <div ref={sensorRef} className="w-full sm:inline-flex sm:w-auto sm:p-3">
                  <div ref={moverRef} className="w-full sm:w-auto">
                    <Link to="/register" className={PRIMARY_BTN}>
                      Оставить заявку
                      <ArrowRight className="h-5 w-5" />
                    </Link>
                  </div>
                </div>
              </div>
              <p data-cta-item className="mt-3 text-sm text-slate-500">
                {ctaSection.riskReversal}
              </p>

              {/* Secondary — живой контакт (перенос базы, вопросы) */}
              {(whatsapp || telegram) && (
                <div data-cta-item className="mt-8 border-t border-slate-100 pt-6">
                  <p className="text-sm text-slate-500">Есть вопросы? Напишите — поможем перенести базу:</p>
                  <div className="mt-3 flex flex-col items-center justify-center gap-3 sm:flex-row">
                    {whatsapp && (
                      <a
                        href={whatsapp}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${CONTACT_BTN} border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
                      >
                        <MessageCircle className="h-4 w-4" />
                        {ctaSection.whatsappLabel}
                      </a>
                    )}
                    {telegram && (
                      <a
                        href={telegram}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${CONTACT_BTN} border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100`}
                      >
                        <Send className="h-4 w-4" />
                        {ctaSection.telegramLabel}
                      </a>
                    )}
                  </div>
                  <p className="mt-3 text-sm text-slate-500">{ctaSection.note}</p>
                </div>
              )}
            </div>
            {/* Слот под фото сервиса: появится вместе с файлом
                /img/landing/workshop.webp — до этого блок остаётся
                одноколоночным и центрированным, как раньше */}
            <OptionalImage
              src="/img/landing/workshop.webp"
              alt="Автосервис за работой с Autexa"
              width={800}
              height={600}
              className="w-full max-w-md shrink-0 rounded-2xl border border-slate-200/60 object-cover shadow-md lg:w-96"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
