import type { CheckWorkStatus } from '../types';

// ─── Kanban work-status visual system (board 082) ────────────────────────────
// Orthogonal to payment state. NULL = not on the board. Shared by WorkBoardPage
// (columns + card footers) and CheckDetailPage (chip + picker) so the colours
// and labels never drift apart.

export const WORK_STATUS_ORDER: CheckWorkStatus[] = ['accepted', 'in_progress', 'ready', 'delivered'];

interface WorkStatusMeta {
  label: string;
  /** Pill classes for the badge. */
  badge: string;
  /** Solid accent dot (column header / badge dot). */
  dot: string;
  /** Soft column header tint. */
  columnHeader: string;
}

export const WORK_STATUS_META: Record<CheckWorkStatus, WorkStatusMeta> = {
  accepted: {
    label: 'Приёмка',
    badge: 'bg-blue-50 text-blue-700',
    dot: 'bg-blue-500',
    columnHeader: 'bg-blue-50/70 text-blue-700',
  },
  in_progress: {
    label: 'В работе',
    badge: 'bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
    columnHeader: 'bg-amber-50/70 text-amber-700',
  },
  ready: {
    label: 'Готов',
    badge: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    columnHeader: 'bg-emerald-50/70 text-emerald-700',
  },
  delivered: {
    label: 'Выдан',
    badge: 'bg-violet-50 text-violet-700',
    dot: 'bg-violet-500',
    columnHeader: 'bg-violet-50/70 text-violet-700',
  },
};

export function workStatusLabel(status: CheckWorkStatus | null | undefined): string {
  return status ? WORK_STATUS_META[status].label : 'Не на доске';
}

/** Coloured pill reflecting the current work status (or «Не на доске» when null). */
export function WorkStatusBadge({
  status,
  className = '',
}: {
  status: CheckWorkStatus | null | undefined;
  className?: string;
}) {
  if (!status) {
    return (
      <span className={`badge bg-gray-100 text-gray-500 gap-1.5 ${className}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        Не на доске
      </span>
    );
  }
  const meta = WORK_STATUS_META[status];
  return (
    <span className={`badge ${meta.badge} gap-1.5 ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/**
 * Native-select work-status picker. A `<select>` is deliberate: it never gets
 * clipped by scroll containers / z-index, is keyboard + screen-reader friendly,
 * and renders the OS picker on mobile. `onChange` only fires for real statuses.
 */
export function WorkStatusPicker({
  value,
  onChange,
  disabled = false,
  className = '',
  placeholder = 'Поставить на доску…',
}: {
  value: CheckWorkStatus | null | undefined;
  onChange: (status: CheckWorkStatus) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value as CheckWorkStatus;
        if (next && next !== value) onChange(next);
      }}
      className={`input py-1.5 text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
      aria-label="Статус работы"
    >
      {!value && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {WORK_STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {WORK_STATUS_META[s].label}
        </option>
      ))}
    </select>
  );
}
