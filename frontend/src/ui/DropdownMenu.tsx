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
import { Loader2, type LucideIcon } from 'lucide-react';
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
      /** Сохраняет состояние исходного действия: блокировка повторного запуска и aria-busy. */
      loading?: boolean;
      /** По умолчанию синхронно; для следующего диалога — после закрытия и очистки меню. */
      selectTiming?: 'immediate' | 'after-close';
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
  /** Рабочие меню шапки: перенос подписей и ограничение доступным viewport. */
  responsive?: boolean;
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
  responsive = false,
}: DropdownMenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight?: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);

  const close = useCallback((restoreFocus = true) => {
    pendingAction.current = null;
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
    const menuWidth = responsive ? Math.min(width, vw - 24) : width;
    let left = align === 'end' ? rect.right - menuWidth : rect.left;
    left = Math.max(8, Math.min(left, vw - menuWidth - 8));
    let top = rect.bottom + GAP;
    if (top + mh > vh - 8 && rect.top - GAP - mh > 8) top = rect.top - GAP - mh;
    if (responsive) {
      const below = Math.max(0, vh - rect.bottom - GAP - 8);
      const above = Math.max(0, rect.top - GAP - 8);
      const height = Math.min(menu.scrollHeight, Math.max(below, above));
      top = below >= Math.min(menu.scrollHeight, above) ? rect.bottom + GAP : rect.top - GAP - height;
      top = Math.max(8, Math.min(top, vh - height - 8));
      setPos({ left, top, width: menuWidth, maxHeight: Math.max(0, vh - top - 8) });
    } else setPos({ left, top, width });
  }, [align, width, responsive]);

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

  // This passive setup runs after the open-menu effect's cleanup and the portal's
  // committed removal. A successor dialog can now own focus without a timer guess.
  useEffect(() => {
    if (open) return;
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, [open]);
  useEffect(
    () => () => {
      pendingAction.current = null;
    },
    [],
  );

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
      pendingAction.current = null;
      triggerRef.current = e.currentTarget;
      setOpen((v) => !v);
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
      triggerProps.onKeyDown?.(e);
      if (e.key === 'ArrowDown' && !open) {
        pendingAction.current = null;
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
            style={{
              width: pos?.width ?? width,
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              maxHeight: pos?.maxHeight,
            }}
            className={cn(
              'fixed z-[10000] rounded-xl border border-line bg-surface p-1 shadow-pop outline-none',
              pos && 'motion-safe:animate-pop-in',
              responsive && 'overflow-y-auto overscroll-contain',
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
              const disabled = Boolean(it.disabled || it.loading);
              const cls = cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors duration-100',
                it.danger ? 'text-bad-text' : 'text-ink',
                disabled
                  ? 'cursor-not-allowed opacity-50'
                  : it.danger
                    ? 'hover:bg-bad-soft focus-visible:bg-bad-soft'
                    : 'hover:bg-surface-3 focus-visible:bg-surface-3',
              );
              const inner = (
                <>
                  {it.loading ? (
                    <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-ink-3" aria-hidden="true" />
                  ) : (
                    Icon && (
                      <Icon
                        className={cn('h-4 w-4 flex-shrink-0', it.danger ? 'text-bad' : 'text-ink-3')}
                        aria-hidden="true"
                      />
                    )
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn('block', responsive ? 'whitespace-normal break-words' : 'truncate')}>
                      {it.label}
                    </span>
                    {it.description && (
                      <span
                        className={cn(
                          'block text-xs text-ink-3',
                          responsive ? 'whitespace-normal break-words' : 'truncate',
                        )}
                      >
                        {it.description}
                      </span>
                    )}
                  </span>
                  {it.shortcut && <kbd className="text-2xs font-medium text-ink-4">{it.shortcut}</kbd>}
                </>
              );
              const select = () => {
                if (disabled) return;
                if (it.selectTiming === 'after-close') {
                  close();
                  pendingAction.current = it.onSelect ?? null;
                } else {
                  // File input.click, printing and window.open must keep browser activation.
                  it.onSelect?.();
                  close();
                }
              };
              if (it.to && !disabled) {
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
                  aria-disabled={disabled || undefined}
                  aria-busy={it.loading || undefined}
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
