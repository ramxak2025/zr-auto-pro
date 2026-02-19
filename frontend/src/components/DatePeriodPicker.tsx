import { useState, useRef, useEffect } from 'react';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import { CalendarDays, ChevronDown } from 'lucide-react';

interface DatePeriodPickerProps {
  dateFrom: string;
  dateTo: string;
  onChange: (from: string, to: string) => void;
}

type QuickFilter = 'today' | 'week' | 'month' | null;

export default function DatePeriodPicker({
  dateFrom,
  dateTo,
  onChange,
}: DatePeriodPickerProps) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    onChange(weekStart, today);
  };

  const applyMonth = () => {
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    onChange(monthStart, today);
  };

  // Detect active quick filter
  const activeFilter = ((): QuickFilter => {
    if (dateFrom === today && dateTo === today) return 'today';
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    if (dateFrom === weekStart && dateTo === today) return 'week';
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
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

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* ── Mobile trigger button ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="
          md:hidden
          inline-flex items-center gap-1.5
          h-8 px-2.5
          bg-white border border-gray-200 rounded-lg
          text-xs font-medium text-gray-700
          shadow-sm
          active:scale-[0.97] transition-all duration-150
        "
      >
        <CalendarDays className="h-3.5 w-3.5 text-primary-500 flex-shrink-0" />
        <span className="truncate max-w-[7rem]">{getLabel()}</span>
        <ChevronDown
          className={`h-3 w-3 text-gray-400 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* ── Mobile dropdown ── */}
      {open && (
        <div
          className="
            md:hidden
            absolute top-full left-0 mt-1.5 z-40
            w-[15rem]
            bg-white rounded-xl border border-gray-100
            shadow-xl shadow-gray-200/60
            animate-fade-in-down
            overflow-hidden
          "
        >
          {/* Quick filters */}
          <div className="flex border-b border-gray-100">
            {filters.map(({ key, label, action }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  action();
                  setOpen(false);
                }}
                className={`
                  flex-1 py-2 text-[11px] font-semibold tracking-wide
                  transition-colors duration-150
                  ${
                    activeFilter === key
                      ? 'text-primary-600 bg-primary-50'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }
                `}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Date inputs */}
          <div className="px-3 pt-2.5 pb-3 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-semibold text-gray-400 uppercase w-5 flex-shrink-0 tracking-wider">
                С
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => onChange(e.target.value, dateTo)}
                className="
                  flex-1 min-w-0
                  h-7 px-2 rounded-md
                  border border-gray-200 bg-gray-50/80
                  text-xs text-gray-700
                  focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30
                  focus:outline-none focus:bg-white
                  transition-colors
                "
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-semibold text-gray-400 uppercase w-5 flex-shrink-0 tracking-wider">
                По
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => onChange(dateFrom, e.target.value)}
                className="
                  flex-1 min-w-0
                  h-7 px-2 rounded-md
                  border border-gray-200 bg-gray-50/80
                  text-xs text-gray-700
                  focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30
                  focus:outline-none focus:bg-white
                  transition-colors
                "
              />
            </div>

            {/* Apply */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="
                w-full h-7 mt-0.5
                text-[11px] font-semibold
                text-white bg-primary-600 hover:bg-primary-700
                rounded-md
                transition-colors duration-150
                active:scale-[0.98]
              "
            >
              Готово
            </button>
          </div>
        </div>
      )}

      {/* ── Desktop: compact inline layout ── */}
      <div className="hidden md:flex items-center gap-2">
        <CalendarDays className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />

        {/* Quick filter pills */}
        <div className="flex items-center gap-1">
          {filters.map(({ key, label, action }) => (
            <button
              key={key}
              type="button"
              onClick={action}
              className={`
                h-7 px-2.5 rounded-md text-[11px] font-semibold
                transition-all duration-150
                ${
                  activeFilter === key
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-gray-200" />

        {/* Compact date fields */}
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">С</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onChange(e.target.value, dateTo)}
            className="
              h-7 w-[8.5rem] px-2 rounded-md
              border border-gray-200 bg-white
              text-xs text-gray-700
              focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30
              focus:outline-none
              transition-colors
            "
          />
          <span className="text-[10px] text-gray-300">—</span>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">По</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onChange(dateFrom, e.target.value)}
            className="
              h-7 w-[8.5rem] px-2 rounded-md
              border border-gray-200 bg-white
              text-xs text-gray-700
              focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30
              focus:outline-none
              transition-colors
            "
          />
        </div>
      </div>
    </div>
  );
}
