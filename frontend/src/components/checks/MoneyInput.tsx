import { useEffect, useRef, useState } from 'react';
import { Input, type InputProps } from '../../ui/Input';

export interface MoneyInputProps extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'inputMode' | 'rightSlot'> {
  /** Текущее число (0 показывается пустым полем с плейсхолдером). */
  value: number;
  /** Каждое валидное значение уходит наверх сразу; на blur поле нормализуется. */
  onCommit: (n: number) => void;
  /** Только целые (пробег, количество чеков). */
  integer?: boolean;
  min?: number;
  max?: number;
  /** Подпись справа внутри поля: «₽», «км». */
  suffix?: string;
}

/** Черновик → число. null — не число (пусто, «1,», «abc»). */
function parseDraft(raw: string, integer: boolean): number | null {
  const s = raw.replace(/\s|\u00a0/g, '').replace(',', '.');
  if (s === '' || s === '.' || s === '-') return null;
  if (!/^\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return integer ? Math.trunc(n) : Math.round(n * 100) / 100;
}

function toDraft(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '';
  return String(value).replace('.', ',');
}

/**
 * Денежное/числовое поле вместо `type="number"` (аудит S7: колесо мыши меняло
 * сумму, точка съедалась). Текст живёт локально: наверх коммитим каждое
 * валидное число с клампом к [min, max], на blur нормализуем отображение;
 * внешние изменения (авто-доводка «карта = итог − нал») синхронизируются, пока
 * поле не в фокусе. Тот же приём, что у QtyInput в Кассе.
 */
export default function MoneyInput({
  value,
  onCommit,
  integer = false,
  min = 0,
  max,
  suffix = '₽',
  className,
  ...rest
}: MoneyInputProps) {
  const [text, setText] = useState(() => toDraft(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(toDraft(value));
  }, [value]);

  const clamp = (n: number) => {
    let v = n;
    if (v < min) v = min;
    if (max !== undefined && v > max) v = max;
    return v;
  };

  return (
    <Input
      {...rest}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={text}
      className={`text-right tabular-nums ${className ?? ''}`}
      rightSlot={suffix ? <span className="text-xs font-medium text-ink-3">{suffix}</span> : undefined}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = parseDraft(raw, integer);
        if (n !== null) {
          const v = clamp(n);
          onCommit(v);
        } else if (raw.trim() === '') {
          onCommit(clamp(0));
        }
      }}
      onFocus={(e) => {
        focusedRef.current = true;
        e.target.select();
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        const n = parseDraft(text, integer);
        if (n === null) {
          setText(toDraft(value));
        } else {
          const v = clamp(n);
          setText(toDraft(v));
          onCommit(v);
        }
        rest.onBlur?.(e);
      }}
    />
  );
}
