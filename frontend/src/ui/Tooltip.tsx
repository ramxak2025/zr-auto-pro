import {
  Children,
  ReactElement,
  ReactNode,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

export interface TooltipProps {
  content: ReactNode;
  side?: TooltipSide;
  /** Задержка появления, мс (для наведения; по фокусу — сразу). */
  delay?: number;
  disabled?: boolean;
  className?: string;
  /** Ровно один элемент, принимающий onMouseEnter/onFocus (кнопка, ссылка, span). */
  children: ReactElement;
}

const GAP = 8;

interface Pos {
  left: number;
  top: number;
}

function computePosition(rect: DOMRect, tip: { width: number; height: number }, side: TooltipSide): Pos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left: number;
  let top: number;
  switch (side) {
    case 'right':
      left = rect.right + GAP;
      top = rect.top + rect.height / 2 - tip.height / 2;
      break;
    case 'left':
      left = rect.left - GAP - tip.width;
      top = rect.top + rect.height / 2 - tip.height / 2;
      break;
    case 'bottom':
      left = rect.left + rect.width / 2 - tip.width / 2;
      top = rect.bottom + GAP;
      break;
    default:
      left = rect.left + rect.width / 2 - tip.width / 2;
      top = rect.top - GAP - tip.height;
  }
  left = Math.max(GAP, Math.min(left, vw - tip.width - GAP));
  top = Math.max(GAP, Math.min(top, vh - tip.height - GAP));
  return { left, top };
}

/**
 * Подсказка: портал, позиция от getBoundingClientRect (читается в обработчике,
 * не в рендере), показывается по наведению и по фокусу, скрывается по Escape и
 * прокрутке. Связывается с элементом через aria-describedby. Не кладите в
 * подсказку ничего, что нельзя узнать иначе: на тач-устройствах наведения нет.
 */
export function Tooltip({ content, side = 'top', delay = 300, disabled = false, className, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = useCallback(
    (el: HTMLElement, immediate: boolean) => {
      anchorRef.current = el;
      clear();
      const doShow = () => setOpen(true);
      if (immediate) doShow();
      else timerRef.current = setTimeout(doShow, delay);
    },
    [delay],
  );

  const hide = useCallback(() => {
    clear();
    setOpen(false);
  }, []);

  // Позиция считается ПОСЛЕ монтирования подсказки — нужен её реальный размер.
  useEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    setPos(computePosition(rect, { width: tip.width, height: tip.height }, side));
  }, [open, side, content]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    const onScroll = () => hide();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, hide]);

  useEffect(() => clear, []);

  const child = Children.only(children);
  if (!isValidElement(child) || disabled) return child;

  type AnyHandlers = {
    onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
    onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
    onFocus?: (e: FocusEvent<HTMLElement>) => void;
    onBlur?: (e: FocusEvent<HTMLElement>) => void;
    'aria-describedby'?: string;
  };
  const props = child.props as AnyHandlers;

  const cloned = cloneElement(child as ReactElement<AnyHandlers>, {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      props.onMouseEnter?.(e);
      show(e.currentTarget, false);
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      props.onFocus?.(e);
      show(e.currentTarget, true);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      props.onBlur?.(e);
      hide();
    },
    'aria-describedby': open ? [props['aria-describedby'], id].filter(Boolean).join(' ') : props['aria-describedby'],
  });

  return (
    <>
      {cloned}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
            className={cn(
              'pointer-events-none fixed z-[10000] max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-pop',
              pos && 'motion-safe:animate-tip-in',
              className,
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

export default Tooltip;
