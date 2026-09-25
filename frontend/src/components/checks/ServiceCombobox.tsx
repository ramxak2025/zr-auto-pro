import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { Service } from '../../types';
import { cn } from '../../ui/cn';
import { controlBase, controlSize } from '../../ui/Input';
import { Money } from '../../ui/Money';

export interface ServiceComboboxProps {
  services: Service[];
  /** id выбранной услуги ('' — не выбрана). */
  value: string;
  /** Имя строки без catalog-id (edit-режим старых чеков) — показываем как есть. */
  fallbackName?: string;
  onChange: (serviceId: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const MAX_VISIBLE = 60;

/**
 * Выбор услуги с поиском по названию — вместо нативного <select> со всеми
 * услугами (аудит 2.3: самый медленный шаг кассира на десктопе). Семантика
 * combobox + listbox: ↑/↓ по списку, Enter — выбрать, Escape — закрыть,
 * Tab — закрыть и уйти. Ввод только фильтрует: свободный текст услугой не
 * становится (поведение прежнего select сохранено).
 */
export default function ServiceCombobox({
  services,
  value,
  fallbackName,
  onChange,
  id,
  disabled,
  placeholder = 'Найти услугу…',
  className,
}: ServiceComboboxProps) {
  const autoId = useId();
  const inputId = id ?? `svc-${autoId}`;
  const listId = `${inputId}-list`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(() => services.find((s) => s.id === value) ?? null, [services, value]);
  const selectedLabel = selected?.name ?? (value ? '' : (fallbackName ?? ''));

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? services.filter((s) => s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q))
      : services;
    return list.slice(0, MAX_VISIBLE);
  }, [services, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    const idx = filtered.findIndex((s) => s.id === value);
    setActive(idx >= 0 ? idx : 0);
  };

  const select = (s: Service) => {
    onChange(s.id);
    setOpen(false);
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else setActive((a) => Math.min(a + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        select(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery('');
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
      setQuery('');
    }
  };

  const activeId = open && filtered[active] ? `${listId}-opt-${filtered[active].id}` : undefined;

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label="Услуга"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : selectedLabel}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (!open) setOpen(true);
        }}
        onFocus={openList}
        onClick={openList}
        onKeyDown={onKeyDown}
        className={cn(controlBase, controlSize.md, 'pl-9 pr-8', !selected && !open && !fallbackName && 'text-ink-3')}
      />
      <ChevronDown
        className={cn(
          'pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3 transition-transform duration-150',
          open && 'rotate-180',
        )}
        aria-hidden="true"
      />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Услуги"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop motion-safe:animate-pop-in"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-3 text-center text-sm text-ink-3" role="presentation">
              {services.length === 0 ? 'Справочник услуг пуст' : 'Ничего не найдено'}
            </li>
          ) : (
            filtered.map((s, i) => {
              const isActive = i === active;
              const isSelected = s.id === value;
              return (
                // Мышь: клик выбирает; клавиатура ведётся из input (aria-activedescendant).
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={s.id}
                  id={`${listId}-opt-${s.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(s)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm',
                    isActive ? 'bg-surface-3 text-ink' : 'text-ink-2',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{s.name}</span>
                    {s.category && <span className="block truncate text-xs text-ink-3">{s.category}</span>}
                  </span>
                  <Money value={s.defaultPrice} className="text-sm font-medium text-ink-2" />
                  {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />}
                </li>
              );
            })
          )}
          {services.length > MAX_VISIBLE && filtered.length === MAX_VISIBLE && (
            <li className="px-3 py-1.5 text-center text-2xs text-ink-3" role="presentation">
              Показаны первые {MAX_VISIBLE} — уточните запрос
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
