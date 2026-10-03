import { ReactNode, RefObject, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from './cn';
import { IconButton } from './IconButton';
import { useDialogFocus } from './useDialogFocus';

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Нижняя панель с кнопками (Отмена / Сохранить). */
  footer?: ReactNode;
  size?: DrawerSize;
  /** Куда поставить фокус при открытии (первое поле формы); по умолчанию — панель. */
  initialFocusRef?: RefObject<HTMLElement>;
  className?: string;
}

const widths: Record<DrawerSize, string> = {
  sm: 'sm:max-w-[360px]',
  md: 'sm:max-w-[480px]',
  lg: 'sm:max-w-[640px]',
  xl: 'sm:max-w-[820px]',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Боковая панель деталей (карточка клиента из списка, фильтры, быстрое
 * редактирование) — не уводит с текущей страницы, в отличие от Modal.
 * Справа на десктопе, во всю ширину на телефоне; 180 мс, reduced-motion → без
 * сдвига; Escape/клик по фону закрывают; фокус — внутрь и обратно на триггер.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  initialFocusRef,
  className,
}: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  useDialogFocus(open, panelRef, onClose, initialFocusRef);

  // Минимальная ловушка фокуса: Tab с последнего элемента — на первый и наоборот.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex justify-end">
          <motion.button
            type="button"
            aria-label="Закрыть панель"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="absolute inset-0 cursor-default bg-ink/40"
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            initial={reduced ? { opacity: 0 } : { x: '100%' }}
            animate={reduced ? { opacity: 1 } : { x: 0 }}
            exit={reduced ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            className={cn(
              'relative flex h-full w-full flex-col bg-surface shadow-drawer outline-none',
              widths[size],
              className,
            )}
          >
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="truncate text-md font-semibold text-ink">
                  {title}
                </h2>
                {subtitle && <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p>}
              </div>
              <IconButton label="Закрыть" icon={X} onClick={onClose} className="-mr-1.5 -mt-1" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
            {footer && (
              <div
                className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default Drawer;
