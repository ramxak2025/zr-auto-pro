import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../../ui/IconButton';
import { lockBodyScroll, unlockBodyScroll } from '../../ui/scrollLock';

interface PhotoLightboxProps {
  /** URL фото; null — закрыто. */
  url: string | null;
  alt?: string;
  onClose: () => void;
  urls?: string[];
  initialIndex?: number;
}

/**
 * Просмотр фото товара/имущества на весь экран. Настоящий диалог: role="dialog",
 * Escape и клик по фону закрывают, фокус уходит на «Закрыть» и возвращается на
 * триггер, прокрутка страницы блокируется. Заменяет перехват правого клика
 * (onContextMenu) и «долгое нажатие» на миниатюре — открывается кнопкой.
 */
export default function PhotoLightbox({ url, alt = '', onClose, urls, initialIndex = 0 }: PhotoLightboxProps) {
  const open = !!url;
  const [index, setIndex] = useState(initialIndex);
  const swipe = useRef<number | null>(null);
  const photos = urls?.length ? urls : url ? [url] : [];
  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);
  const move = (delta: number) => setIndex((current) => Math.max(0, Math.min(photos.length - 1, current + delta)));
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
            src={photos[Math.min(index, photos.length - 1)]}
            alt={alt}
            className="relative max-h-[85vh] max-w-full rounded-xl object-contain shadow-pop"
            onTouchStart={(event) => {
              swipe.current = event.touches[0].clientX;
            }}
            onTouchEnd={(event) => {
              if (swipe.current !== null && Math.abs(event.changedTouches[0].clientX - swipe.current) > 40)
                move(event.changedTouches[0].clientX < swipe.current ? 1 : -1);
              swipe.current = null;
            }}
          />
          {photos.length > 1 && (
            <div className="absolute bottom-6 flex items-center gap-4 rounded-full bg-ink/80 px-3 py-1 text-white">
              <IconButton
                label="Предыдущее фото"
                icon={ChevronLeft}
                disabled={index === 0}
                onClick={() => move(-1)}
                className="text-white"
              />
              <span className="text-sm tabular-nums">
                {index + 1} / {photos.length}
              </span>
              <IconButton
                label="Следующее фото"
                icon={ChevronRight}
                disabled={index >= photos.length - 1}
                onClick={() => move(1)}
                className="text-white"
              />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
