import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { IconButton } from '../../ui/IconButton';
import { lockBodyScroll, unlockBodyScroll } from '../../ui/scrollLock';

interface PhotoLightboxProps {
  /** URL фото; null — закрыто. */
  url: string | null;
  alt?: string;
  onClose: () => void;
}

/**
 * Просмотр фото товара/имущества на весь экран. Настоящий диалог: role="dialog",
 * Escape и клик по фону закрывают, фокус уходит на «Закрыть» и возвращается на
 * триггер, прокрутка страницы блокируется. Заменяет перехват правого клика
 * (onContextMenu) и «долгое нажатие» на миниатюре — открывается кнопкой.
 */
export default function PhotoLightbox({ url, alt = '', onClose }: PhotoLightboxProps) {
  const open = !!url;
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  // Свежий onClose без перезапуска эффекта на каждый рендер родителя.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    const t = window.setTimeout(() => closeRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      unlockBodyScroll();
      lastActiveRef.current?.focus?.();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр фото"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.15 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label="Закрыть просмотр"
            className="absolute inset-0 cursor-default bg-ink/85"
            onClick={onClose}
          />
          <IconButton
            ref={closeRef}
            label="Закрыть"
            icon={X}
            size="lg"
            className="absolute right-4 top-4 text-white hover:bg-white/15 hover:text-white focus-visible:ring-white/70"
            onClick={onClose}
          />
          <img
            src={url ?? undefined}
            alt={alt}
            className="relative max-h-[85vh] max-w-full rounded-xl object-contain shadow-pop"
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
