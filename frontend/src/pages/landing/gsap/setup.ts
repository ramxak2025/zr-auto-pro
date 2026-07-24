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
 * режут Google/сторонние хосты (см. правило 4 владельца). SplitText и
 * ScrollSmoother с GSAP 3.13+ входят в бесплатный npm-пакет.
 *
 * Разделение ответственности с framer-motion:
 *   • framer-motion остаётся для точечных micro-interactions (ховеры, layout,
 *     мелкие presence-переходы) — там, где он уже вплетён и уместен;
 *   • GSAP + ScrollTrigger — для СКРОЛЛ-моушена и «вау»-моментов (разные по
 *     секциям входы, счётчики, параллакс, переходы между страницами).
 * Секции на новый моушен переводит следующая фаза; здесь только утилиты.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { SplitText } from 'gsap/SplitText';
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
gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, SplitText);

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

export { gsap, ScrollTrigger, ScrollToPlugin, SplitText, useGSAP };
