import type { WorkBoardColumn } from '../types';

// ─── Owner-configurable kanban work-status visual system (board 091) ─────────
// Columns are now tenant-defined (label + hex color), so colours/labels live on
// the WorkBoardColumn rows instead of a hard-coded enum. Orthogonal to payment.
// NULL workStatus = «не на доске». Shared by WorkBoardPage (columns + cards) and
// CheckDetailPage (chip + picker) so the visuals never drift apart.

/** gray-500 — fallback accent when a column has no (valid) color. */
const NEUTRAL = '#6B7280';

/** Resolve the column a check currently sits in (matched by key), or null. */
export function resolveColumn(
  workStatus: string | null | undefined,
  columns: WorkBoardColumn[] | undefined,
): WorkBoardColumn | null {
  if (!workStatus || !columns) return null;
  return columns.find((c) => c.key === workStatus) ?? null;
}

/** #RRGGBB (or #RGB) → rgba() with the given alpha. Falls back to neutral. */
function hexToRgba(hex: string | null | undefined, alpha: number): string {
  let h = (hex ?? NEUTRAL).trim().replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) h = NEUTRAL.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Soft pill styles in a column's accent color (badge / column header). */
export function columnBadgeStyle(color: string | null | undefined) {
  return { backgroundColor: hexToRgba(color, 0.12), color: color ?? NEUTRAL };
}

/** Solid accent dot in a column's color. */
export function columnDotStyle(color: string | null | undefined) {
  return { backgroundColor: color ?? NEUTRAL };
}

/**
 * Coloured pill reflecting a check's current board column. Shows «Не на доске»
 * when off-board, and a neutral pill with the raw key when the column is unknown
 * (deleted / de-activated / columns not yet loaded).
 */
export function WorkStatusBadge({
  column,
  workStatus,
  className = '',
}: {
  column: WorkBoardColumn | null | undefined;
  workStatus: string | null | undefined;
  className?: string;
}) {
  if (!workStatus) {
    return (
      <span className={`badge bg-gray-100 text-gray-500 gap-1.5 ${className}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        Не на доске
      </span>
    );
  }
  if (!column) {
    return (
      <span className={`badge bg-gray-100 text-gray-600 gap-1.5 ${className}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        {workStatus}
      </span>
    );
  }
  return (
    <span className={`badge gap-1.5 ${className}`} style={columnBadgeStyle(column.color)}>
      <span className="h-1.5 w-1.5 rounded-full" style={columnDotStyle(column.color)} />
      {column.label}
    </span>
  );
}

/**
 * Native-select work-status picker driven by the tenant's active board columns.
 * A `<select>` is deliberate: it never gets clipped by scroll containers /
 * z-index, is keyboard + screen-reader friendly, and renders the OS picker on
 * mobile. `onChange` only fires for a real column key different from the current
 * one. A current value pointing at a now-inactive column is kept selectable as a
 * read-only option so the picker is never silently blanked.
 */
export function WorkStatusPicker({
  value,
  columns,
  onChange,
  disabled = false,
  className = '',
  placeholder = 'Поставить на доску…',
}: {
  value: string | null | undefined;
  columns: WorkBoardColumn[];
  onChange: (key: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const known = value ? columns.some((c) => c.key === value) : true;
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
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
      {value && !known && (
        <option value={value} disabled>
          {value}
        </option>
      )}
      {columns.map((c) => (
        <option key={c.id} value={c.key}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
