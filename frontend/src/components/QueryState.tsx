import { ReactNode } from 'react';
import { AlertCircle, LucideIcon } from 'lucide-react';
import InlineLoader from './InlineLoader';
import EmptyState from './EmptyState';

interface EmptyConfig {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

interface QueryStateProps {
  /** react-query `isLoading` (or `isPending`). */
  isLoading: boolean;
  /** react-query `isError` — when true we show an error card with a retry button, NOT the empty state. */
  isError?: boolean;
  /** react-query `refetch` — wire this so the error card's «Повторить» works. */
  onRetry?: () => void;
  /** react-query `isFetching` — disables the retry button while a refetch is in flight. */
  isFetching?: boolean;
  /** Whether the successful result is empty (e.g. `!data?.length`). */
  isEmpty?: boolean;
  /** Empty-state config (only used when `isEmpty` is true). */
  empty?: EmptyConfig;
  /** Override the default loader (e.g. a skeleton). */
  loader?: ReactNode;
  errorTitle?: string;
  errorDescription?: string;
  /** Vertical space for loader/error/empty regions (e.g. `min-h-[40vh]`). */
  minHeight?: string;
  children: ReactNode;
}

/**
 * Single source of truth for the loading → error(+retry) → empty → content
 * ladder. The audit's highest-blast-radius defect (T1): ~20 pages destructured
 * only `{ data, isLoading }`, so a network FAILURE fell through to the empty
 * state ("0 clients", "MRR 0₽") or, on settings screens, a blank default form
 * that invites Save-over-real-config. Routing every data view through this
 * component makes a failed fetch always show an explicit, recoverable error.
 */
export default function QueryState({
  isLoading,
  isError,
  onRetry,
  isFetching,
  isEmpty,
  empty,
  loader,
  errorTitle = 'Не удалось загрузить данные',
  errorDescription = 'Проверьте соединение и попробуйте снова.',
  minHeight,
  children,
}: QueryStateProps) {
  if (isLoading) return <>{loader ?? <InlineLoader minHeight={minHeight} />}</>;

  if (isError) {
    return (
      <div className={`flex flex-col items-center justify-center ${minHeight ?? 'py-16'} text-center`} role="alert">
        <span className="mb-4 p-3 bg-red-50 rounded-full">
          <AlertCircle className="w-8 h-8 text-red-500" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-medium text-gray-900 mb-1">{errorTitle}</h3>
        <p className="text-sm text-gray-500 max-w-sm mb-4">{errorDescription}</p>
        {onRetry && (
          <button onClick={() => onRetry()} disabled={isFetching} className="btn-secondary press-soft">
            Повторить
          </button>
        )}
      </div>
    );
  }

  if (isEmpty && empty) return <EmptyState {...empty} />;

  return <>{children}</>;
}
