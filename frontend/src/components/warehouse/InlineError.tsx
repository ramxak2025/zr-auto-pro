import { AlertCircle } from 'lucide-react';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';

/**
 * Строка ошибки внутри страницы: не «пусто», а честная ошибка с «Повторить».
 * Для случаев, когда содержимое остаётся на экране (например, показываем
 * прежние данные склада, а фоновое обновление упало).
 */
export default function InlineError({
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
