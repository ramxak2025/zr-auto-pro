import { type ReactNode } from 'react';
import { Loader2, Star, type LucideIcon } from 'lucide-react';

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
// A single, consistent card chrome for every marketing sub-section:
// icon chip + title + optional subtitle + optional right-slot, then body.
export function SectionCard({
  icon: Icon,
  iconClass = 'bg-primary-50 text-primary-600',
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  icon?: LucideIcon;
  iconClass?: string;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <header className="flex items-center gap-2.5 px-4 sm:px-5 pt-4 pb-3">
        {Icon && (
          <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight text-gray-900">{title}</h3>
          {subtitle != null && <p className="text-xs text-gray-500 leading-snug">{subtitle}</p>}
        </div>
        {right != null && <div className="ml-auto flex-shrink-0">{right}</div>}
      </header>
      <div className="px-4 sm:px-5 pb-4 sm:pb-5">{children}</div>
    </section>
  );
}

// ─── iOS-style switch ───────────────────────────────────────────────
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-primary-600' : 'bg-gray-200'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  );
}

// ─── Star rating row ────────────────────────────────────────────────
export function Stars({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-6 w-6' : size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`${cls} ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />
      ))}
    </div>
  );
}

// ─── Template-variable chips ────────────────────────────────────────
export function VarChips({ vars }: { vars: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {vars.map((v) => (
        <span key={v} className="rounded-full bg-primary-50 px-2 py-0.5 font-mono text-xs text-primary-600">
          {v}
        </span>
      ))}
    </div>
  );
}

// ─── Loading / empty primitives ─────────────────────────────────────
export function LoadingBlock({ className = 'py-12' }: { className?: string }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="py-10 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-gray-200" />
      <p className="text-sm font-medium text-gray-500">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

// ─── Dirty-state save button (full width, primary) ──────────────────
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
    <button type="button" onClick={onClick} disabled={disabled || saving} className="btn-primary w-full">
      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
