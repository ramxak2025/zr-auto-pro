import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { focusRing } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Показывает спиннер, блокирует кнопку и сохраняет её ширину (текст остаётся в потоке, но невидим). */
  loading?: boolean;
  /** Иконка слева от текста (lucide). Для кнопки БЕЗ текста используйте IconButton. */
  icon?: LucideIcon;
  /** Иконка справа от текста (например, ChevronDown у меню). */
  iconRight?: LucideIcon;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-sm hover:bg-accent-hover active:bg-accent-hover',
  secondary:
    'bg-surface text-ink border border-line-strong shadow-sm hover:bg-surface-2 hover:border-ink-4 active:bg-surface-3',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-3 hover:text-ink active:bg-line',
  danger: 'bg-bad text-white shadow-sm hover:bg-bad-text active:bg-bad-text',
  soft: 'bg-accent-soft text-accent-text hover:bg-accent-soft-2 active:bg-accent-soft-2',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-md',
  md: 'h-9 px-3.5 text-sm rounded-lg',
  lg: 'h-11 px-5 text-base rounded-lg',
};

const gapClasses: Record<ButtonSize, string> = { sm: 'gap-1.5', md: 'gap-2', lg: 'gap-2' };
const iconSize: Record<ButtonSize, string> = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-5 w-5' };

/**
 * Классы кнопки без компонента — для `<Link>`/`<a>`, которые должны выглядеть
 * как кнопка: `<Link className={buttonClasses({ variant: 'secondary' })}>`.
 */
export function buttonClasses(
  opts: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {},
): string {
  const { variant = 'primary', size = 'md', fullWidth, className } = opts;
  return cn(
    'relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
    'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out',
    'disabled:pointer-events-none disabled:opacity-50',
    focusRing,
    variantClasses[variant],
    sizeClasses[size],
    gapClasses[size],
    fullWidth && 'w-full',
    className,
  );
}

/**
 * Кнопка действия. Варианты: primary (одна на экран — главное действие),
 * secondary (обычные действия), ghost (третьестепенные, в тулбарах), danger
 * (деструктив, всегда через ConfirmDialog), soft (акцентная плашка).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon: Icon,
    iconRight: IconRight,
    fullWidth,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <Loader2 className={cn(iconSize[size], 'animate-spin')} />
        </span>
      )}
      <span className={cn('inline-flex items-center', gapClasses[size], loading && 'invisible')}>
        {Icon && <Icon className={cn(iconSize[size], 'flex-shrink-0')} aria-hidden="true" />}
        {children}
        {IconRight && <IconRight className={cn(iconSize[size], 'flex-shrink-0')} aria-hidden="true" />}
      </span>
    </button>
  );
});

export default Button;
