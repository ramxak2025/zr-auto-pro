import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import type { ReportFilterOption } from '../../types';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Input } from '../../ui/Input';
import { SkeletonText } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { ErrorRow } from '../dashboard/shared';

interface EntityFilterProps {
  /** Подпись фильтра из каталога: «Мастера», «Поставщики». */
  label: string;
  options: ReportFilterOption[] | undefined;
  selected: string[];
  onChange: (ids: string[]) => void;
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  onRetry?: () => void;
  className?: string;
}

/**
 * Сущностный фильтр отчёта: мультивыбор с поиском в поповере. Выбор
 * применяется сразу (отчёт перезапрашивается, старая таблица остаётся на
 * экране до прихода новой). «Все» — пустой выбор. Выбранные показываются
 * чипами под тулбаром (SelectedChips), чтобы фильтр был виден и без открытия.
 */
export default function EntityFilter({
  label,
  options,
  selected,
  onChange,
  isLoading = false,
  isError = false,
  isFetching = false,
  onRetry,
  className,
}: EntityFilterProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 20);
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const all = useMemo(() => options ?? [], [options]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q));
  }, [all, query]);

  const summary =
    selected.length === 0
      ? 'все'
      : selected.length === 1
        ? (all.find((o) => o.id === selected[0])?.label ?? '1')
        : `${selected.length} из ${all.length}`;

  const toggle = (optionId: string) => {
    const next = new Set(selectedSet);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    // Порядок — как в справочнике, чтобы ссылка была стабильной.
    onChange(all.filter((o) => next.has(o.id)).map((o) => o.id));
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Button
        ref={triggerRef}
        variant="secondary"
        icon={SlidersHorizontal}
        iconRight={ChevronDown}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(selected.length > 0 && 'border-accent/50 text-accent-text')}
      >
        <span className="max-w-[14rem] truncate">
          {label}: {summary}
        </span>
      </Button>

      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-30 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-2 shadow-pop motion-safe:animate-pop-in"
        >
          <Input
            ref={searchRef}
            size="sm"
            leftIcon={Search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти…"
            aria-label={`Поиск: ${label.toLowerCase()}`}
            autoComplete="off"
          />
          <div className="mt-2 flex items-center justify-between px-1">
            <span className="text-xs text-ink-3">
              {selected.length === 0 ? 'Выбраны все' : `Выбрано: ${selected.length}`}
            </span>
            {selected.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onChange([])}>
                Сбросить
              </Button>
            )}
          </div>
          <div className="mt-1 max-h-64 overflow-y-auto overscroll-contain">
            {isLoading ? (
              <SkeletonText lines={4} className="px-2 py-2" />
            ) : isError ? (
              <ErrorRow message="Не удалось загрузить список" onRetry={onRetry} loading={isFetching} className="m-1" />
            ) : visible.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-ink-3">
                {all.length === 0 ? 'Список пуст' : 'Ничего не найдено'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {visible.map((o) => (
                  <li key={o.id}>
                    <Checkbox
                      label={o.label}
                      description={o.sublabel}
                      checked={selectedSet.has(o.id)}
                      onChange={() => toggle(o.id)}
                      className="w-full rounded-lg px-2 py-1.5 hover:bg-surface-3"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SelectedChipsProps {
  label: string;
  options: ReportFilterOption[] | undefined;
  selected: string[];
  onChange: (ids: string[]) => void;
}

/** Чипы выбранных сущностей под тулбаром: имя + «убрать». */
export function SelectedChips({ label, options, selected, onChange }: SelectedChipsProps) {
  if (selected.length === 0) return null;
  const nameOf = (id: string) => options?.find((o) => o.id === id)?.label ?? '…';
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={`Выбранные: ${label.toLowerCase()}`}>
      <span className="text-xs text-ink-3">{label}:</span>
      {selected.map((id) => (
        <span
          key={id}
          className="inline-flex h-7 max-w-[16rem] items-center gap-1 rounded-md bg-accent-soft pl-2.5 pr-1 text-xs font-medium text-accent-text"
        >
          <span className="truncate">{nameOf(id)}</span>
          <button
            type="button"
            aria-label={`Убрать ${nameOf(id)}`}
            onClick={() => onChange(selected.filter((x) => x !== id))}
            className={cn(
              'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-accent-text hover:bg-accent-soft-2',
              focusRing,
            )}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange([])}>
        Все
      </Button>
    </div>
  );
}
