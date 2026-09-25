import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { focusRing } from './tokens';

export type IconButtonVariant = 'ghost' | 'secondary' | 'danger' | 'primary' | 'soft';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /**
   * ОБЯЗАТЕЛЬНОЕ доступное имя → aria-label + title. Смысл компонента: кнопки
   * «только иконка» на ~12 страницах объявлялись скринридеру как «button».
   */
  label: string;
  icon: LucideIcon;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Нажатое состояние (переключатели вида, фильтры) → aria-pressed. */
  active?: boolean;
  loading?: boolean;
}

const sizeCls: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8 rounded-md',
  md: 'h-9 w-9 rounded-lg',
  lg: 'h-10 w-10 rounded-lg',
};
const iconCls: Record<IconButtonSize, string> = { sm: 'h-4 w-4', md: 'h-4 w-4', lg: 'h-5 w-5' };
const variantCls: Record<IconButtonVariant, string> = {
  ghost: 'text-ink-3 hover:bg-surface-3 hover:text-ink active:bg-line',
  secondary: 'text-ink-2 bg-surface border border-line-strong shadow-sm hover:bg-surface-2 hover:text-ink',
  danger: 'text-bad hover:bg-bad-soft',
  primary: 'text-white bg-accent shadow-sm hover:bg-accent-hover',
  soft: 'text-accent-text bg-accent-soft hover:bg-accent-soft-2',
};
const activeCls: Record<IconButtonVariant, string> = {
  ghost: 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
  secondary: 'bg-accent-soft text-accent border-accent/40',
  danger: 'bg-bad-soft',
  primary: '',
  soft: 'bg-accent-soft-2',
};

/** Кнопка «только иконка». Hit-area 32/36/40 px, фокус-кольцо, обязательный label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon: Icon,
    variant = 'ghost',
    size = 'md',
    active = false,
    loading = false,
    className,
    type,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      aria-pressed={active ? true : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center transition-[background-color,color,border-color] duration-150 ease-out',
        'disabled:pointer-events-none disabled:opacity-50',
        focusRing,
        sizeCls[size],
        variantCls[variant],
        active && activeCls[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className={cn(iconCls[size], 'animate-spin')} aria-hidden="true" />
      ) : (
        <Icon className={iconCls[size]} aria-hidden="true" />
      )}
    </button>
  );
});

export default IconButton;
