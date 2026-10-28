import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowLeft,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  MapPin,
  MoreHorizontal,
  Plus,
  Square,
  Warehouse,
  X,
} from 'lucide-react';
import gsap from 'gsap';
import { IconButton } from '../../ui/IconButton';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import type { MenuEntry } from '../../ui/DropdownMenu';
import { useJournalSelection } from '../../pages/journal/useJournalSelection';
import WarehouseSearch from './WarehouseSearch';
import WarehousePopover from './WarehousePopover';
import '../../pages/journal/journal.css';
import './warehouse-header.css';

type Option = { value: string; label: string };
type Panel = 'actions' | 'warehouses' | 'cells';

function Choices({
  options,
  value,
  onChange,
  label,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useJournalSelection(root, value);
  return (
    <div ref={root} className="warehouse-choices" role="group" aria-label={label}>
      <span data-selection-backplate className="journal-selection-backplate" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn('warehouse-choice', focusRing)}
          data-selection-active={option.value === value}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <span>{option.label}</span>
          <span className="warehouse-choice-check" aria-hidden="true">
            {option.value === value && <Check size={16} />}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function WarehouseHeader({
  subtitle,
  warehouses,
  warehouseId,
  warehouseName,
  onWarehouseChange,
  search,
  onSearchChange,
  hasCells,
  cell,
  cellOptions,
  onCellChange,
  onOpenCells,
  onCreate,
  actions,
  selection,
}: {
  subtitle?: string;
  warehouses: Option[];
  warehouseId: string;
  warehouseName: string;
  onWarehouseChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  hasCells: boolean;
  cell: string;
  cellOptions: Option[];
  onCellChange: (value: string) => void;
  onOpenCells: () => void;
  onCreate?: () => void;
  actions: MenuEntry[];
  selection?: {
    count: number;
    allSelected: boolean;
    canSelectAll: boolean;
    onToggleAll: () => void;
    onCancel: () => void;
  };
}) {
  const root = useRef<HTMLElement>(null);
  const warehouseTrigger = useRef<HTMLButtonElement>(null);
  const cellsTrigger = useRef<HTMLButtonElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const [expanded, setExpanded] = useState(Boolean(search));
  const [popup, setPopup] = useState<{
    open: boolean;
    panel: Panel;
    back: boolean;
    anchor: RefObject<HTMLButtonElement>;
  }>({ open: false, panel: 'actions', back: false, anchor: moreTrigger });
  const id = useId();
  const showMore = warehouses.length > 1 || actions.length > 0;
  const open = (panel: Panel, anchor: RefObject<HTMLButtonElement>) => {
    pendingAction.current = null;
    setPopup({ open: true, panel, anchor, back: false });
  };
  const close = () => setPopup((current) => ({ ...current, open: false }));
  const perform = (action?: () => void, immediate = false) => {
    if (immediate) action?.();
    else pendingAction.current = action ?? null;
    close();
  };
  const afterExit = () => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  };
  const navigate = (panel: Panel) => setPopup((current) => ({ ...current, panel, back: panel !== 'actions' }));
  useEffect(
    () => () => {
      pendingAction.current = null;
    },
    [],
  );
  useLayoutEffect(() => {
    if (!popup.open || !body.current) return;
    const media = gsap.matchMedia();
    media.add(
      '(prefers-reduced-motion: no-preference)',
      () => {
        gsap.fromTo(
          body.current,
          { x: popup.back ? 10 : -10, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.2, ease: 'power3.out' },
        );
      },
      body,
    );
    body.current.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => media.revert();
  }, [popup.panel, popup.back, popup.open]);
  useLayoutEffect(() => {
    const node = root.current;
    const scroll = node?.closest('main');
    if (!node || !scroll) return;
    const media = gsap.matchMedia();
    let frame = 0;
    media.add(
      { reduced: '(prefers-reduced-motion: reduce)', regular: '(prefers-reduced-motion: no-preference)' },
      (context) => {
        const reduced = Boolean(context.conditions?.reduced);
        const timeline = gsap
          .timeline({ paused: true })
          .to(node.querySelector('.journal-title'), { y: reduced ? 0 : -24, opacity: 0, duration: 1, ease: 'none' }, 0)
          .to(
            node.querySelector('.journal-subtitle'),
            { y: reduced ? 0 : -10, opacity: 0, duration: 0.65, ease: 'none' },
            0,
          )
          .to(node, { '--journal-material': 1, '--journal-dock-elevation': 0, duration: 1, ease: 'none' }, 0);
        const update = () => {
          frame = 0;
          const naturalTop =
            (node.parentElement?.getBoundingClientRect().top ?? 0) -
            scroll.getBoundingClientRect().top +
            scroll.scrollTop;
          const progress = Math.max(0, Math.min(1, (scroll.scrollTop - naturalTop) / 80));
          timeline.progress(progress);
          node.dataset.warehouseProgress = progress.toFixed(3);
          node.dataset.warehouseCompact = String(progress >= 0.99);
          node.querySelector('.journal-heading')?.setAttribute('aria-hidden', String(progress >= 0.99));
        };
        const schedule = () => {
          if (!frame) frame = requestAnimationFrame(update);
        };
        scroll.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        update();
        return () => {
          cancelAnimationFrame(frame);
          frame = 0;
          scroll.removeEventListener('scroll', schedule);
          window.removeEventListener('resize', schedule);
        };
      },
      root,
    );
    return () => media.revert();
  }, []);
  return (
    <header
      ref={root}
      className="journal-header warehouse-header"
      data-warehouse-progress="0"
      data-warehouse-compact="false"
    >
      <div className="journal-heading">
        <h1 className="journal-title">Склад</h1>
        <p className="journal-subtitle">{subtitle || '\u00a0'}</p>
      </div>
      <div className="journal-command-material" aria-hidden="true" />
      <div className="journal-command warehouse-command" data-search-open={expanded}>
        <div className="journal-scope-dock warehouse-scope journal-dock">
          {warehouses.length > 1 ? (
            <button
              ref={warehouseTrigger}
              type="button"
              className={cn('warehouse-scope-button', focusRing)}
              title={warehouseName}
              aria-label={`Выбрать склад: ${warehouseName}`}
              aria-haspopup="dialog"
              aria-expanded={popup.open && popup.panel === 'warehouses'}
              onClick={() => open('warehouses', warehouseTrigger)}
            >
              <span>{warehouseName}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          ) : (
            <span className="warehouse-scope-label" title={warehouseName}>
              {warehouseName || 'Склад'}
            </span>
          )}
        </div>
        <div className="journal-tools-dock warehouse-tools journal-dock">
          <WarehouseSearch
            value={search}
            geometryKey={`${warehouseId}|${warehouseName}|${hasCells}|${Boolean(onCreate)}|${showMore}`}
            onChange={onSearchChange}
            onExpandedChange={setExpanded}
            placeholder={hasCells ? 'Название или ячейка' : 'Название товара'}
          />
          {hasCells && (
            <div data-warehouse-tool className="journal-filter-control">
              <IconButton
                ref={cellsTrigger}
                label={cell ? 'Фильтр по ячейке активен' : 'Фильтр по ячейке'}
                icon={MapPin}
                aria-haspopup="dialog"
                aria-expanded={popup.open && popup.panel === 'cells'}
                className={cn('journal-action', cell && 'journal-action--selected')}
                onClick={() => open('cells', cellsTrigger)}
              />
              {cell && <span className="warehouse-filter-dot" aria-hidden="true" />}
            </div>
          )}
          {showMore && (
            <div data-warehouse-tool className="journal-more-control">
              <IconButton
                ref={moreTrigger}
                label="Ещё действия со складом"
                icon={MoreHorizontal}
                aria-haspopup="dialog"
                aria-expanded={popup.open && popup.anchor === moreTrigger}
                className="journal-action"
                onClick={() => open('actions', moreTrigger)}
              />
            </div>
          )}
          {onCreate && (
            <div data-warehouse-tool className="journal-more-control">
              <IconButton
                label="Добавить товар"
                icon={Plus}
                onClick={onCreate}
                className="journal-action warehouse-add"
              />
            </div>
          )}
        </div>
      </div>
      {selection && (
        <div className="warehouse-selection" aria-label="Выбор товаров">
          <span>{selection.count ? `Выбрано: ${selection.count}` : 'Выберите товары'}</span>
          {selection.canSelectAll && (
            <Button
              variant="ghost"
              size="sm"
              icon={selection.allSelected ? CheckSquare : Square}
              onClick={selection.onToggleAll}
            >
              {selection.allSelected ? 'Снять всё' : 'Выбрать всё'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={selection.onCancel}>
            Отменить выбор
          </Button>
        </div>
      )}
      <WarehousePopover
        open={popup.open}
        onClose={close}
        onExited={afterExit}
        anchor={popup.anchor}
        labelledBy={`${id}-title`}
      >
        <div className="warehouse-popup-heading">
          {popup.back && (
            <IconButton
              label="Назад к действиям"
              icon={ArrowLeft}
              className="warehouse-popup-action"
              onClick={() => navigate('actions')}
            />
          )}
          <h2 id={`${id}-title`}>
            {popup.panel === 'actions' ? 'Действия' : popup.panel === 'warehouses' ? 'Выбрать склад' : 'Ячейка'}
          </h2>
          <IconButton label="Закрыть меню склада" icon={X} className="warehouse-popup-action" onClick={close} />
        </div>
        <div ref={body} className="warehouse-popup-body">
          {popup.panel === 'warehouses' && (
            <Choices
              options={warehouses}
              value={warehouseId}
              label="Склады"
              onChange={(value) => {
                onWarehouseChange(value);
                close();
              }}
            />
          )}
          {popup.panel === 'cells' && (
            <>
              <Choices
                options={cellOptions}
                value={cell}
                label="Фильтр по ячейке"
                onChange={(value) => {
                  onCellChange(value);
                  close();
                }}
              />
              <div className="warehouse-menu-separator" role="separator" />
              <button
                type="button"
                className={cn('warehouse-menu-action', focusRing)}
                onClick={() => perform(onOpenCells)}
              >
                <MapPin size={19} aria-hidden="true" />
                <span>Ячейки хранения</span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </>
          )}
          {popup.panel === 'actions' && (
            <>
              {warehouses.length > 1 && (
                <>
                  <button
                    type="button"
                    className={cn('warehouse-menu-action warehouse-context-action', focusRing)}
                    onClick={() => navigate('warehouses')}
                  >
                    <Warehouse size={19} aria-hidden="true" />
                    <span>
                      <strong>Сменить склад</strong>
                      <small>{warehouseName}</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                  <div role="separator" className="warehouse-menu-separator" />
                </>
              )}
              {actions.map((entry) => {
                if (entry.type === 'separator')
                  return <div key={entry.key} role="separator" className="warehouse-menu-separator" />;
                if (entry.type === 'label')
                  return (
                    <p key={entry.key} className="warehouse-menu-label">
                      {entry.label}
                    </p>
                  );
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    disabled={entry.disabled}
                    className={cn('warehouse-menu-action', entry.danger && 'warehouse-menu-action--danger', focusRing)}
                    onClick={() => perform(entry.onSelect, entry.key === 'import')}
                  >
                    {Icon && <Icon size={19} aria-hidden="true" />}
                    <span>
                      <strong>{entry.label}</strong>
                      {entry.description && <small>{entry.description}</small>}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </WarehousePopover>
    </header>
  );
}
