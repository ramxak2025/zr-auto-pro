import { Apple, Monitor, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GsapReveal, useReveal, useParallax } from '../gsap';
import { storeSection } from '../content';

/** Иконки lucide по имени из content.ts (официальные ассеты сторов не используем). */
const ICONS: Record<string, LucideIcon> = { Apple, Smartphone, Monitor };

type Platform = (typeof storeSection.platforms)[number];

/**
 * Разная амплитуда параллакса по колонкам → устройства «парятся» на слегка
 * разной глубине (только desktop + мышь; на touch/мобиле useParallax инертен).
 */
const DRIFT = [-26, -50, -74];

/**
 * Одна карточка-устройство: внешний слой — лёгкий scrub-параллакс (плавает по
 * скроллу), внутренний — reveal scale-in при въезде («устройство приезжает»).
 * Разделение слоёв нужно, чтобы transform параллакса и transform reveal/hover
 * не конфликтовали на одном элементе.
 */
function PlatformCard({ platform, index }: { platform: Platform; index: number }) {
  const outerRef = useParallax<HTMLDivElement>({ y: DRIFT[index] ?? -40 });
  const innerRef = useReveal<HTMLDivElement>({
    type: 'scale-in',
    start: 'top 82%',
    distance: 22,
    delay: Math.min(index * 0.08, 0.24),
  });
  const Icon = ICONS[platform.icon] ?? Smartphone;

  return (
    <div ref={outerRef} className="h-full">
      <div
        ref={innerRef}
        className="h-full rounded-3xl border border-slate-200/60 bg-white p-6 text-center shadow-sm transition-all duration-300 motion-safe:hover:-translate-y-0.5 hover:shadow-md"
      >
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
          <Icon className="h-6 w-6 text-slate-700" />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-slate-900">{platform.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{platform.text}</p>
      </div>
    </div>
  );
}

/**
 * Нейтральная секция «на любом устройстве»: веб-версия + мобильное приложение
 * для сотрудников организации. Без бейджей магазинов, без установки в обход
 * App Store и без «скачать через поддержку» — доступ настраивает менеджер при
 * подключении организации.
 */
export default function Platforms() {
  return (
    <section className="border-t border-slate-200/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-28">
        <GsapReveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl text-balance">
            {storeSection.title}
          </h2>
          <p className="mt-4 text-lg text-slate-600">{storeSection.subtitle}</p>
        </GsapReveal>

        {/* < md: одна компактная карточка «iPhone · Android · Браузер» в строку */}
        <GsapReveal type="scale-in" className="mt-8 md:hidden">
          <div className="rounded-3xl border border-slate-200/60 bg-white p-5 shadow-sm">
            <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              {storeSection.platforms.map((p) => {
                const Icon = ICONS[p.icon] ?? Smartphone;
                return (
                  <span key={p.title} className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <Icon className="h-5 w-5 text-slate-600" aria-hidden />
                    {p.title}
                  </span>
                );
              })}
            </p>
          </div>
        </GsapReveal>

        <div className="mt-14 hidden grid-cols-1 gap-4 sm:grid-cols-3 md:grid">
          {storeSection.platforms.map((p, i) => (
            <PlatformCard key={p.title} platform={p} index={i} />
          ))}
        </div>

        <GsapReveal delay={0.15}>
          <p className="mt-8 text-center text-sm text-slate-500">{storeSection.syncNote}</p>
        </GsapReveal>
      </div>
    </section>
  );
}
