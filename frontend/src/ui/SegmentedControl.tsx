import { ReactNode, useRef, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { focusRing } from './tokens';

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Всплывающая подсказка (для вариантов «только иконка» — обязательна как доступное имя). */
  title?: string;
}

export interface SegmentedControlProps<V extends string = string> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  'aria-label': string;
  className?: string;
}

/**
 * Переключатель взаимоисключающих вариантов (период: Неделя · Месяц · Год;
 * вид: таблица · плитки). Семантика radiogroup: стрелки меняют значение,
 * Tab — один стоп на всю группу. Для 4+ вариантов или разных экранов — Tabs.
 */
export function SegmentedControl<V extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  'aria-label': ariaLabel,
  className,
}: SegmentedControlProps<V>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    const pos = enabled.findIndex((o) => o.value === value);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (pos + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (pos - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const v = enabled[next].value;
    onChange(v);
    refs.current[v]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'no-scrollbar inline-flex max-w-full items-center overflow-x-auto rounded-lg bg-surface-3 p-0.5',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {options.map((o) => {
        const checked = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[o.value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.title}
            title={o.title}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={cn(
              'inline-flex flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,color,box-shadow] duration-150',
              // Кольцо фокуса внутри сегмента: контейнер прокручивается по горизонтали на узких
              // экранах (overflow-x), и внешнее кольцо со смещением он бы обрезал.
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              fullWidth && 'flex-1',
              checked ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
              o.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
