import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  variant?: 'danger' | 'primary';
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  variant = 'primary',
}: ConfirmDialogProps) {
  function handleConfirm() {
    onConfirm();
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="flex flex-col items-center text-center">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full ${
            variant === 'danger'
              ? 'bg-red-50 text-red-600'
              : 'bg-primary-50 text-primary-600'
          }`}
        >
          <AlertTriangle className="h-6 w-6" />
        </div>

        <p className="mt-4 text-sm text-gray-600 leading-relaxed">{message}</p>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          onClick={onClose}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
