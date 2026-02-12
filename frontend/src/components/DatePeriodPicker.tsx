import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, X } from 'lucide-react';

type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'custom';

interface PeriodOption {
  key: PeriodKey;
  label: string;
}

const PERIODS: PeriodOption[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'year', label: 'Год' },
  { key: 'custom', label: 'Свой период' },
];

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function calcRange(period: PeriodKey): { from: string; to: string } {
  const now = new Date();
  const to = toISO(now);

  switch (period) {
    case 'today':
      return { from: toISO(now), to };
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { from: toISO(d), to };
    }
    case 'month': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return { from: toISO(d), to };
    }
    case 'year': {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      return { from: toISO(d), to };
    }
    default:
      return { from: '', to: '' };
  }
}

function formatDateShort(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

interface DatePeriodPickerProps {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
}

export default function DatePeriodPicker({ dateFrom, dateTo, onChange }: DatePeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const [activePeriod, setActivePeriod] = useState<PeriodKey | null>(null);
  const [customFrom, setCustomFrom] = useState(dateFrom);
  const [customTo, setCustomTo] = useState(dateTo);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  function selectPeriod(key: PeriodKey) {
    setActivePeriod(key);
    if (key !== 'custom') {
      const range = calcRange(key);
      onChange(range.from, range.to);
      setOpen(false);
    }
  }

  function applyCustom() {
    if (customFrom && customTo) {
      onChange(customFrom, customTo);
      setOpen(false);
    }
  }

  function clearFilter() {
    setActivePeriod(null);
    setCustomFrom('');
    setCustomTo('');
    onChange('', '');
    setOpen(false);
  }

  const hasFilter = !!(dateFrom || dateTo);
  const label = activePeriod && activePeriod !== 'custom'
    ? PERIODS.find((p) => p.key === activePeriod)?.label
    : hasFilter
      ? `${formatDateShort(dateFrom)} — ${formatDateShort(dateTo)}`
      : 'Период';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
          hasFilter
            ? 'bg-primary-50 text-primary-700 border border-primary-200'
            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
        }`}
      >
        <Calendar className="h-3.5 w-3.5" />
        <span className="max-w-[120px] truncate">{label}</span>
        {hasFilter ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); clearFilter(); }}
            className="ml-0.5 rounded-full p-0.5 hover:bg-primary-100"
          >
            <X className="h-3 w-3" />
          </button>
        ) : (
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-64 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
          {/* Period presets */}
          <div className="p-2 space-y-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => selectPeriod(p.key)}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                  activePeriod === p.key
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          {activePeriod === 'custom' && (
            <div className="border-t border-gray-100 p-3 space-y-2.5">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">С</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">По</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                />
              </div>
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customFrom || !customTo}
                className="w-full rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-40 transition-colors"
              >
                Применить
              </button>
            </div>
          )}

          {/* Clear */}
          {hasFilter && (
            <div className="border-t border-gray-100 p-2">
              <button
                type="button"
                onClick={clearFilter}
                className="flex w-full items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Сбросить период
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
