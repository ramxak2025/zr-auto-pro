import {
  ReactElement,
  ReactNode,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

export type MenuEntry =
  | {
      type?: 'item';
      key: string;
      label: ReactNode;
      description?: ReactNode;
      icon?: LucideIcon;
      onSelect?: () => void;
      /** Пункт-ссылка (Cmd/Ctrl+клик, средняя кнопка работают как у обычной ссылки). */
      to?: string;
      danger?: boolean;
      disabled?: boolean;
      /** Подсказка о горячей клавише справа. */
      shortcut?: string;
    }
  | { type: 'separator'; key: string }
  | { type: 'label'; key: string; label: ReactNode };

export interface DropdownMenuProps {
  /** Элемент-триггер; получает onClick, aria-haspopup, aria-expanded (IconButton/Button подходят). */
  trigger: ReactElement;
  items: MenuEntry[];
  align?: 'start' | 'end';
  /** Ширина меню, px (по умолчанию 224). */
  width?: number;
  'aria-label'?: string;
  className?: string;
}

const GAP = 6;

/**
 * Выпадающее меню действий (профиль в шапке, «⋯» в строке таблицы).
 * Портал + позиция от триггера; стрелки/Home/End/Escape; клик вне закрывает;
 * фокус возвращается на триггер.
 */
export function DropdownMenu({
  trigger,
  items,
  align = 'end',
  width = 224,
  'aria-label': ariaLabel,
  className,
}: DropdownMenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const el = triggerRef.current;
    const menu = menuRef.current;
    if (!el || !menu) return;
    const rect = el.getBoundingClientRect();
    const mh = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = align === 'end' ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(left, vw - width - 8));
    let top = rect.bottom + GAP;
    if (top + mh > vh - 8 && rect.top - GAP - mh > 8) top = rect.top - GAP - mh;
    setPos({ left, top });
  }, [align, width]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // Фокус на первый доступный пункт — меню управляется стрелками.
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close]);

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [],
    );
    const idx = nodes.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        nodes[(idx + 1) % nodes.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        nodes[(idx - 1 + nodes.length) % nodes.length]?.focus();
        break;
      case 'Home':
        e.preventDefault();
        nodes[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        nodes[nodes.length - 1]?.focus();
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        close(false);
        break;
      default:
    }
  };

  type TriggerProps = {
    onClick?: (e: ReactMouseEvent<HTMLElement>) => void;
    onKeyDown?: (e: ReactKeyboardEvent<HTMLElement>) => void;
    ref?: unknown;
  };
  const triggerProps = trigger.props as TriggerProps;
  const clonedTrigger = cloneElement(trigger as ReactElement<TriggerProps & Record<string, unknown>>, {
    onClick: (e: ReactMouseEvent<HTMLElement>) => {
      triggerProps.onClick?.(e);
      triggerRef.current = e.currentTarget;
      setOpen((v) => !v);
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      triggerProps.onKeyDown?.(e);
      if (e.key === 'ArrowDown' && !open) {
        e.preventDefault();
        triggerRef.current = e.currentTarget;
        setOpen(true);
      }
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
  });

  return (
    <>
      {clonedTrigger}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="menu"
            tabIndex={-1}
            aria-label={ariaLabel}
            onKeyDown={onMenuKeyDown}
            style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
            className={cn(
              'fixed z-[10000] rounded-xl border border-line bg-surface p-1 shadow-pop outline-none',
              pos && 'motion-safe:animate-pop-in',
              className,
            )}
          >
            {items.map((it) => {
              if (it.type === 'separator') return <div key={it.key} role="separator" className="my-1 h-px bg-line" />;
              if (it.type === 'label')
                return (
                  <div
                    key={it.key}
                    className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-ink-3"
                  >
                    {it.label}
                  </div>
                );
              const Icon = it.icon;
              const cls = cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors duration-100',
                it.danger ? 'text-bad-text' : 'text-ink',
                it.disabled
                  ? 'cursor-not-allowed opacity-50'
                  : it.danger
                    ? 'hover:bg-bad-soft focus-visible:bg-bad-soft'
                    : 'hover:bg-surface-3 focus-visible:bg-surface-3',
              );
              const inner = (
                <>
                  {Icon && (
                    <Icon
                      className={cn('h-4 w-4 flex-shrink-0', it.danger ? 'text-bad' : 'text-ink-3')}
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it.label}</span>
                    {it.description && <span className="block truncate text-xs text-ink-3">{it.description}</span>}
                  </span>
                  {it.shortcut && <kbd className="text-2xs font-medium text-ink-4">{it.shortcut}</kbd>}
                </>
              );
              const select = () => {
                if (it.disabled) return;
                it.onSelect?.();
                close();
              };
              if (it.to && !it.disabled) {
                return (
                  <Link
                    key={it.key}
                    to={it.to}
                    role="menuitem"
                    tabIndex={-1}
                    className={cls}
                    onClick={() => close(false)}
                  >
                    {inner}
                  </Link>
                );
              }
              return (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={it.disabled || undefined}
                  className={cls}
                  onClick={select}
                >
                  {inner}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

export default DropdownMenu;
