import { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { toneText, type Tone } from '../../ui/tokens';

/**
 * Строка ошибки виджета: не «пусто», а честная ошибка с «Повторить»
 * (аудит T1 — ошибка сети выдавалась за отсутствие данных).
 */
export function ErrorRow({
  message,
  onRetry,
  loading = false,
  className,
}: {
  message: string;
  onRetry?: () => void;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-3 rounded-lg border border-bad/20 bg-bad-soft px-3.5 py-3 text-sm text-bad-text',
        className,
      )}
    >
      <AlertCircle className="h-4 w-4 flex-shrink-0 text-bad" aria-hidden="true" />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={loading}>
          Повторить
        </Button>
      )}
    </div>
  );
}

/** Маленький показатель внутри виджета: подпись 12 px + значение с табличными цифрами. */
export function MiniStat({
  label,
  value,
  hint,
  tone = 'neutral',
  size = 'md',
  align = 'left',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md';
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right', align === 'center' && 'text-center', className)}>
      <p className="truncate text-xs text-ink-3">{label}</p>
      <p
        className={cn(
          'mt-0.5 truncate font-semibold tabular-nums tracking-tight',
          size === 'sm' ? 'text-base' : 'text-lg',
          tone === 'neutral' ? 'text-ink' : toneText[tone],
        )}
      >
        {value}
      </p>
      {hint && <p className="truncate text-2xs text-ink-3">{hint}</p>}
    </div>
  );
}

/** 'YYYY-MM-DD' → локальная Date без сдвига пояса (new Date('YYYY-MM-DD') даёт UTC-полночь). */
export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

const compactFmt = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

/** «12,5 тыс. ₽» — для осей и подписей, где полная сумма не помещается. */
export function compactMoney(value: number): string {
  return `${compactFmt.format(value)} ₽`;
}

/** Инициалы из ФИО: «Иванов Пётр Сергеевич» → «ИП». */
export function initialsOf(fullName: string, fallback = '•'): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const s = parts
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return s || fallback;
}
