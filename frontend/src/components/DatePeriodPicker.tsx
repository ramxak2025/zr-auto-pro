import { useState, useRef, useEffect, useId } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';

import { useTenantCalendar } from '../hooks/useTenantTimezone';
import { cn } from '../ui/cn';
import { controlBase } from '../ui/Input';
import { focusRing } from '../ui/tokens';

interface DatePeriodPickerProps {
  dateFrom: string;
  dateTo: string;
  onChange: (from: string, to: string) => void;
}

type QuickFilter = 'today' | 'week' | 'month' | null;

export default function DatePeriodPicker({ dateFrom, dateTo, onChange }: DatePeriodPickerProps) {
  /**
   * «СЕГОДНЯ / НЕДЕЛЯ / МЕСЯЦ» — ПО КАЛЕНДАРЮ АВТОСЕРВИСА, А НЕ БРАУЗЕРА (157).
   *
   * Границы периода уезжают на сервер как dateFrom/dateTo, а сервер режет
   * бизнес-сутки поясом тенанта (common/timezone.ts). Пока «сегодня» считалось
   * часами машины, эти два календаря расходились на сутки у любого, кто открыл
   * админку из другого региона: владелец из Владивостока в 08:00 своего утра
   * (ещё 01:00 в Москве) жал «Сегодня» и получал ПУСТУЮ кассу, потому что
   * просил у сервера завтрашний день. Тот же сдвиг ломал и подсветку активного
   * фильтра — пилюля «Сегодня» гасла на корректном диапазоне.
   */
  const { today, weekStart, monthStart } = useTenantCalendar();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('keydown', handleKey);
    }
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const applyToday = () => {
    onChange(today, today);
  };

  const applyWeek = () => {
    onChange(weekStart, today);
  };

  const applyMonth = () => {
    onChange(monthStart, today);
  };

  // Detect active quick filter
  const activeFilter = ((): QuickFilter => {
    if (dateFrom === today && dateTo === today) return 'today';
    if (dateFrom === weekStart && dateTo === today) return 'week';
    if (dateFrom === monthStart && dateTo === today) return 'month';
    return null;
  })();

  // Compact label
  const getLabel = () => {
    if (!dateFrom && !dateTo) return 'Период';
    if (activeFilter === 'today') return 'Сегодня';
    if (activeFilter === 'week') return 'Неделя';
    if (activeFilter === 'month') return 'Месяц';
    if (dateFrom && dateTo) {
      const f = dateFrom.slice(5).replace('-', '.');
      const t = dateTo.slice(5).replace('-', '.');
      if (dateFrom === dateTo) return f;
      return `${f} – ${t}`;
    }
    return 'Период';
  };

  const filters: { key: QuickFilter; label: string; action: () => void }[] = [
    { key: 'today', label: 'Сегодня', action: applyToday },
    { key: 'week', label: 'Неделя', action: applyWeek },
    { key: 'month', label: 'Месяц', action: applyMonth },
  ];

  const dateInputMobile = cn(controlBase, 'h-10 min-w-0 flex-1 px-3 text-sm');
  const dateInputDesktop = cn(controlBase, 'h-8 w-[8.75rem] px-2 text-xs shadow-none');

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* ── Мобильный триггер ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-sm font-medium text-ink shadow-sm transition-[background-color] duration-150 active:bg-surface-2 md:hidden',
          focusRing,
        )}
      >
        <CalendarDays className="h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
        <span className="max-w-[8rem] truncate">{getLabel()}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 text-ink-4 transition-transform duration-150', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {/* ── Мобильная выпадашка ── */}
      {open && (
        <div
          role="dialog"
          aria-label="Период"
          className="fixed inset-x-3 top-auto z-50 mt-2 overflow-hidden rounded-xl border border-line bg-surface shadow-pop motion-safe:animate-pop-in md:hidden"
        >
          <div className="flex border-b border-line">
            {filters.map(({ key, label, action }) => (
              <button
                key={key}
                type="button"
                aria-pressed={activeFilter === key}
                onClick={() => {
                  action();
                  setOpen(false);
                }}
                className={cn(
                  'flex-1 py-3 text-sm font-semibold transition-colors duration-150',
                  activeFilter === key
                    ? 'bg-accent-soft text-accent-text'
                    : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-3 px-4 pb-4 pt-3">
            <label className="flex items-center gap-3 text-xs font-semibold text-ink-3">
              <span className="w-6 flex-shrink-0">С</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => onChange(e.target.value, dateTo)}
                className={dateInputMobile}
              />
            </label>
            <label className="flex items-center gap-3 text-xs font-semibold text-ink-3">
              <span className="w-6 flex-shrink-0">По</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => onChange(dateFrom, e.target.value)}
                className={dateInputMobile}
              />
            </label>
            <button type="button" onClick={() => setOpen(false)} className="btn-primary mt-1 w-full">
              Готово
            </button>
          </div>
        </div>
      )}

      {/* ── Десктоп: компактная строка ── */}
      <div className="hidden items-center gap-2 md:flex">
        <div
          role="group"
          aria-label="Быстрый период"
          className="inline-flex items-center rounded-lg bg-surface-3 p-0.5"
        >
          {filters.map(({ key, label, action }) => (
            <button
              key={key}
              type="button"
              aria-pressed={activeFilter === key}
              onClick={action}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150',
                focusRing,
                activeFilter === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="h-5 w-px bg-line-strong" aria-hidden="true" />

        <div className="flex items-center gap-1.5">
          <label htmlFor={`${id}-from`} className="text-xs font-medium text-ink-3">
            с
          </label>
          <input
            id={`${id}-from`}
            type="date"
            value={dateFrom}
            onChange={(e) => onChange(e.target.value, dateTo)}
            className={dateInputDesktop}
          />
          <label htmlFor={`${id}-to`} className="text-xs font-medium text-ink-3">
            по
          </label>
          <input
            id={`${id}-to`}
            type="date"
            value={dateTo}
            onChange={(e) => onChange(dateFrom, e.target.value)}
            className={dateInputDesktop}
          />
        </div>
      </div>
    </div>
  );
}
