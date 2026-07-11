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
 * chrome. The shared `LoadingSpinner` is a full-viewport route fallback (fake
 * header + fake tab bar, h-screen) and must never be nested in page content —
 * doing so paints a phantom app shell over the real frame. Use InlineLoader
 * for in-page / in-card / in-tab loading instead.
 */
export default function InlineLoader({ label = 'Загрузка…', minHeight = 'py-16', className = '' }: InlineLoaderProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center ${minHeight} text-gray-500 ${className}`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-7 w-7 animate-spin text-primary-600" aria-hidden="true" />
      {label && <span className="mt-3 text-sm">{label}</span>}
    </div>
  );
}
