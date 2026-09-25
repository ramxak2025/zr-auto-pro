import { InputHTMLAttributes, ReactNode, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from './cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: ReactNode;
  description?: ReactNode;
  /** Частично выбрано (заголовок таблицы при выборе части строк). */
  indeterminate?: boolean;
}

/**
 * Чекбокс с подписью в ОДНОМ кликабельном таргете (label оборачивает input).
 * Нативный input + accent-color: фокус, пробел, скринридеры — без ARIA-костылей.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, indeterminate = false, className, disabled, ...rest },
  forwardedRef,
) {
  const ref = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLInputElement);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={cn(
        'inline-flex max-w-full cursor-pointer select-none items-start gap-2.5 text-sm text-ink',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-line-strong accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
        {...rest}
      />
      <span className="min-w-0">
        <span className="block leading-5">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-3">{description}</span>}
      </span>
    </label>
  );
});

export default Checkbox;
