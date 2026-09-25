import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../ui/cn';
import { IconButton } from '../../ui/IconButton';
import { focusRing } from '../../ui/tokens';
import { monthIndex, monthOfDay, monthRange, monthTitle, periodMonth, shiftMonth } from './periodParams';

interface MonthPagerProps {
  from: string;
  to: string;
  /** Сегодня по календарю автосервиса ('YYYY-MM-DD') — вперёд дальше текущего месяца не листаем. */
  todayKey: string;
  onChange: (from: string, to: string) => void;
  /** Глубина назад в месяцах (по умолчанию 24). */
  depthMonths?: number;
  className?: string;
}

/**
 * «← Сентябрь 2026 →» — календарный месяц целиком. Основной сценарий
 * владельца в деньгах и отчётах («отчёт за август»): период-месяц нужен
 * полным, потому что расходы «за месяц» сервер включает только когда диапазон
 * покрывает месяц целиком. Живёт рядом с DatePeriodPicker в одном Toolbar,
 * одной высоты (36 px): пейджер — месяцы, пикер — пресеты и произвольный
 * диапазон. Подсветка активна, только когда период — ровно календарный месяц.
 */
export default function MonthPager({ from, to, todayKey, onChange, depthMonths = 24, className }: MonthPagerProps) {
  const current = monthOfDay(todayKey);
  const active = periodMonth({ from, to });
  const base = active ?? current;
  const nowIdx = monthIndex(current);
  const canPrev = monthIndex(base) > nowIdx - depthMonths;
  const canNext = active !== null && monthIndex(active) < nowIdx;

  const apply = (m: { year: number; month0: number }) => {
    const idx = monthIndex(m);
    if (idx > nowIdx || idx < nowIdx - depthMonths) return;
    const r = monthRange(m);
    onChange(r.from, r.to);
  };

  return (
    <div
      role="group"
      aria-label="Календарный месяц"
      className={cn(
        'inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface p-0.5 shadow-sm',
        className,
      )}
    >
      <IconButton
        label="Предыдущий месяц"
        icon={ChevronLeft}
        size="sm"
        variant="ghost"
        disabled={!canPrev}
        onClick={() => apply(shiftMonth(base, -1))}
      />
      <button
        type="button"
        onClick={() => apply(current)}
        aria-pressed={active !== null}
        title={active ? 'К текущему месяцу' : 'Показать месяц целиком'}
        className={cn(
          'h-full min-w-[7.5rem] whitespace-nowrap rounded-md px-2 text-sm font-medium tabular-nums transition-colors duration-150',
          focusRing,
          active ? 'text-ink' : 'text-ink-3 hover:text-ink',
        )}
      >
        {monthTitle(base)}
      </button>
      <IconButton
        label="Следующий месяц"
        icon={ChevronRight}
        size="sm"
        variant="ghost"
        disabled={!canNext}
        onClick={() => active && apply(shiftMonth(active, 1))}
      />
    </div>
  );
}
