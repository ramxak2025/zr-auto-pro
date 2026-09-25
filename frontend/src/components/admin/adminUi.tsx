import { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { format, isPast, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { AlertCircle, type LucideIcon } from 'lucide-react';
import type { Tenant } from '../../types';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { focusRing, toneText, type Tone } from '../../ui/tokens';

/*
 * Строительные блоки WEB-суперадминки поверх примитивов ui/ (фаза B).
 * Здесь только то, чего в системе нет: плитка-ссылка, чип-переключатель,
 * мини-показатель, строка ошибки виджета, бейджи статуса автосервиса и
 * общие форматтеры дат/денег для графиков.
 */

const compactFmt = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

/** «12 тыс. ₽» — подписи оси Y графиков. */
export function compactRub(value: number): string {
  return `${compactFmt.format(value)} ₽`;
}

/** 'YYYY-MM' → 'июн' (подпись под столбцом/точкой). */
export function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return format(new Date(y, m - 1, 1), 'LLL', { locale: ru });
}

/** 'YYYY-MM' → 'июнь 2026' (подсказка). */
export function longMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return format(new Date(y, m - 1, 1), 'LLLL yyyy', { locale: ru });
}

/** ISO → «25 сент. 2026, 14:05»; битая строка возвращается как есть. */
export function formatDateRu(iso: string, pattern = 'd MMM yyyy, HH:mm'): string {
  try {
    return format(parseISO(iso), pattern, { locale: ru });
  } catch {
    return iso;
  }
}

export function isTenantExpired(t: Pick<Tenant, 'subscriptionEnd'>): boolean {
  return !!t.subscriptionEnd && isPast(parseISO(t.subscriptionEnd));
}

/** Плитка-ссылка (быстрые переходы, разделы): настоящая <Link> в виде карточки. */
export function LinkTile({ className, children, ...rest }: LinkProps & { className?: string; children: ReactNode }) {
  return (
    <Link
      className={cn(
        'group block rounded-xl border border-line bg-surface text-left shadow-card',
        'transition-[border-color,box-shadow] duration-150 ease-out hover:border-line-strong hover:shadow-pop',
        focusRing,
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}

/** Чип-переключатель множественного выбора (сегменты рассылки): кнопка с aria-pressed. */
export function ToggleChip({
  active,
  onClick,
  children,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'soft' : 'secondary'}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

/** Маленький показатель: подпись 12 px + значение с табличными цифрами. */
export function MiniStat({
  label,
  value,
  hint,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
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

/** Строка ошибки виджета: не «пусто», а честная ошибка с «Повторить». */
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

/** Статус автосервиса: Активна / Отключена (+ Истекла, когда срок вышел, а флаг ещё активен). */
export function TenantStatusBadges({ tenant, size = 'md' }: { tenant: Tenant; size?: 'sm' | 'md' }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {tenant.isActive ? (
        <Badge tone="ok" dot size={size}>
          Активна
        </Badge>
      ) : (
        <Badge tone="bad" dot size={size}>
          Отключена
        </Badge>
      )}
      {isTenantExpired(tenant) && tenant.isActive && (
        <Badge tone="warn" size={size}>
          Истекла
        </Badge>
      )}
    </span>
  );
}

/** Строка «иконка · значение» в карточке «Информация». */
export function InfoRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 flex-1 text-ink-2 [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}
