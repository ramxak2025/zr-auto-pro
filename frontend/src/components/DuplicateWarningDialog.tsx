import { AlertTriangle, ArrowRight, Car as CarIcon } from 'lucide-react';
import Modal from './Modal';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { focusRing, toneChip } from '../ui/tokens';

interface DuplicateWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** User confirmed to proceed and create the record anyway. */
  onCreateAnyway: () => void;
  /** User chose to open the existing record instead. */
  onOpenExisting: () => void;
  title: string;
  /** Description: "Клиент с телефоном +7… уже есть" / "Авто с госномером … уже есть". */
  description: string;
  /** Existing record name to show (e.g. client full name). */
  existingLabel: string;
  /** Optional secondary line ("Привязан к клиенту: …"). */
  existingSubtitle?: string;
  /** Label for the "open existing" CTA. */
  openExistingLabel?: string;
  /** Optional list of cars belonging to the existing client (for phone-dup). */
  existingCars?: Array<{ plateNumber: string; makeModel: string }>;
}

/**
 * Предупреждение перед созданием дубля (клиент по телефону / авто по госномеру).
 * Главное действие — открыть существующую запись; «Всё равно создать» —
 * третьестепенное (ghost), чтобы дубль не создавался на автомате.
 */
export default function DuplicateWarningDialog({
  isOpen,
  onClose,
  onCreateAnyway,
  onOpenExisting,
  title,
  description,
  existingLabel,
  existingSubtitle,
  openExistingLabel = 'Открыть существующего',
  existingCars,
}: DuplicateWarningDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCreateAnyway} className="mr-auto">
            Всё равно создать
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={onOpenExisting}>{openExistingLabel}</Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <span className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg', toneChip.warn)}>
          <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <p className="text-sm leading-relaxed text-ink-2">{description}</p>
      </div>

      <button
        type="button"
        onClick={onOpenExisting}
        className={cn(
          'mt-4 w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-left transition-[border-color,background-color] duration-150 hover:border-line-strong hover:bg-surface-3',
          focusRing,
        )}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{existingLabel}</span>
            {existingSubtitle && <span className="block truncate text-xs text-ink-3">{existingSubtitle}</span>}
          </span>
          <ArrowRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
        </span>
        {existingCars && existingCars.length > 0 && (
          <span className="mt-3 block space-y-1.5 border-t border-line pt-3">
            <span className="block text-xs font-medium text-ink-3">Уже привязано:</span>
            {existingCars.slice(0, 5).map((car, i) => (
              <span key={i} className="flex items-center gap-2 text-xs text-ink-2">
                <CarIcon className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-hidden="true" />
                <span className="font-semibold tabular-nums tracking-wide">{car.plateNumber}</span>
                <span className="truncate text-ink-3">{car.makeModel}</span>
              </span>
            ))}
            {existingCars.length > 5 && (
              <span className="block text-xs text-ink-3">… и ещё {existingCars.length - 5}</span>
            )}
          </span>
        )}
      </button>
    </Modal>
  );
}
