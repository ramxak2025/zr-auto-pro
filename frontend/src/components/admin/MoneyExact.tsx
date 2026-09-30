import { formatMoney } from '../../../../shared/utils/formatters';
import type { Tone } from '../../ui/tokens';
import { cn } from '../../ui/cn';

/*
 * Деньги менеджеров: доля владельца считается до копейки (round(amount × % / 100, 2)),
 * а shared formatMoney округляет до целых рублей. Здесь целая часть форматируется
 * тем же formatMoney (разряды и знак рубля — единые), копейки дописываются, только если они есть.
 */

/** «3 000 ₽», «740,74 ₽», «−1 200 ₽»: копейки показываются только ненулевые. */
export function formatRubExact(value: number): string {
  const kopecks = Math.round(Math.abs(value) * 100);
  const rubles = Math.floor(kopecks / 100);
  const rest = kopecks % 100;
  const sign = value < 0 && kopecks > 0 ? '−' : '';
  const grouped = formatMoney(rubles).replace(/\s?₽$/, '');
  return `${sign}${grouped}${rest ? `,${String(rest).padStart(2, '0')}` : ''} ₽`;
}

/**
 * Подсказка «Из них доля владельца» до ответа сервера: round(amount × % / 100, 2).
 * Источник правды — снимок в платеже (`ownerShareAmount`), это только предпросмотр.
 */
export function previewOwnerShare(amount: number, percent: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(percent)) return 0;
  // toFixed(6) гасит хвост двоичной дроби (301.49999999999994 → 301.5), как numeric в PG.
  return Math.round(Number((amount * percent).toFixed(6))) / 100;
}

/** Баланс менеджера: положительный — менеджер должен владельцу (красным), отрицательный — владелец должен ему. */
export function balanceTone(balance: number): Tone {
  if (balance > 0) return 'bad';
  if (balance < 0) return 'ok';
  return 'neutral';
}

export function balanceTextClass(balance: number): string {
  if (balance > 0) return 'text-bad-text';
  if (balance < 0) return 'text-ok-text';
  return 'text-ink';
}

/** Подпись под балансом: что он значит для того, кто на него смотрит. */
export function balanceCaption(balance: number, viewer: 'owner' | 'manager'): string {
  if (balance > 0) return viewer === 'owner' ? 'Менеджер должен владельцу' : 'Вы должны владельцу';
  if (balance < 0) return viewer === 'owner' ? 'Владелец должен менеджеру' : 'Владелец должен вам';
  return 'Расчёты закрыты';
}

export interface MoneyExactProps {
  value: number;
  /** Со знаком: положительные с «+», отрицательные с «−». */
  signed?: boolean;
  className?: string;
}

/** Рубли с копейками и табличными цифрами; цвет задаёт вызывающий (у баланса смысл знака обратный). */
export function MoneyExact({ value, signed = false, className }: MoneyExactProps) {
  const text = formatRubExact(value);
  const shown = signed && value > 0 ? `+${text}` : text;
  return <span className={cn('whitespace-nowrap tabular-nums', className)}>{shown}</span>;
}

export default MoneyExact;
