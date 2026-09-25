import { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { toneDot, toneSoft, type Tone } from './tokens';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: 'sm' | 'md';
  /** Точка-индикатор слева (статусы). */
  dot?: boolean;
  icon?: LucideIcon;
  /** Контурный вариант для нейтральных меток (тег, категория). */
  outline?: boolean;
  children: ReactNode;
}

/**
 * Метка/статус. Тон — только по смыслу (см. tokens.ts). Текст 12 px/500,
 * высота 22 px (sm — 18 px). Не используйте бейджи как кнопки.
 */
export function Badge({
  tone = 'neutral',
  size = 'md',
  dot = false,
  icon: Icon,
  outline = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center whitespace-nowrap rounded-md font-medium',
        size === 'sm' ? 'h-[18px] gap-1 px-1.5 text-2xs' : 'h-[22px] gap-1.5 px-2 text-xs',
        outline ? 'border border-line-strong bg-surface text-ink-2' : toneSoft[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', toneDot[tone])} aria-hidden="true" />}
      {Icon && <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export interface StatusPillProps extends Omit<BadgeProps, 'dot'> {
  /** Пульсирующая точка для «живых» статусов (смена открыта, идёт синхронизация). Уважает reduced-motion. */
  live?: boolean;
}

/** Статус с точкой: «Оплачен», «Отложен», «На смене». */
export function StatusPill({ live = false, tone = 'neutral', className, children, ...rest }: StatusPillProps) {
  return (
    <Badge tone={tone} className={cn('rounded-full', className)} {...rest}>
      <span className="relative mr-1.5 inline-flex h-1.5 w-1.5" aria-hidden="true">
        {live && (
          <span className={cn('absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping', toneDot[tone])} />
        )}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', toneDot[tone])} />
      </span>
      {children}
    </Badge>
  );
}

export default Badge;
