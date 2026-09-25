import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { focusRing, toneChip, type Tone } from './tokens';
import { Skeleton } from './Skeleton';

const deltaFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export interface StatDelta {
  /** Изменение в процентах или единицах; знак определяет стрелку. */
  value: number;
  /** Суффикс после числа: '%' (по умолчанию), ' ₽', ' шт.' */
  suffix?: string;
  /** Подпись рядом: «к прошлой неделе». */
  label?: string;
  /** Рост — это плохо (расходы, пропущенные звонки): инвертирует окраску. */
  invert?: boolean;
}

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Строка-пояснение под значением: «за месяц: 128 400 ₽». */
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  delta?: StatDelta;
  loading?: boolean;
  /** Ссылка — вся плитка становится кликабельной (`<Link>`), появляется шеврон. */
  to?: string;
  onClick?: () => void;
  /** Плотный вариант для полос из 4–6 KPI. */
  compact?: boolean;
  className?: string;
}

/**
 * Плитка показателя. Значение — 24/600 (compact: 20) с табличными цифрами,
 * подпись — 13 px ink-3. Один семантический тон на плитку; по умолчанию
 * нейтральный, чтобы полоса из шести KPI не превращалась в светофор.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  delta,
  loading = false,
  to,
  onClick,
  compact = false,
  className,
}: StatCardProps) {
  const interactive = Boolean(to || onClick);
  const deltaUp = delta ? delta.value > 0 : false;
  const deltaGood = delta ? (delta.invert ? !deltaUp : deltaUp) : true;
  const deltaZero = delta ? delta.value === 0 : true;
  const deltaText = delta ? deltaFormat.format(Math.abs(delta.value)) : '';

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn('line-clamp-2 font-medium leading-snug text-ink-3', compact ? 'text-xs' : 'text-sm')}>
          {label}
        </span>
        {Icon && (
          <span
            className={cn(
              'flex flex-shrink-0 items-center justify-center rounded-lg',
              compact ? 'h-7 w-7' : 'h-8 w-8',
              toneChip[tone],
            )}
          >
            <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
          </span>
        )}
      </div>
      <div className={cn('flex flex-wrap items-end gap-x-2 gap-y-1', compact ? 'mt-1' : 'mt-2')}>
        {loading ? (
          <Skeleton className={cn(compact ? 'h-6 w-20' : 'h-7 w-28')} />
        ) : (
          <span
            className={cn(
              'min-w-0 font-semibold tabular-nums leading-none tracking-tight text-ink',
              compact ? 'text-xl' : 'text-2xl',
            )}
          >
            {value}
          </span>
        )}
        {delta && !loading && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
              deltaZero
                ? 'bg-surface-3 text-ink-3'
                : deltaGood
                  ? 'bg-ok-soft text-ok-text'
                  : 'bg-bad-soft text-bad-text',
            )}
            title={delta.label}
          >
            {!deltaZero &&
              (deltaUp ? (
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
              ))}
            {deltaUp ? '+' : delta.value < 0 ? '−' : ''}
            {deltaText}
            {delta.suffix ?? '%'}
          </span>
        )}
      </div>
      {(hint || delta?.label) && (
        <p className={cn('truncate text-ink-3', compact ? 'mt-1 text-2xs' : 'mt-1.5 text-xs')}>
          {hint ?? delta?.label}
        </p>
      )}
      {interactive && (
        <ChevronRight
          className="absolute bottom-4 right-4 h-4 w-4 text-ink-4 transition-transform duration-150 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      )}
    </>
  );

  const baseCls = cn(
    'relative block min-w-0 rounded-xl border border-line bg-surface shadow-card text-left',
    compact ? 'p-4' : 'p-5',
    interactive &&
      cn(
        'group transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-pop',
        focusRing,
      ),
    className,
  );

  if (to) {
    return (
      <Link to={to} className={baseCls}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(baseCls, 'w-full')}>
        {body}
      </button>
    );
  }
  return <div className={baseCls}>{body}</div>;
}

export default StatCard;
