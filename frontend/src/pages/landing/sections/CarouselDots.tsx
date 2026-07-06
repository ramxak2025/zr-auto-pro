import { useEffect, useState, type RefObject } from 'react';

interface CarouselDotsProps {
  /** Ref горизонтального scroll-snap контейнера; точки = его прямые дети. */
  scrollerRef: RefObject<HTMLDivElement>;
  count: number;
  /** Подпись для aria-label кнопок, например «Раздел» / «Роль». */
  itemLabel: string;
  className?: string;
}

/** scroll-padding-left контейнера (scroll-px-4 → 16px); 'auto' → 0. */
function snapPadding(el: HTMLElement): number {
  const raw = parseFloat(getComputedStyle(el).scrollPaddingLeft);
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * Точки-индикаторы под мобильной каруселью (CSS scroll-snap остаётся нативным,
 * никакого захвата жестов). Активная точка вычисляется на scroll-событии:
 * passive-слушатель + rAF-троттлинг (максимум один пересчёт на кадр), отписка
 * в cleanup. Тап по точке — scrollTo к карточке (smooth; reduced-motion —
 * мгновенно). Индикация — transform/цвет, layout-свойства не анимируются.
 * На md+ карусели становятся сетками — родитель прячет точки через md:hidden.
 */
export default function CarouselDots({ scrollerRef, count, itemLabel, className = '' }: CarouselDotsProps) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;

    const update = () => {
      raf = 0;
      const base = el.getBoundingClientRect().left + snapPadding(el);
      let best = 0;
      let bestDist = Infinity;
      Array.from(el.children).forEach((child, i) => {
        const dist = Math.abs(child.getBoundingClientRect().left - base);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setActive(best);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    // Ресайз/поворот меняет snap-позицию без scroll-события — пересчитываем
    // тем же rAF-троттлингом, чтобы активная точка не «зависала» на старой.
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollerRef, count]);

  const scrollToIndex = (i: number) => {
    const el = scrollerRef.current;
    const child = el?.children[i] as HTMLElement | undefined;
    if (!el || !child) return;
    const left = child.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft - snapPadding(el);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
  };

  if (count < 2) return null;

  return (
    <div className={`flex items-center justify-center ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`${itemLabel} ${i + 1} из ${count}`}
          aria-current={i === active}
          onClick={() => scrollToIndex(i)}
          className="flex h-11 w-11 items-center justify-center"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full transition-[transform,background-color] duration-200 ease-out ${
              i === active ? 'scale-[1.55] bg-primary-600' : 'bg-slate-300'
            }`}
          />
        </button>
      ))}
    </div>
  );
}
