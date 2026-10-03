import { useEffect, useRef, type RefObject } from 'react';
import { lockBodyScroll, unlockBodyScroll } from './scrollLock';

/** Opening/closing owns focus. A new inline callback during typing must not reopen the dialog. */
export function useDialogFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement>,
): void {
  const latest = useRef({ onClose, initialFocusRef });
  latest.current = { onClose, initialFocusRef };

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      // Respect autoFocus or a click into a field while the opening animation runs.
      if (!panel || panel.contains(document.activeElement)) return;
      (latest.current.initialFocusRef?.current ?? panel).focus();
    }, 20);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') latest.current.onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKey);
      unlockBodyScroll();
      if (previous?.isConnected) previous.focus();
    };
  }, [open, panelRef]);
}
