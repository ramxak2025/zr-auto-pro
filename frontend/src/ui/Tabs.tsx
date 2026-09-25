import { ReactNode, useRef, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { focusRing } from './tokens';

export interface TabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  count?: number;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface TabsProps<K extends string = string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** underline — вкладки раздела страницы; pills — переключатель внутри карточки. */
  variant?: 'underline' | 'pills';
  size?: 'sm' | 'md';
  /** Обязательное имя списка вкладок для скринридера. */
  'aria-label': string;
  /** Префикс id для связи с TabPanel (`${idPrefix}-tab-${key}` / `${idPrefix}-panel-${key}`). */
  idPrefix?: string;
  fullWidth?: boolean;
  className?: string;
}

/**
 * Вкладки с ролью tablist: стрелки ←/→, Home/End, roving tabindex. Содержимое
 * вкладок рендерит вызывающий (TabPanel — тонкая обёртка с aria-связями).
 * Если состояние вкладки должно переживать F5 — держите его в query-параметре.
 */
export function Tabs<K extends string = string>({
  items,
  value,
  onChange,
  variant = 'underline',
  size = 'md',
  'aria-label': ariaLabel,
  idPrefix = 'tabs',
  fullWidth = false,
  className,
}: TabsProps<K>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const focusAndSelect = (key: K) => {
    onChange(key);
    refs.current[key]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = items.filter((i) => !i.disabled);
    const pos = enabled.findIndex((i) => i.key === items[index].key);
    if (pos === -1) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (pos + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (pos - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    focusAndSelect(enabled[next].key);
  };

  const isPills = variant === 'pills';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex max-w-full items-center overflow-x-auto no-scrollbar',
        isPills ? 'gap-1 rounded-lg bg-surface-3 p-0.5' : 'gap-1 border-b border-line',
        fullWidth && 'w-full',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.key === value;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[item.key] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.key}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${item.key}`}
            aria-disabled={item.disabled || undefined}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'relative inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap font-medium transition-colors duration-150',
              focusRing,
              fullWidth && 'flex-1 justify-center',
              size === 'sm' ? 'text-xs' : 'text-sm',
              item.disabled && 'cursor-not-allowed opacity-50',
              isPills
                ? cn(
                    'rounded-md',
                    size === 'sm' ? 'h-7 px-2.5' : 'h-8 px-3',
                    active ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
                  )
                : cn(
                    '-mb-px border-b-2 px-3',
                    size === 'sm' ? 'h-9' : 'h-10',
                    active
                      ? 'border-accent text-accent-text'
                      : 'border-transparent text-ink-2 hover:border-line-strong hover:text-ink',
                  ),
            )}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {item.label}
            {typeof item.count === 'number' && (
              <span
                className={cn(
                  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums',
                  active ? 'bg-accent-soft text-accent-text' : 'bg-surface-3 text-ink-3',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idPrefix?: string;
  tabKey: string;
  active: boolean;
  children: ReactNode;
  className?: string;
}

/** Панель вкладки с aria-связями; неактивная не рендерится (нет скрытых запросов). */
export function TabPanel({ idPrefix = 'tabs', tabKey, active, children, className }: TabPanelProps) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${tabKey}`}
      aria-labelledby={`${idPrefix}-tab-${tabKey}`}
      tabIndex={0}
      className={cn('outline-none', className)}
    >
      {children}
    </div>
  );
}

export default Tabs;
