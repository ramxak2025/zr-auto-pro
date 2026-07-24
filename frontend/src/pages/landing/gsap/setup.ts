/**
 * GSAP-инфраструктура лендинга autexa.pw — единая точка регистрации плагинов.
 *
 * Почему отдельный модуль: плагины регистрируются РОВНО один раз (ES-модуль
 * вычисляется единожды на приложение), а все хелперы (useReveal, useCountUp,
 * useParallax, PageTransition) импортируют gsap/ScrollTrigger отсюда — им не
 * нужно ничего регистрировать самим. Импорт этого файла = гарантия, что
 * плагины подключены до первого твина.
 *
 * Плагины self-hosted через npm (`gsap` 3.15). Никаких CDN — операторы РФ
 * режут Google/сторонние хосты (см. правило 4 владельца).
 *
 * Держим ровно то, что реально используется лендингом: GSAP core + ScrollTrigger
 * (скролл-входы, счётчики, параллакс, переходы страниц). ScrollToPlugin и
 * SplitText выпилены — первый нигде не звался (якорный скролл идёт через нативный
 * window.scrollTo / element.scrollTo), второй заменён ручным разбиением заголовка
 * hero на слова (см. Hero.tsx), чтобы не тащить лишний вес в чанк лендинга.
 * Весь моушен лендинга — GSAP; framer-motion из секций убран.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

/**
 * Пресеты движения — единый словарь для всех секций, чтобы моушен читался как
 * одна система. Только экспоненциальные ease-out (без bounce/elastic — правило
 * вкуса владельца).
 */
export const EASE = {
  /** База для входов контента. */
  out: 'power3.out',
  /** Сильнее «тормозит» в конце — заголовки, крупные карточки. */
  outStrong: 'power4.out',
  /** Максимально резкий финиш — hero, акценты. */
  expo: 'expo.out',
  /** Линейно — только для scrub-параллакса (скролл сам задаёт кривую). */
  none: 'none',
} as const;

export const DUR = {
  /** Переходы между страницами, быстрые акценты. */
  fast: 0.4,
  /** База для reveal-входов секций. */
  base: 0.7,
  /** Крупные «кинематографичные» появления. */
  slow: 1.0,
} as const;

// Регистрация выполняется один раз при первом импорте модуля.
gsap.registerPlugin(ScrollTrigger);

gsap.defaults({ ease: EASE.out, duration: DUR.base });

/**
 * Failsafe от «застрявшего» from-состояния: если позиции триггеров были
 * измерены до подмены веб-шрифта Onest (font-swap двигает высоту текста),
 * пересчитываем их, когда шрифты догрузятся. Без этого reveal, чей start
 * оказался выше фактического, мог не сработать.
 */
if (typeof document !== 'undefined' && 'fonts' in document) {
  document.fonts.ready.then(() => ScrollTrigger.refresh()).catch(() => {});
}

/** Ручной пересчёт позиций триггеров — вызывать после позднего async-контента. */
export function refreshTriggers(): void {
  ScrollTrigger.refresh();
}

export { gsap, ScrollTrigger, useGSAP };
