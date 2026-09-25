import { ReactNode } from 'react';
import { AlertCircle, LucideIcon } from 'lucide-react';
import InlineLoader from './InlineLoader';
import EmptyState from './EmptyState';
import { Button } from '../ui/Button';

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
      <div className={`flex flex-col items-center justify-center ${minHeight ?? 'py-14'} text-center`} role="alert">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-bad-soft">
          <AlertCircle className="h-6 w-6 text-bad" aria-hidden="true" />
        </span>
        <h3 className="text-md font-semibold text-ink">{errorTitle}</h3>
        <p className="mt-1 max-w-sm text-sm text-ink-3">{errorDescription}</p>
        {onRetry && (
          <Button variant="secondary" onClick={() => onRetry()} loading={isFetching} className="mt-4">
            Повторить
          </Button>
        )}
      </div>
    );
  }

  if (isEmpty && empty) return <EmptyState {...empty} />;

  return <>{children}</>;
}
