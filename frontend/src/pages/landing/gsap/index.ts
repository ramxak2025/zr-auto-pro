/**
 * Публичный barrel GSAP-инфраструктуры лендинга. Импортируйте отсюда:
 *   import { useReveal, useCountUp, useParallax, GsapReveal, PageTransition } from '../gsap';
 *
 * Разделение: framer-motion — точечные micro-interactions (там, где уже
 * вплетён и уместен); GSAP + ScrollTrigger — скролл-моушен и «вау»-моменты
 * (разные по секциям входы, счётчики, параллакс, переходы страниц). Перевод
 * секций на эти утилиты — следующая фаза.
 */
export { gsap, ScrollTrigger, ScrollToPlugin, SplitText, useGSAP, EASE, DUR, refreshTriggers } from './setup';

export { useReveal } from './useReveal';
export type { UseRevealOptions, RevealType } from './useReveal';

export { default as GsapReveal } from './GsapReveal';

export { useCountUp } from './useCountUp';
export type { UseCountUpOptions } from './useCountUp';

export { useParallax } from './useParallax';
export type { UseParallaxOptions } from './useParallax';

export { default as PageTransition } from './PageTransition';

// initSmoothScroll/killSmoothScroll (ScrollSmoother) НАМЕРЕННО не реэкспортим:
// хелпер выключен по умолчанию (см. smoothScroll.ts), а barrel-реэкспорт тянул
// бы ScrollSmoother в бандл лендинга мёртвым весом. Если понадобится —
// импортируйте напрямую из './smoothScroll'.
