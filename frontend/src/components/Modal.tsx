import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

// Track how many modals are currently open to avoid premature overflow restore.
// This prevents the white-screen bug where body.overflow stays 'hidden' after
// a modal unmounts during navigation.
let openModalCount = 0;

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
}: ModalProps) {
  const didLock = useRef(false);

  useEffect(() => {
    if (isOpen) {
      openModalCount++;
      didLock.current = true;
      document.body.style.overflow = 'hidden';
    }

    return () => {
      if (didLock.current) {
        didLock.current = false;
        openModalCount = Math.max(0, openModalCount - 1);
        if (openModalCount === 0) {
          document.body.style.overflow = '';
        }
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${sizeClasses[size]} bg-white rounded-t-2xl sm:rounded-xl shadow-xl animate-scale-in max-h-[90dvh] flex flex-col`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-8 overflow-y-auto flex-1 min-h-0" style={{ paddingBottom: `max(2rem, env(safe-area-inset-bottom, 0px))` }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
