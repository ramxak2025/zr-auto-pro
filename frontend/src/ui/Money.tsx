import { formatMoney } from '../../../shared/utils/formatters';
import { cn } from './cn';

export interface MoneyProps {
  value: number;
  /** Со знаком: положительные с «+», отрицательные с «−» (типографский минус). */
  signed?: boolean;
  /** Окраска по знаку: плюс — ok, минус — bad, ноль — нейтрально. */
  colorize?: boolean;
  /** Приглушённый (второстепенная сумма, «за месяц»). */
  muted?: boolean;
  className?: string;
}

/**
 * Единственный способ показать деньги в админке: shared formatMoney +
 * табличные цифры, чтобы суммы в колонках выравнивались по разрядам.
 * Локальные regex-форматтеры (T9 в аудите) больше не заводим.
 */
export function Money({ value, signed = false, colorize = false, muted = false, className }: MoneyProps) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
  const tone = !colorize || value === 0 ? (muted ? 'text-ink-3' : '') : value > 0 ? 'text-ok-text' : 'text-bad-text';
  return (
    <span className={cn('whitespace-nowrap tabular-nums', tone, className)}>
      {sign}
      {formatMoney(abs)}
    </span>
  );
}

export default Money;
