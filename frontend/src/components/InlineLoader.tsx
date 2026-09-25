import { Loader2 } from 'lucide-react';

interface InlineLoaderProps {
  /** Optional caption under the spinner. */
  label?: string;
  /** Vertical space wrapper — defaults to `py-16`; pass e.g. `min-h-[40vh]` for a taller region. */
  minHeight?: string;
  className?: string;
}

/**
 * Content-sized loading indicator for use INSIDE a page that already has its
 * chrome. The shared `LoadingSpinner` is a full-viewport route fallback and
 * must never be nested in page content. Prefer a Skeleton that repeats the
 * shape of the future content; InlineLoader — when the shape is unknown.
 */
export default function InlineLoader({ label = 'Загрузка…', minHeight = 'py-16', className = '' }: InlineLoaderProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center ${minHeight} text-ink-3 ${className}`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
      {label && <span className="mt-3 text-sm">{label}</span>}
    </div>
  );
}
