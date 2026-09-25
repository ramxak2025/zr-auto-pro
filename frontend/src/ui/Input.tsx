import { InputHTMLAttributes, ReactNode, forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

export type ControlSize = 'sm' | 'md';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize;
  /** Иконка слева внутри поля (Search, Phone…). */
  leftIcon?: LucideIcon;
  /** Слот справа: единица измерения, кнопка очистки, спиннер. */
  rightSlot?: ReactNode;
  invalid?: boolean;
}

/** Общие классы контролов ввода — используют Input, Select, Textarea и .input в index.css. */
export const controlBase =
  'block w-full rounded-lg border border-line-strong bg-surface text-ink placeholder:text-ink-3 shadow-sm ' +
  'transition-[border-color,box-shadow] duration-150 ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3 read-only:bg-surface-2';

export const controlInvalid = 'border-bad focus:border-bad focus:ring-bad/25';

export const controlSize: Record<ControlSize, string> = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-9 px-3 text-sm',
};

/**
 * Текстовое поле. Высота 36 px (sm — 32), радиус 8, фокус — синяя рамка + кольцо
 * 25 %. На мобильных глобальный CSS поднимает шрифт до 16 px против авто-зума iOS.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', leftIcon: LeftIcon, rightSlot, invalid = false, className, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        controlSize[size],
        invalid && controlInvalid,
        LeftIcon && 'pl-9',
        rightSlot && 'pr-9',
        className,
      )}
      {...rest}
    />
  );
  if (!LeftIcon && !rightSlot) return input;
  return (
    <div className="relative">
      {LeftIcon && (
        <LeftIcon
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
      )}
      {input}
      {rightSlot && <div className="absolute inset-y-0 right-2 flex items-center text-ink-3">{rightSlot}</div>}
    </div>
  );
});

export default Input;
