import { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/*
 * Общие строительные блоки WEB-суперадминки (внутренний инструмент владельца
 * платформы). Стиль — «data-dense dashboard»: плотные плитки, единый заголовок
 * страницы, чипы-фильтры и сегментные переключатели, переиспользуемые всеми
 * страницами /admin/*. Только Tailwind-утилиты существующей темы.
 */

// ── Заголовок страницы ────────────────────────────────────────────────────────

export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── KPI-плитка ────────────────────────────────────────────────────────────────

export type StatTone = 'blue' | 'green' | 'red' | 'emerald' | 'teal' | 'indigo' | 'purple' | 'amber';

// Полные строки классов (не шаблоны) — иначе Tailwind JIT их не увидит.
const STAT_TONES: Record<StatTone, { bg: string; text: string }> = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
  green: { bg: 'bg-green-50', text: 'text-green-600' },
  red: { bg: 'bg-red-50', text: 'text-red-600' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
};

export function StatTile({
  icon: Icon,
  tone = 'blue',
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  tone?: StatTone;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  const t = STAT_TONES[tone];
  return (
    <div className="card flex items-start gap-3 p-4">
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${t.bg}`}>
        <Icon className={`h-[18px] w-[18px] ${t.text}`} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-gray-500">{label}</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums leading-tight text-gray-900">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

// ── Чип-фильтр ────────────────────────────────────────────────────────────────

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press-soft cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

// ── Сегментный переключатель ─────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === o.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
