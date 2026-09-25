import { SelectHTMLAttributes, forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';
import { controlBase, controlInvalid, controlSize, type ControlSize } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize;
  invalid?: boolean;
  /** Короткий путь вместо `<option>`-детей. */
  options?: SelectOption[];
  /** Пустой первый пункт («Все мастера»). */
  placeholder?: string;
}

/**
 * Нативный select со своим шевроном: клавиатура, скринридеры и мобильные
 * пикеры работают из коробки. Обязательно `aria-label` или Field с htmlFor.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', invalid = false, options, placeholder, className, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(controlBase, controlSize[size], 'appearance-none pr-9', invalid && controlInvalid, className)}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
        aria-hidden="true"
      />
    </div>
  );
});

export default Select;
