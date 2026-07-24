import { useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { gsap, useGSAP, EASE } from './setup';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Короткий кросс-фейд при смене маршрута на страницах сайта (/, /f/:slug,
 * /tarify, /voprosy). Реагирует на изменение location.pathname (НЕ на hash —
 * якорная навигация внутри лендинга hash-only и не должна давать перефейд).
 *
 * Дизайн ради безопасности видимости:
 *   • На ПЕРВОМ рендере (первичная загрузка) анимации НЕТ — контент виден сразу
 *     (не портим LCP и не рискуем «пустой» страницей на старте).
 *   • Анимация только при последующей смене pathname и только в
 *     no-preference — при reduced-motion переход мгновенный.
 *   • Анимируем ТОЛЬКО opacity (autoAlpha), без transform — чтобы не сбить
 *     scroll-restoration LandingPage (scrollIntoView по hash считает позицию по
 *     реальному layout; трансформ ancestor'а её бы смещал). clearProps в конце
 *     снимает inline-стиль.
 *   • gsap.fromTo проигрывается ticker'ом (rAF), не зависит от ScrollTrigger —
 *     фейд гарантированно завершится; в фоновой вкладке rAF пауза и до-играет
 *     при возврате фокуса.
 *
 * Подключение (делает следующая фаза, здесь только компонент): обернуть корневой
 * контент каждой страницы сайта, напр. в LandingPage.tsx:
 *   return (
 *     <PageTransition>
 *       <div id="top" className="…">…секции…</div>
 *     </PageTransition>
 *   );
 * И так же в FeatureDetailPage / TarifyPage / VoprosyPage. Роутер менять не
 * нужно — обёртка живёт внутри страниц; useGSAP киллит контекст при уходе.
 */
export default function PageTransition({ children, className }: PageTransitionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isFirst = useRef(true);
  const { pathname } = useLocation();

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      // Первичная загрузка — без анимации: контент показываем немедленно.
      if (isFirst.current) {
        isFirst.current = false;
        return;
      }

      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          el,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.35, ease: EASE.out, clearProps: 'opacity,visibility', overwrite: 'auto' },
        );
      });
      // reduced-motion → ветку не добавляем: контент виден мгновенно (CSS-дефолт).
    },
    { scope: ref, dependencies: [pathname] },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
