/**
 * Публичный barrel GSAP-инфраструктуры лендинга. Импортируйте отсюда:
 *   import { useReveal, useCountUp, useParallax, GsapReveal, PageTransition } from '../gsap';
 *
 * Весь моушен лендинга — GSAP + ScrollTrigger (скролл-входы, счётчики,
 * параллакс, переходы страниц). framer-motion из секций лендинга убран, чтобы
 * не грузить две анимационные библиотеки на первом заходе.
 */
export { gsap, ScrollTrigger, useGSAP, EASE, DUR, refreshTriggers } from './setup';

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
