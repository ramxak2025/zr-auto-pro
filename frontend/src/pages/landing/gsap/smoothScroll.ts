import { gsap, ScrollTrigger } from './setup';
import { ScrollSmoother } from 'gsap/ScrollSmoother';

export interface SmoothScrollOptions {
  /** Инерция скролла, сек (0.6–1.5 разумно). По умолчанию 1. */
  smooth?: number;
  /** Data-speed / data-lag эффекты на детях. По умолчанию false (лишний вес). */
  effects?: boolean;
}

/**
 * ⚠️ ОПЦИОНАЛЬНО и ПО УМОЛЧАНИЮ ВЫКЛЮЧЕНО. Не вызывается нигде в проекте.
 *
 * ScrollSmoother даёт «премиальную» инерцию колеса на desktop, но:
 *   1. требует обёртку #smooth-wrapper > #smooth-content вокруг всего контента;
 *   2. скроллит через transform, поэтому нативные scrollIntoView / scrollTo и
 *      `scroll-behavior:smooth` перестают работать — а LandingPage.tsx ведёт
 *      якорную навигацию именно через scrollIntoView по hash. Включив Smoother
 *      глобально, вы СЛОМАЕТЕ переходы шапки/GlassTabBar по #features и т.п.
 *      (пришлось бы переводить их на ScrollSmoother.scrollTo).
 *
 * Поэтому глобально НЕ включаем. Хелпер оставлен как осознанная точка входа:
 * если позже добавите нужную DOM-обёртку и переведёте якоря на smoother.scrollTo,
 * зовите initSmoothScroll() один раз после монтирования корня страницы.
 *
 * Сам по себе безопасен: без нужной обёртки, на touch или при reduced-motion
 * возвращает null и ничего не делает.
 */
export function initSmoothScroll(options: SmoothScrollOptions = {}): ScrollSmoother | null {
  if (typeof window === 'undefined') return null;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // Никогда на touch/мобиле и при reduced-motion — мобильный скролл не трогаем.
  if (reduce || coarse) return null;

  // Без требуемой DOM-структуры молча выходим (не ломаем layout/якоря).
  if (!document.querySelector('#smooth-wrapper') || !document.querySelector('#smooth-content')) {
    return null;
  }

  gsap.registerPlugin(ScrollSmoother);
  return ScrollSmoother.create({
    wrapper: '#smooth-wrapper',
    content: '#smooth-content',
    smooth: options.smooth ?? 1,
    effects: options.effects ?? false,
    normalizeScroll: false,
    ignoreMobileResize: true,
  });
}

/** Убрать Smoother (если создавали) и вернуть нативный скролл. */
export function killSmoothScroll(): void {
  ScrollSmoother.get()?.kill();
  ScrollTrigger.refresh();
}
