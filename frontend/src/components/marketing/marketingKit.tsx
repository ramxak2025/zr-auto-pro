import { type ReactNode } from 'react';
import { Star, type LucideIcon } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Card, CardBody, CardHeader } from '../../ui/Card';
import { Skeleton } from '../../ui/Skeleton';
import UiEmptyState from '../EmptyState';
import Switch from '../Switch';
import { cn } from '../../ui/cn';
import { toneSoft, type Tone } from '../../ui/tokens';
import { ErrorRow } from '../dashboard/shared';

// ─── Russian plural helper (shared across marketing views) ──────────
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return forms[1];
  return forms[2];
}

// «N дней назад» / «сегодня» / «ни разу» from an ISO last-visit timestamp.
export function lastVisitLabel(iso: string | null): string {
  if (!iso) return 'ни разу';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return 'сегодня';
  return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`;
}

// ─── Headed section card ────────────────────────────────────────────
// Единая обёртка секций маркетинга поверх ui/Card + CardHeader: иконка-чип в
// семантическом тоне (по смыслу, не по вкусу), заголовок 15/600, подзаголовок,
// правый слот (тумблер / кнопка / бейдж), тело.
export function SectionCard({
  icon,
  iconTone = 'neutral',
  title,
  subtitle,
  right,
  children,
  className,
  bodyPadding = 'md',
  dense = false,
  as = 'h3',
}: {
  icon?: LucideIcon;
  iconTone?: Tone;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** none — когда внутри таблица/список на всю ширину карточки. */
  bodyPadding?: 'none' | 'sm' | 'md';
  dense?: boolean;
  as?: 'h2' | 'h3';
}) {
  return (
    <Card padding="none" className={className}>
      <CardHeader
        icon={icon}
        iconTone={iconTone}
        title={title}
        subtitle={subtitle}
        actions={right}
        dense={dense}
        as={as}
      />
      <CardBody padding={bodyPadding}>{children}</CardBody>
    </Card>
  );
}

// ─── Тумблер ────────────────────────────────────────────────────────
/** Совместимость с прежним API маркетинга: ui-переключатель Switch (role="switch"). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />;
}

// ─── Star rating row ────────────────────────────────────────────────
export function Stars({ rating, size = 'sm', label }: { rating: number; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const cls = size === 'lg' ? 'h-6 w-6' : size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={label ?? `Оценка ${rating} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(cls, i <= rating ? 'fill-warn text-warn' : 'text-line-strong')}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

// ─── Template-variable chips ────────────────────────────────────────
export function VarChips({ vars }: { vars: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Подстановки шаблона">
      {vars.map((v) => (
        <code key={v} className={cn('rounded-md px-2 py-0.5 font-mono text-xs', toneSoft.accent)}>
          {v}
        </code>
      ))}
    </div>
  );
}

// ─── Loading / empty / error primitives ─────────────────────────────
/** Заглушка секции в форме будущего контента (несколько строк), не спиннер. */
export function LoadingBlock({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn('space-y-3 py-2', className)} role="status" aria-label="Загрузка…">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-10', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return <UiEmptyState icon={icon} title={title} description={hint} compact />;
}

/** Ошибка загрузки секции с «Повторить» — ошибка ≠ пусто (аудит S2). */
export function SectionError({
  message,
  onRetry,
  loading,
}: {
  message: string;
  onRetry?: () => void;
  loading?: boolean;
}) {
  return <ErrorRow message={message} onRetry={onRetry} loading={loading} />;
}

// ─── Информационная плашка ──────────────────────────────────────────
/** Короткое пояснение под/над секцией: нейтральное, «ok» (гарантии), «info», «warn». */
export function InfoNote({
  icon: Icon,
  tone = 'neutral',
  children,
  className,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-xs leading-snug', toneSoft[tone], className)}
    >
      {Icon && <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ─── Dirty-state save button ────────────────────────────────────────
/** Появляется только при несохранённых изменениях; прижата вправо, не во всю ширину. */
export function SaveButton({
  onClick,
  disabled,
  saving,
  children = 'Сохранить',
}: {
  onClick: () => void;
  disabled?: boolean;
  saving?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex justify-end">
      <Button type="button" onClick={onClick} disabled={disabled} loading={saving}>
        {children}
      </Button>
    </div>
  );
}
