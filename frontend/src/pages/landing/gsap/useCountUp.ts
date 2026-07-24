import { useRef, type RefObject } from 'react';
import { gsap, useGSAP, EASE, DUR } from './setup';

export interface UseCountUpOptions {
  /** Финальное число, напр. 48250. */
  end: number;
  /** Стартовое число. По умолчанию 0. */
  start?: number;
  /** Длительность отсчёта, сек. */
  duration?: number;
  /** Знаков после запятой. По умолчанию 0. */
  decimals?: number;
  /** Префикс (напр. '≈ '). */
  prefix?: string;
  /** Суффикс (напр. ' ₽'). */
  suffix?: string;
  /** ScrollTrigger start. По умолчанию 'top 85%'. */
  triggerStart?: string;
  /** Считать один раз. По умолчанию true. */
  once?: boolean;
  /** Ease. По умолчанию power3.out. */
  ease?: string;
}

/**
 * Счётчик числа при въезде в вьюпорт с ru-RU форматированием (неразрывные
 * пробелы разрядов, запятая-десятичный). Для «48 250 ₽», чистой прибыли и т.п.
 *
 * Контракт видимости: финальное значение потребитель рендерит как children —
 * оно и есть CSS-дефолт (виден без JS / в headless). Хук НЕ трогает DOM до
 * срабатывания триггера (gsap.to не рендерит immediate), поэтому если
 * ScrollTrigger по какой-то причине не сработал — на экране остаётся финальное
 * число, а не «0». При reduced-motion сразу выставляем финал.
 *
 * Пример:
 *   const ref = useCountUp<HTMLSpanElement>({ end: 48250, suffix: ' ₽' });
 *   <span ref={ref} className="tabular-nums">48 250 ₽</span>
 *
 * @returns ref на текстовый элемент (span/div), содержащий финальное значение.
 */
export function useCountUp<T extends HTMLElement = HTMLSpanElement>(options: UseCountUpOptions): RefObject<T> {
  const ref = useRef<T>(null);
  const {
    end,
    start = 0,
    duration = DUR.slow,
    decimals = 0,
    prefix = '',
    suffix = '',
    triggerStart = 'top 85%',
    once = true,
    ease = EASE.out,
  } = options;

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const nf = new Intl.NumberFormat('ru-RU', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      const render = (value: number) => {
        el.textContent = `${prefix}${nf.format(value)}${suffix}`;
      };

      const mm = gsap.matchMedia();

      // reduced-motion → мгновенно финальное (форматированное так же, как анимация).
      mm.add('(prefers-reduced-motion: reduce)', () => {
        render(end);
      });

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const counter = { value: start };
        // gsap.to не рендерит immediate → до триггера в DOM остаётся children.
        gsap.to(counter, {
          value: end,
          duration,
          ease,
          onUpdate: () => render(counter.value),
          scrollTrigger: { trigger: el, start: triggerStart, once },
        });
      });
    },
    { scope: ref },
  );

  return ref;
}
