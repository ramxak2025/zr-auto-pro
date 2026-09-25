import { Reorder, useDragControls } from 'framer-motion';
import { AlertTriangle, Check as CheckIcon, ChevronRight, FolderOpen, GripVertical, Trash2 } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { IconButton } from '../../ui/IconButton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { countLabel, formatDayShort } from './format';

export interface FolderInfo {
  name: string;
  count: number;
  hasLow: boolean;
  catId: string;
  fullPath: string;
}

interface FolderTileProps {
  name: string;
  count: number;
  hasLow: boolean;
  onOpen: () => void;
  onDelete?: () => void;
  canManage?: boolean;
  recentlyChecked?: boolean;
  lastCheckDate?: string;
  /** Pointer-down handler that activates the drag — provided by Reorder.Item parent. */
  dragHandleProps?: { onPointerDown: (e: React.PointerEvent) => void };
  /** Multi-select mode — show a checkbox instead of the drag handle; tap selects. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

/**
 * Плитка папки склада: настоящая кнопка (Tab, Enter, Space), ручка
 * перетаскивания, чекбокс в режиме выбора, удаление — IconButton с именем.
 */
export function FolderTile({
  name,
  count,
  hasLow,
  onOpen,
  onDelete,
  canManage,
  recentlyChecked,
  lastCheckDate,
  dragHandleProps,
  selectMode,
  selected,
  onToggleSelect,
}: FolderTileProps) {
  const activate = () => (selectMode && onToggleSelect ? onToggleSelect() : onOpen());
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border bg-surface px-2.5 py-2 shadow-card transition-[border-color,background-color] duration-150',
        selected ? 'border-accent bg-accent-soft/50' : 'border-line hover:border-line-strong',
      )}
    >
      {selectMode && onToggleSelect ? (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onToggleSelect}
          aria-label={`Выбрать папку «${name}»`}
          className="ml-1.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded border-line-strong accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2"
        />
      ) : canManage && dragHandleProps ? (
        <button
          type="button"
          aria-label={`Переставить папку «${name}»: зажмите и перетащите`}
          className={cn(
            'flex h-8 w-6 flex-shrink-0 cursor-grab touch-none items-center justify-center rounded text-ink-4 hover:bg-surface-3 hover:text-ink-2 active:cursor-grabbing',
            focusRing,
          )}
          onPointerDown={(e) => {
            e.stopPropagation();
            dragHandleProps.onPointerDown(e);
          }}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={activate}
        aria-label={selectMode ? `${selected ? 'Снять выбор' : 'Выбрать'}: папка «${name}»` : `Открыть папку «${name}»`}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-1 text-left',
          'transition-colors duration-150 hover:bg-surface-2',
          focusRing,
        )}
      >
        <span
          className={cn(
            'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
            recentlyChecked ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent',
          )}
        >
          <FolderOpen className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
            <span>{countLabel(count, ['товар', 'товара', 'товаров'])}</span>
            {recentlyChecked ? (
              <Badge tone="ok" size="sm" icon={CheckIcon}>
                Проверено сегодня
              </Badge>
            ) : lastCheckDate ? (
              <span>проверка {formatDayShort(lastCheckDate)}</span>
            ) : null}
          </span>
        </span>
        {hasLow && (
          <Badge tone="warn" size="sm" icon={AlertTriangle} className="flex-shrink-0">
            Дефицит
          </Badge>
        )}
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
      </button>

      {/* Delete button — hidden in select mode (bulk delete handles it) */}
      {!selectMode && canManage && onDelete && (
        <IconButton label={`Удалить папку «${name}»`} icon={Trash2} size="sm" variant="danger" onClick={onDelete} />
      )}
    </div>
  );
}

interface FolderTileReorderItemProps {
  folder: FolderInfo;
  checkInfo?: { recentlyChecked: boolean; lastCheckDate?: string };
  canManage?: boolean;
  onOpen: () => void;
  onDelete: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

// Reorder.Item wrapper — wires the folder tile into framer-motion's
// gesture-driven list. dragListener={false} disables the default whole-row
// drag (which would conflict with the tap-to-open behaviour) and instead
// hands control to a manually-triggered useDragControls() bound to the
// grip handle inside FolderTile. Press-and-drag on the grip starts the drag;
// release commits via Reorder.Group's onReorder.
export function FolderTileReorderItem({
  folder,
  checkInfo,
  canManage,
  onOpen,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
}: FolderTileReorderItemProps) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item value={folder} dragListener={false} dragControls={dragControls}>
      <FolderTile
        name={folder.name}
        count={folder.count}
        hasLow={folder.hasLow}
        onOpen={onOpen}
        onDelete={onDelete}
        canManage={canManage}
        recentlyChecked={checkInfo?.recentlyChecked}
        lastCheckDate={checkInfo?.lastCheckDate}
        dragHandleProps={{ onPointerDown: (e) => dragControls.start(e) }}
        selectMode={selectMode}
        selected={selected}
        onToggleSelect={onToggleSelect}
      />
    </Reorder.Item>
  );
}
