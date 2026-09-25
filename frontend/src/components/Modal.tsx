import { ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../ui/cn';
import { IconButton } from '../ui/IconButton';
import { lockBodyScroll, unlockBodyScroll } from '../ui/scrollLock';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
  /** Подзаголовок под названием (контекст: «Чек №128 · Иван Петров»). */
  description?: ReactNode;
  /** Нижняя панель с кнопками; остаётся видимой при прокрутке длинного тела. */
  footer?: ReactNode;
}

const sizeClasses: Record<string, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '4xl': 'sm:max-w-4xl',
};

/**
 * Модальное окно: на десктопе — по центру, на телефоне — шторка снизу.
 * Escape и клик по фону закрывают; фокус уходит в панель и возвращается на
 * триггер; прокрутка страницы блокируется (счётчик — несколько окон
 * одновременно не ломают overflow body). Для деталей/форм, не уводящих со
 * страницы, предпочитайте ui/Drawer.
 */
export default function Modal({ isOpen, onClose, title, children, size = 'md', description, footer }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!isOpen) return;
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    const t = window.setTimeout(() => panelRef.current?.focus(), 20);
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', handleEscape);
      unlockBodyScroll();
      lastActiveRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          // Фон — затемнение + лёгкое размытие; гаснет независимо от панели.
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-[9999] flex items-end justify-center bg-ink/40 backdrop-blur-[2px] sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            // Панель — короткий подъём на телефоне, лёгкий scale на десктопе.
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            className={cn(
              'flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-surface shadow-pop outline-none sm:rounded-xl',
              sizeClasses[size],
            )}
          >
            <div className="flex flex-shrink-0 items-start gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="truncate text-md font-semibold text-ink">
                  {title}
                </h2>
                {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
              </div>
              <IconButton label="Закрыть" icon={X} variant="ghost" onClick={onClose} className="-mr-1.5 -mt-1" />
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4"
              style={{ paddingBottom: footer ? '1.25rem' : 'max(1.5rem, env(safe-area-inset-bottom, 0px))' }}
            >
              {children}
            </div>

            {footer && (
              <div
                className="flex flex-shrink-0 items-center justify-end gap-2 rounded-b-none border-t border-line bg-surface-2 px-5 py-3 sm:rounded-b-xl"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
