import { HTMLAttributes } from 'react';
import { cn } from './cn';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'rect' | 'text' | 'circle';
}

/**
 * Заглушка загрузки. Повторяет форму будущего контента (не спиннер): полоса
 * KPI → четыре плитки, таблица → строки. Пульсация отключается при
 * prefers-reduced-motion глобальным правилом в index.css.
 */
export function Skeleton({ variant = 'rect', className, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-line/70',
        variant === 'circle' ? 'rounded-full' : variant === 'text' ? 'h-3.5 rounded' : 'rounded-md',
        className,
      )}
      {...rest}
    />
  );
}

/** Несколько строк текста; последняя короче, как в настоящем абзаце. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} variant="text" className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}

/** Карточка-заглушка под StatCard/виджет. */
export function SkeletonCard({ className, lines = 2 }: { className?: string; lines?: number }) {
  return (
    <div
      className={cn('rounded-xl border border-line bg-surface p-5 shadow-card', className)}
      role="status"
      aria-label="Загрузка…"
    >
      <div className="flex items-center justify-between">
        <Skeleton variant="text" className="w-24" />
        <Skeleton variant="circle" className="h-8 w-8" />
      </div>
      <Skeleton className="mt-3 h-7 w-32" />
      {lines > 1 && <SkeletonText lines={lines - 1} className="mt-3" />}
    </div>
  );
}

export default Skeleton;
