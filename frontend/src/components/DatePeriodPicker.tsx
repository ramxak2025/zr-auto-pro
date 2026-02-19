import { useState } from 'react';
import { format, startOfWeek, startOfMonth } from 'date-fns';
import { CalendarDays } from 'lucide-react';

interface DatePeriodPickerProps {
  dateFrom: string;
  dateTo: string;
  onChange: (from: string, to: string) => void;
}

export default function DatePeriodPicker({
  dateFrom,
  dateTo,
  onChange,
}: DatePeriodPickerProps) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [expanded, setExpanded] = useState(false);

  const setToday = () => {
    onChange(today, today);
  };

  const setWeek = () => {
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    onChange(weekStart, today);
  };

  const setMonth = () => {
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    onChange(monthStart, today);
  };

  const getLabel = () => {
    if (!dateFrom && !dateTo) return 'Дата';
    if (dateFrom === dateTo && dateFrom === today) return 'Сегодня';
    if (dateFrom && dateTo) {
      const f = dateFrom.slice(5).replace('-', '.');
      const t = dateTo.slice(5).replace('-', '.');
      return `${f} — ${t}`;
    }
    return 'Дата';
  };

  return (
    <div className="relative">
      {/* Mobile: compact button */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="md:hidden flex items-center gap-2 px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <CalendarDays className="h-4 w-4 text-gray-400" />
        <span>{getLabel()}</span>
      </button>

      {/* Mobile expanded dropdown */}
      {expanded && (
        <div className="md:hidden absolute top-full left-0 right-0 mt-2 p-3 bg-white rounded-xl border border-gray-200 shadow-lg z-30 min-w-[280px]">
          <div className="flex gap-2 mb-3">
            <button onClick={() => { setToday(); setExpanded(false); }} className="flex-1 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Сегодня</button>
            <button onClick={() => { setWeek(); setExpanded(false); }} className="flex-1 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Неделя</button>
            <button onClick={() => { setMonth(); setExpanded(false); }} className="flex-1 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Месяц</button>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 uppercase">С</label>
              <input type="date" value={dateFrom} onChange={(e) => onChange(e.target.value, dateTo)} className="input text-sm" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 uppercase">По</label>
              <input type="date" value={dateTo} onChange={(e) => onChange(dateFrom, e.target.value)} className="input text-sm" />
            </div>
          </div>
          <button onClick={() => setExpanded(false)} className="w-full mt-3 py-2 text-xs font-medium text-primary-600 bg-primary-50 rounded-lg">Применить</button>
        </div>
      )}

      {/* Desktop: inline */}
      <div className="hidden md:flex flex-wrap items-end gap-3">
        <div>
          <label className="label">С</label>
          <input type="date" value={dateFrom} onChange={(e) => onChange(e.target.value, dateTo)} className="input" />
        </div>
        <div>
          <label className="label">По</label>
          <input type="date" value={dateTo} onChange={(e) => onChange(dateFrom, e.target.value)} className="input" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={setToday} className="btn-secondary btn-sm">Сегодня</button>
          <button onClick={setWeek} className="btn-secondary btn-sm">Неделя</button>
          <button onClick={setMonth} className="btn-secondary btn-sm">Месяц</button>
        </div>
      </div>
    </div>
  );
}
