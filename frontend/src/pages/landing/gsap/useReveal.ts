import { useRef, type RefObject } from 'react';
import { gsap, useGSAP, EASE, DUR } from './setup';

/**
 * Разные по характеру входы — НЕ один generic fade+rise на каждую секцию.
 * Следующая фаза подбирает тип под то, что открывает: 'clip'/'blur-rise' для
 * визуальных мокапов, 'stagger' для списков и сеток карточек, 'scale-in' для
 * бейджей/чипов, 'slide-*' для двухколоночных блоков.
 */
export type RevealType =
  | 'rise' // подъём снизу + fade (спокойный дефолт)
  | 'fade' // чистое проявление
  | 'clip' // маска-вытеснение снизу вверх (clip-path) — мокапы, изображения
  | 'scale-in' // лёгкий зум из 0.94 — бейджи, компактные карточки
  | 'blur-rise' // подъём + расфокус→фокус (на mobile деградирует до 'rise')
  | 'slide-left' // въезд справа, оседает влево — правые колонки
  | 'slide-right' // въезд слева, оседает вправо — левые колонки
  | 'stagger'; // каскад дочерних (rise по каждому ребёнку)

export interface UseRevealOptions {
  /** Характер входа. По умолчанию 'rise'. */
  type?: RevealType;
  /**
   * CSS-селектор дочерних элементов для каскада. Если задан — анимируются они
   * со stagger'ом, а не корень. Для type:'stagger' без селектора берутся прямые
   * дети контейнера.
   */
  childSelector?: string;
  /** ScrollTrigger start. По умолчанию 'top 82%'. */
  start?: string;
  /** Длительность одного элемента, сек. */
  duration?: number;
  /** Смещение для rise/slide/scale, px. */
  distance?: number;
  /** Задержка старта, сек. */
  delay?: number;
  /** Пауза между дочерними при каскаде, сек. */
  stagger?: number;
  /** Ease. По умолчанию power3.out. */
  ease?: string;
  /** Проигрывать один раз (не повторять при обратном скролле). По умолчанию true. */
  once?: boolean;
}

interface RevealVars {
  from: gsap.TweenVars;
  to: gsap.TweenVars;
}

/**
 * from-состояние ставится ТОЛЬКО внутри no-preference ветки matchMedia и только
 * когда GSAP реально инициализировался — поэтому в CSS контент виден по
 * умолчанию, и при reduced-motion / без JS / в headless он НЕ пропадает.
 */
function buildVars(type: RevealType, distance: number, allowBlur: boolean): RevealVars {
  const base: gsap.TweenVars = { willChange: 'transform, opacity' };
  switch (type) {
    case 'fade':
      return { from: { autoAlpha: 0, ...base }, to: { autoAlpha: 1 } };
    case 'slide-left':
      return { from: { autoAlpha: 0, x: distance, ...base }, to: { autoAlpha: 1, x: 0 } };
    case 'slide-right':
      return { from: { autoAlpha: 0, x: -distance, ...base }, to: { autoAlpha: 1, x: 0 } };
    case 'scale-in':
      return {
        from: { autoAlpha: 0, scale: 0.94, y: distance * 0.5, transformOrigin: '50% 60%', ...base },
        to: { autoAlpha: 1, scale: 1, y: 0 },
      };
    case 'clip':
      return {
        from: {
          autoAlpha: 0,
          y: distance * 0.4,
          clipPath: 'inset(0% 0% 100% 0%)',
          willChange: 'clip-path, transform, opacity',
        },
        to: { autoAlpha: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)' },
      };
    case 'blur-rise':
      // filter:blur тяжёл на слабых мобильных GPU — на узких экранах отдаём 'rise'.
      return allowBlur
        ? {
            from: { autoAlpha: 0, y: distance, filter: 'blur(10px)', willChange: 'transform, opacity, filter' },
            to: { autoAlpha: 1, y: 0, filter: 'blur(0px)' },
          }
        : { from: { autoAlpha: 0, y: distance, ...base }, to: { autoAlpha: 1, y: 0 } };
    case 'rise':
    case 'stagger':
    default:
      return { from: { autoAlpha: 0, y: distance, ...base }, to: { autoAlpha: 1, y: 0 } };
  }
}

/**
 * Reveal-вход по скроллу на @gsap/react useGSAP.
 *
 * Контракт видимости (критично): элементы видимы по CSS-дефолту. Хук прячет их
 * (`gsap.set(from)`) ТОЛЬКО в ветке '(prefers-reduced-motion: no-preference)'
 * и сразу заводит анимацию к видимому состоянию. При reduced-motion ветка не
 * трогает DOM — контент остаётся видимым мгновенно. Любая ошибка внутри ловится
 * try/catch и форсит показ (`clearProps`). ScrollTrigger'ы живут в gsap.context
 * useGSAP и киллятся при размонтировании (важно для SPA-роутинга сайта).
 *
 * @returns ref, который вешаем на контейнер секции/карточки.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(options: UseRevealOptions = {}): RefObject<T> {
  const ref = useRef<T>(null);
  const {
    type = 'rise',
    childSelector,
    start = 'top 82%',
    duration = DUR.base,
    distance = 28,
    delay = 0,
    stagger = 0.08,
    ease = EASE.out,
    once = true,
  } = options;

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const staggered = Boolean(childSelector) || type === 'stagger';
      const targets: Element[] = childSelector
        ? gsap.utils.toArray<Element>(childSelector, el)
        : type === 'stagger'
          ? (Array.from(el.children) as Element[])
          : [el];

      // Нечего анимировать — контент просто остаётся видимым (CSS-дефолт).
      if (targets.length === 0) return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          reduce: '(prefers-reduced-motion: reduce)',
          ok: '(prefers-reduced-motion: no-preference)',
          desktop: '(min-width: 768px)',
        },
        (context: gsap.Context) => {
          const c = context.conditions ?? {};
          if (c.reduce) return; // reduced-motion → ничего не прячем, контент виден

          try {
            const { from, to } = buildVars(type, distance, Boolean(c.desktop));
            gsap.set(targets, from);
            gsap.to(targets, {
              ...to,
              duration,
              ease,
              delay,
              stagger: staggered ? stagger : 0,
              overwrite: 'auto',
              // Чистим inline-стили после входа: снимаем will-change/filter/clip,
              // возвращаем натуральный (видимый) вид — ничего не «залипает».
              onComplete: () => gsap.set(targets, { clearProps: 'all' }),
              scrollTrigger: { trigger: el, start, once },
            });
          } catch {
            // Любой сбой моушена не должен оставить секцию пустой.
            gsap.set(targets, { clearProps: 'all' });
          }
        },
      );
    },
    { scope: ref },
  );

  return ref;
}
