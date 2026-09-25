import { ReactNode, useId } from 'react';
import { cn } from './cn';

export interface RadioOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string = string> {
  /** Общий name для группы; по умолчанию — уникальный id. */
  name?: string;
  value: V | null;
  onChange: (value: V) => void;
  options: RadioOption<V>[];
  /** Видимая подпись группы (legend) или скрытая через `aria-label`. */
  label?: ReactNode;
  'aria-label'?: string;
  orientation?: 'vertical' | 'horizontal';
  disabled?: boolean;
  className?: string;
}

/**
 * Группа радиокнопок на нативных input[type=radio] внутри fieldset:
 * стрелки, Tab, объявление legend — бесплатно.
 */
export function RadioGroup<V extends string = string>({
  name,
  value,
  onChange,
  options,
  label,
  'aria-label': ariaLabel,
  orientation = 'vertical',
  disabled = false,
  className,
}: RadioGroupProps<V>) {
  const autoName = useId();
  const groupName = name ?? autoName;
  return (
    <fieldset
      className={cn('min-w-0 border-0 p-0', className)}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
    >
      {label && <legend className="mb-2 text-sm font-medium text-ink-2">{label}</legend>}
      <div className={cn('flex gap-x-5 gap-y-2', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap')}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'inline-flex cursor-pointer select-none items-start gap-2.5 text-sm text-ink',
              (o.disabled || disabled) && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer border-line-strong accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
            />
            <span className="min-w-0">
              <span className="block leading-5">{o.label}</span>
              {o.description && <span className="mt-0.5 block text-xs text-ink-3">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default RadioGroup;
