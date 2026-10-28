import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';

/** Journal-owned overlay: its source, presence, motion and focus share one lifetime. */
export default function JournalPopover({
  open,
  onClose,
  anchor,
  labelledBy,
  children,
  kind = 'filters',
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLButtonElement>;
  labelledBy: string;
  children: ReactNode;
  kind?: 'filters' | 'sections';
}) {
  const [present, setPresent] = useState(open);
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline>();
  const isOpen = useRef(open);
  const close = useRef(onClose);
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
      const narrow = window.innerWidth < 640;
      if (narrow && kind === 'filters') {
        node.style.removeProperty('top');
        node.style.left = '12px';
        node.style.bottom = `max(12px, env(safe-area-inset-bottom))`;
        node.style.width = `${window.innerWidth - 24}px`;
        node.style.maxHeight = `${viewportHeight - 24}px`;
        node.style.transformOrigin = '50% 100%';
      } else {
        const width = Math.min(kind === 'filters' ? 380 : 240, window.innerWidth - 24);
        const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
        const top = Math.min(rect.bottom + 12, viewportTop + viewportHeight - 160);
        node.style.width = `${width}px`;
        node.style.left = `${left}px`;
        node.style.top = `${top}px`;
        node.style.bottom = 'auto';
        node.style.maxHeight = `${Math.max(140, viewportTop + viewportHeight - top - 12)}px`;
        node.style.transformOrigin = `${Math.min(width - 24, Math.max(24, rect.left + rect.width / 2 - left))}px 0px`;
      }
    };
    position();
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    media.add(
      { reduced: '(prefers-reduced-motion: reduce)', narrow: '(max-width: 639px)', wide: '(min-width: 640px)' },
      (context) => {
        const reduced = Boolean(context.conditions?.reduced);
        const sheet = Boolean(context.conditions?.narrow) && kind === 'filters';
        const duration = reduced ? 0 : kind === 'filters' ? 0.24 : 0.19;
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
            { opacity: 0, y: reduced ? 0 : sheet ? 28 : -12, scale: reduced || sheet ? 1 : 0.96 },
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
  }, [present, anchor, kind]);

  useLayoutEffect(() => {
    if (!present) return;
    if (open) timeline.current?.timeScale(1).play();
    else if (timeline.current?.duration()) timeline.current.timeScale(kind === 'filters' ? 1.4 : 1.25).reverse();
    else setPresent(false);
  }, [open, present, kind]);

  useEffect(() => {
    if (!present) return;
    const previous = anchor.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const node = surface.current;
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
    const focusFirst = () => (focusables()[0] ?? node)?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(focusFirst);
    const keydown = (event: KeyboardEvent) => {
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
      if (event.target instanceof Node && !node?.contains(event.target)) focusFirst();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', containFocus);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [present, anchor]);

  if (!present) return null;
  return createPortal(
    <div ref={root} className={`journal-overlay journal-overlay--${kind}`} data-journal-open={open}>
      <div data-journal-scrim className="journal-scrim" onMouseDown={() => close.current()} aria-hidden="true" />
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="journal-popover"
      >
        {kind === 'filters' && <span className="journal-sheet-grabber" aria-hidden="true" />}
        <div className="journal-popover-content">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
