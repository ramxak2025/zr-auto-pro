import { useRef, type RefObject } from 'react';
import { gsap, useGSAP, EASE } from './setup';

export interface UseParallaxOptions {
  /** Итоговое смещение по Y за проход скролла, px. Отрицательное = вверх (дефолт -60). */
  y?: number;
  /** Смещение по X, px. */
  x?: number;
  /** Целевой scale (лёгкий, напр. 1.08). По умолчанию без масштаба. */
  scale?: number;
  /** ScrollTrigger start. По умолчанию 'top bottom'. */
  start?: string;
  /** ScrollTrigger end. По умолчанию 'bottom top'. */
  end?: string;
  /** Плавность привязки к скроллу. По умолчанию 1 (лёгкое сглаживание). */
  scrub?: number | boolean;
}

/**
 * Лёгкий scrub-параллакс декоративных слоёв (mesh-блобы hero, фоновые пятна).
 *
 * ТОЛЬКО desktop + указатель мыши + no-preference: на touch/мобиле и при
 * reduced-motion хук ничего не делает — элемент стоит на месте (мобильный
 * скролл не хайджекаем, 60fps не рискуем). Анимируются только transform-свойства
 * (y/x/scale), layout не трогаем. Элемент декоративный и виден по CSS-дефолту —
 * параллакс лишь смещает его, видимость не гейтит.
 *
 * @returns ref на декоративный слой (aria-hidden).
 */
export function useParallax<T extends HTMLElement = HTMLDivElement>(options: UseParallaxOptions = {}): RefObject<T> {
  const ref = useRef<T>(null);
  const { y = -60, x = 0, scale, start = 'top bottom', end = 'bottom top', scrub = 1 } = options;

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const mm = gsap.matchMedia();
      mm.add('(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
        const to: gsap.TweenVars = { y, x, ease: EASE.none, willChange: 'transform' };
        if (scale != null) to.scale = scale;
        gsap.to(el, {
          ...to,
          scrollTrigger: { trigger: el, start, end, scrub, invalidateOnRefresh: true },
        });
      });
    },
    { scope: ref },
  );

  return ref;
}
