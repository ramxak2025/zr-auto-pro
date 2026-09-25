import { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { AlertCircle, FileText, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';

/*
 * Локальные строительные блоки базы знаний поверх примитивов ui/ (фаза B).
 * Здесь только то, чего в системе нет: плитка-ссылка, заголовок секции,
 * строка ошибки виджета, бейдж типа материала, полоса прогресса курса.
 */

/**
 * Плитка-ссылка (папка, статья, курс): настоящая `<Link>` — Cmd+клик, средняя
 * кнопка и Tab работают; вид — карточка системы с hover-подъёмом.
 */
export function TileLink({ className, children, ...rest }: LinkProps & { className?: string; children: ReactNode }) {
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

/** Заголовок секции витрины («Папки», «Закреплённые», «Материалы») с необязательным действием справа. */
export function SectionHeading({
  icon: Icon,
  title,
  count,
  actions,
  as: Heading = 'h2',
}: {
  icon?: LucideIcon;
  title: string;
  count?: number;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="mb-2.5 flex min-h-[32px] items-center justify-between gap-3">
      <Heading className="flex items-center gap-1.5 text-sm font-semibold text-ink-2">
        {Icon && <Icon className="h-4 w-4 text-ink-3" aria-hidden="true" />}
        {title}
        {typeof count === 'number' && <span className="font-normal tabular-nums text-ink-3">{count}</span>}
      </Heading>
      {actions}
    </div>
  );
}

/** Ошибка вторичного запроса: не «пусто», а честная ошибка с «Повторить». */
export function InlineError({
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

/** «Статья» / «Регламент» — тип материала. Регламент требует ознакомления → warn. */
export function ArticleTypeBadge({ regulation, size = 'md' }: { regulation: boolean; size?: 'sm' | 'md' }) {
  return regulation ? (
    <Badge tone="warn" icon={ShieldCheck} size={size}>
      Регламент
    </Badge>
  ) : (
    <Badge tone="accent" icon={FileText} size={size}>
      Статья
    </Badge>
  );
}

/** Полоса прогресса курса: accent в процессе, ok — когда пройден. */
export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label ?? 'Прогресс'}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', clamped >= 100 ? 'bg-ok' : 'bg-accent')}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Заглушка обложки курса/статьи без картинки. */
export function CoverPlaceholder({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center bg-surface-2 text-ink-4', className)} aria-hidden="true">
      <Icon className="h-8 w-8" strokeWidth={1.5} />
    </div>
  );
}
