import { type ReactNode } from 'react';
import { useReveal, type UseRevealOptions } from './useReveal';

interface GsapRevealProps extends UseRevealOptions {
  children: ReactNode;
  className?: string;
}

/**
 * Тонкая компонент-обёртка над useReveal — drop-in замена старого <Reveal> для
 * секций, которым хватает дефолтного контейнера-<div>. Контент виден по
 * CSS-дефолту (opacity в CSS не гасим), поэтому без JS / при reduced-motion
 * секция не остаётся пустой.
 *
 * Примеры:
 *   <GsapReveal type="clip">…мокап…</GsapReveal>
 *   <GsapReveal type="stagger" childSelector="[data-reveal-item]">…сетка…</GsapReveal>
 *
 * Если секции нужен не div (ul/section) или тонкий контроль над разметкой —
 * используйте хук useReveal напрямую и вешайте ref на нужный элемент.
 */
export default function GsapReveal({ children, className, ...options }: GsapRevealProps) {
  const ref = useReveal<HTMLDivElement>(options);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
