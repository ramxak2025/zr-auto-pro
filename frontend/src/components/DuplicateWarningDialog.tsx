import { AlertTriangle, ArrowRight } from 'lucide-react';
import Modal from './Modal';

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
}

/**
 * Warns the user before creating a duplicate (client by phone or car by plate).
 * Offers to open the existing record instead, or create a new one anyway.
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
}: DuplicateWarningDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-700">{description}</p>
          <button
            type="button"
            onClick={onOpenExisting}
            className="mt-3 w-full text-left bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 px-4 py-3 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{existingLabel}</div>
                {existingSubtitle && (
                  <div className="text-xs text-gray-500 truncate">{existingSubtitle}</div>
                )}
              </div>
              <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0 ml-3" />
            </div>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100">
        <button onClick={onClose} className="btn-secondary">
          Отмена
        </button>
        <button onClick={onOpenExisting} className="btn-primary">
          {openExistingLabel}
        </button>
        <button
          onClick={onCreateAnyway}
          className="text-sm text-gray-500 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Всё равно создать
        </button>
      </div>
    </Modal>
  );
}
