import { format, startOfWeek, startOfMonth } from 'date-fns';

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

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="label">{'\u0421'}</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onChange(e.target.value, dateTo)}
          className="input"
        />
      </div>
      <div>
        <label className="label">{'\u041f\u043e'}</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onChange(dateFrom, e.target.value)}
          className="input"
        />
      </div>
      <div className="flex items-center gap-2">
        <button onClick={setToday} className="btn-secondary btn-sm">
          Today
        </button>
        <button onClick={setWeek} className="btn-secondary btn-sm">
          Week
        </button>
        <button onClick={setMonth} className="btn-secondary btn-sm">
          Month
        </button>
      </div>
    </div>
  );
}
