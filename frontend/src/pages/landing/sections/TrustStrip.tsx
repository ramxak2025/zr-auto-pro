import { Database, Lock, Server, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useReveal } from '../gsap';

/**
 * Trust-строка сразу под hero (паттерн «Proof»): четыре честных факта
 * о надёжности — коротко, без маркетинга. Полные формулировки живут
 * в content.ts (раздел nadezhnost) и секции Reliability.
 * ЕДИНСТВЕННОЕ упоминание офлайна на главной — из hero и разделов убрано,
 * чтобы не повторяться (жалоба владельца на тавтологию).
 */
const ITEMS: { icon: LucideIcon; label: string }[] = [
  { icon: Server, label: 'Серверы в России' },
  { icon: Database, label: 'Копии каждый день' },
  { icon: WifiOff, label: 'Работает офлайн' },
  { icon: Lock, label: 'Данные под замком' },
];

export default function TrustStrip() {
  // Тонкий стаггер-въезд пунктов доверия по скролле (GSAP): небольшой подъём +
  // проявление, каскадом слева направо — не «одинаковый рефлекс» fade всей
  // секции. Контент виден по CSS-дефолту: from-состояние ставит только GSAP в
  // ветке no-preference; при reduced-motion / без JS пункты показаны сразу.
  const gridRef = useReveal<HTMLDivElement>({
    type: 'stagger',
    childSelector: '[data-trust-item]',
    start: 'top 90%',
    distance: 14,
    duration: 0.5,
    stagger: 0.09,
  });

  return (
    <section aria-label="Гарантии надёжности" className="border-t border-slate-200/60 bg-white/60">
      {/* Мобильные кегль/зазоры подобраны по метрикам Onest: худшие пункты
          («Копии каждый день» / «Данные под замком», 17 символов, 13px medium ≈ 130px
          + иконка 16 + gap 8) влезают в колонку grid-cols-2 и на 375px (163px),
          и на 360px (156px) без переноса. */}
      <div
        ref={gridRef}
        className="mx-auto grid max-w-6xl grid-cols-2 gap-x-4 gap-y-3.5 px-4 py-5 sm:gap-x-6 sm:px-6 md:flex md:items-center md:justify-between md:py-4"
      >
        {ITEMS.map(({ icon: Icon, label }) => (
          <p
            key={label}
            data-trust-item
            className="flex items-center gap-2 text-[13px] font-medium text-slate-600 sm:gap-2.5 sm:text-sm"
          >
            <Icon className="h-4 w-4 shrink-0 text-emerald-600 sm:h-[18px] sm:w-[18px]" aria-hidden />
            {label}
          </p>
        ))}
      </div>
    </section>
  );
}
