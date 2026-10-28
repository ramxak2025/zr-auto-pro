import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';

/** Local Journal-pattern menu; pending existing dialogs open only after its focus trap exits. */
export default function WarehousePopover({
  open,
  onClose,
  anchor,
  labelledBy,
  children,
  onExited,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLButtonElement>;
  labelledBy: string;
  children: ReactNode;
  onExited: () => void;
}) {
  const [present, setPresent] = useState(open);
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline>();
  const isOpen = useRef(open);
  const close = useRef(onClose);
  const exited = useRef(onExited);
  exited.current = onExited;
  isOpen.current = open;
  close.current = onClose;
  useLayoutEffect(() => {
    if (open) setPresent(true);
  }, [open]);

  useLayoutEffect(() => {
    if (!present || !surface.current) return;
    const node = surface.current;
    const media = gsap.matchMedia();
    const position = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportTop = viewport?.offsetTop ?? 0;
      const width = Math.min(320, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
      const top = Math.min(rect.bottom + 12, viewportTop + viewportHeight - 160);
      node.style.width = `${width}px`;
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.maxHeight = `${Math.max(140, viewportTop + viewportHeight - top - 12)}px`;
      node.style.transformOrigin = `${Math.min(width - 24, Math.max(24, rect.left + rect.width / 2 - left))}px 0px`;
    };
    position();
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    media.add(
      { reduced: '(prefers-reduced-motion: reduce)', regular: '(prefers-reduced-motion: no-preference)' },
      (context) => {
        const reduced = Boolean(context.conditions?.reduced);
        const duration = reduced ? 0 : 0.19;
        const motion = gsap
          .timeline({
            paused: true,
            onReverseComplete: () => {
              if (!isOpen.current) setPresent(false);
            },
          })
          .fromTo(
            root.current?.querySelector('[data-journal-scrim]') ?? [],
            { opacity: 0 },
            { opacity: 1, duration: reduced ? 0 : 0.18 },
            0,
          )
          .fromTo(
            node,
            { opacity: 0, y: reduced ? 0 : -12, scale: reduced ? 1 : 0.96 },
            { opacity: 1, y: 0, scale: 1, duration, ease: 'power3.out' },
            0,
          )
          .fromTo(
            node.querySelector('.journal-popover-content'),
            { opacity: 0, y: reduced ? 0 : 5, filter: reduced ? 'none' : 'blur(2px)' },
            { opacity: 1, y: 0, filter: 'blur(0px)', duration: duration * 0.84, ease: 'power3.out' },
            duration * 0.12,
          );
        timeline.current = motion;
        if (isOpen.current) motion.play();
        // A media reset can recreate a closed timeline at its initial endpoint.
        // There is no reverse crossing left to complete in that case.
        else setPresent(false);
        return () => {
          timeline.current = undefined;
        };
      },
      root,
    );
    return () => {
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      media.revert();
    };
  }, [present, anchor]);

  useLayoutEffect(() => {
    if (!present) return;
    const motion = timeline.current;
    if (open) motion?.timeScale(1).play();
    else if (motion && motion.duration() > 0 && motion.progress() > 0) motion.timeScale(1.25).reverse();
    else {
      // Escape may arrive before the first opening tick. Reversing from zero
      // cannot fire onReverseComplete, so finish that already-closed endpoint.
      motion?.pause().progress(0, true);
      setPresent(false);
    }
  }, [open, present]);

  useEffect(() => {
    if (!present) return;
    const previous = anchor.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const node = surface.current;
    const inAnotherDialog = (target: EventTarget | null) => {
      if (!(target instanceof Element) || node?.contains(target)) return false;
      const dialog = target.closest<HTMLElement>('dialog[open], [role="dialog"], [role="alertdialog"]');
      return Boolean(
        dialog?.isConnected &&
        dialog.getClientRects().length > 0 &&
        dialog.getAttribute('aria-hidden') !== 'true' &&
        getComputedStyle(dialog).visibility !== 'hidden',
      );
    };
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).filter(
        (item) =>
          item.getClientRects().length > 0 &&
          getComputedStyle(item).visibility !== 'hidden' &&
          !item.closest('[inert]'),
      );
    const focusFirst = () => {
      // A synchronous file chooser can open its preview before our exit ends.
      // Only a closing menu yields to that real, visible successor dialog.
      if (!isOpen.current && inAnotherDialog(document.activeElement)) return;
      (focusables()[0] ?? node)?.focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(focusFirst);
    const keydown = (event: KeyboardEvent) => {
      if (!isOpen.current && inAnotherDialog(document.activeElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        node?.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (!isOpen.current && inAnotherDialog(event.target)) return;
      if (event.target instanceof Node && !node?.contains(event.target)) focusFirst();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', containFocus);
      const handedOff = !isOpen.current && inAnotherDialog(document.activeElement);
      if (previous?.isConnected && !handedOff) previous.focus({ preventScroll: true });
    };
  }, [present, anchor]);

  useEffect(() => {
    if (!present && !isOpen.current) exited.current();
  }, [present]);

  if (!present) return null;
  return createPortal(
    <div ref={root} className="journal-overlay journal-overlay--sections warehouse-overlay" data-journal-open={open}>
      <div data-journal-scrim className="journal-scrim" onMouseDown={() => close.current()} aria-hidden="true" />
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="journal-popover warehouse-popover"
      >
        <div className="journal-popover-content">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
