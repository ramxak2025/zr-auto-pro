import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, LayoutGrid, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { storageCellsApi, type RemoveStorageCellParams, type UpdateStorageCellRequest } from '../../api/services';
import type { StorageCell } from '../../types';
import {
  storageCellErrorCode,
  storageCellErrorMessage,
  storageCellErrorProductsCount,
  storageCellsKey,
  useStorageCells,
} from '../../hooks/useStorageCells';
import ConfirmDialog from '../ConfirmDialog';
import EmptyState from '../EmptyState';
import SearchInput from '../SearchInput';
import { Button } from '../../ui/Button';
import { Drawer } from '../../ui/Drawer';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { Skeleton } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { normalizeCellCode } from '../../../../shared/utils/storageCells';
import CellGridCreator from './CellGridCreator';
import StorageCellDeleteDialog, { type DeleteCellTarget } from './StorageCellDeleteDialog';
import { countLabel } from './format';

/** Сколько ячеек рисуем за раз: на складе их бывают тысячи, а шторка — не таблица. */
const PAGE = 100;

const CELL_FORMS: [string, string, string] = ['ячейка', 'ячейки', 'ячеек'];
const PRODUCT_FORMS: [string, string, string] = ['товар', 'товара', 'товаров'];

const CODE_INPUT_CLS = 'font-mono uppercase placeholder:font-sans placeholder:normal-case';

// ─── Добавить одну ячейку ────────────────────────────────────────────────────

function AddCellForm({
  warehouseId,
  cells,
  onCreated,
  onCancel,
}: {
  warehouseId: string;
  cells: StorageCell[];
  onCreated: (cell: StorageCell) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const submit = async () => {
    if (busy) return;
    const normalized = normalizeCellCode(code);
    if (!normalized) {
      setError('Введите код ячейки, например A-01-03');
      return;
    }
    if (cells.some((c) => normalizeCellCode(c.code) === normalized)) {
      setError('Ячейка с таким кодом уже есть на этом складе');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await storageCellsApi.create({ warehouseId, code: normalized, name: name.trim() || undefined });
      onCreated(data);
      // Форма остаётся открытой — ячейки обычно заводят подряд.
      setCode('');
      setName('');
      codeRef.current?.focus();
    } catch (err) {
      setError(storageCellErrorMessage(err, 'Не удалось создать ячейку'));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Input
          ref={codeRef}
          size="sm"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Код: A-01-03"
          aria-label="Код новой ячейки"
          invalid={!!error}
          maxLength={64}
          autoComplete="off"
          className={CODE_INPUT_CLS}
        />
        <Input
          size="sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Подпись (необязательно)"
          aria-label="Подпись новой ячейки"
          maxLength={120}
          autoComplete="off"
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-bad-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Закрыть
        </Button>
        <Button size="sm" loading={busy} disabled={!code.trim()} onClick={() => void submit()}>
          Добавить
        </Button>
      </div>
    </div>
  );
}

// ─── Переименовать ───────────────────────────────────────────────────────────

function CellEditRow({
  cell,
  cells,
  onSaved,
  onCancel,
}: {
  cell: StorageCell;
  cells: StorageCell[];
  onSaved: (cell: StorageCell) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(cell.code);
  const [name, setName] = useState(cell.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    codeRef.current?.focus();
    codeRef.current?.select();
  }, []);

  const submit = async () => {
    if (busy) return;
    const normalized = normalizeCellCode(code);
    if (!normalized) {
      setError('Код ячейки не может быть пустым');
      return;
    }
    if (cells.some((c) => c.id !== cell.id && normalizeCellCode(c.code) === normalized)) {
      setError('Ячейка с таким кодом уже есть на этом складе');
      return;
    }
    const patch: UpdateStorageCellRequest = {};
    if (normalized !== normalizeCellCode(cell.code)) patch.code = normalized;
    const trimmedName = name.trim();
    if (trimmedName !== (cell.name ?? '')) patch.name = trimmedName || null;
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await storageCellsApi.update(cell.id, patch);
      onSaved(data);
    } catch (err) {
      setError(storageCellErrorMessage(err, 'Не удалось сохранить ячейку'));
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <li className="space-y-2 rounded-lg border border-accent/40 bg-surface p-3">
      <div className="grid grid-cols-2 gap-2">
        <Input
          ref={codeRef}
          size="sm"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          aria-label="Код ячейки"
          invalid={!!error}
          maxLength={64}
          autoComplete="off"
          className={CODE_INPUT_CLS}
        />
        <Input
          size="sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Подпись (необязательно)"
          aria-label="Подпись ячейки"
          maxLength={120}
          autoComplete="off"
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-bad-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
        <Button size="sm" loading={busy} disabled={!code.trim()} onClick={() => void submit()}>
          Сохранить
        </Button>
      </div>
    </li>
  );
}

// ─── Строка ячейки ───────────────────────────────────────────────────────────

function CellRow({
  cell,
  canManage,
  canMoveUp,
  canMoveDown,
  onSelect,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
}: {
  cell: StorageCell;
  canManage: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center rounded-lg border border-line bg-surface transition-colors hover:border-line-strong">
      <button
        type="button"
        onClick={onSelect}
        title="Показать товары в этой ячейке"
        className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left', focusRing)}
      >
        <span className="flex-shrink-0 font-mono text-sm font-semibold tabular-nums text-ink">{cell.code}</span>
        {cell.name && <span className="min-w-0 flex-1 truncate text-sm text-ink-3">{cell.name}</span>}
        <span
          className={cn(
            'ml-auto flex-shrink-0 text-xs tabular-nums',
            cell.productsCount > 0 ? 'text-ink-2' : 'text-ink-4',
          )}
        >
          {countLabel(cell.productsCount, PRODUCT_FORMS)}
        </span>
      </button>
      {canManage && (
        <div className="flex flex-shrink-0 items-center pr-1">
          {(canMoveUp || canMoveDown) && (
            <>
              <IconButton
                label={`Поднять ячейку ${cell.code} выше`}
                icon={ArrowUp}
                size="sm"
                disabled={!canMoveUp}
                onClick={onMoveUp}
              />
              <IconButton
                label={`Опустить ячейку ${cell.code} ниже`}
                icon={ArrowDown}
                size="sm"
                disabled={!canMoveDown}
                onClick={onMoveDown}
              />
            </>
          )}
          <IconButton label={`Переименовать ячейку ${cell.code}`} icon={Pencil} size="sm" onClick={onEdit} />
          <IconButton
            label={`Удалить ячейку ${cell.code}`}
            icon={Trash2}
            size="sm"
            variant="danger"
            onClick={onDelete}
          />
        </div>
      )}
    </li>
  );
}

// ─── Шторка ──────────────────────────────────────────────────────────────────

interface StorageCellsDrawerProps {
  open: boolean;
  onClose: () => void;
  warehouseId: string;
  warehouseName?: string;
  /** Право управления складом: создавать, переименовывать, переставлять и удалять. */
  canManage: boolean;
  /** Клик по ячейке: страница закрывает шторку и включает фильтр «Ячейка». */
  onSelectCell: (cellId: string) => void;
}

/** Справочник ячеек хранения выбранного склада. */
export default function StorageCellsDrawer({
  open,
  onClose,
  warehouseId,
  warehouseName,
  canManage,
  onSelectCell,
}: StorageCellsDrawerProps) {
  const queryClient = useQueryClient();
  const { cells, isLoading, isError, refetch, invalidate, invalidateCells, upsert } = useStorageCells(warehouseId);

  const [view, setView] = useState<'list' | 'grid'>('list');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StorageCell | null>(null);
  const [moveDialog, setMoveDialog] = useState<DeleteCellTarget | null>(null);
  const [reordering, setReordering] = useState(false);

  // Drawer перевешивает Escape-слушатель при смене onClose, поэтому отдаём ему стабильную функцию.
  const onCloseRef = useRef(onClose);
  const dialogOpenRef = useRef(false);
  useEffect(() => {
    onCloseRef.current = onClose;
    dialogOpenRef.current = !!(confirmDelete || moveDialog);
  });
  // Escape в открытом диалоге закрывает только диалог: слушатель шторки срабатывает раньше слушателя окна.
  const handleClose = useCallback(() => {
    if (!dialogOpenRef.current) onCloseRef.current();
  }, []);

  // Счётчики «N товаров» меняются при назначении ячеек с других экранов — при открытии берём свежие.
  useEffect(() => {
    if (open) invalidateCells();
  }, [open, invalidateCells]);

  // Состояние сбрасываем при закрытии: пока шторка уезжает, анимация показывает прежний кадр.
  useEffect(() => {
    if (open) return;
    setView('list');
    setSearch('');
    setLimit(PAGE);
    setAdding(false);
    setEditingId(null);
    setConfirmDelete(null);
    setMoveDialog(null);
  }, [open]);

  const query = normalizeCellCode(search);
  const filtered = useMemo(
    () =>
      query
        ? cells.filter((c) => normalizeCellCode(c.code).includes(query) || (c.name ?? '').toUpperCase().includes(query))
        : cells,
    [cells, query],
  );
  const visible = filtered.slice(0, limit);
  // Стрелки работают на полном списке: в отфильтрованном соседи по порядку — не соседи на полке.
  const canReorder = canManage && !query && cells.length > 1 && !reordering;

  const handleCreated = useCallback(
    (cell: StorageCell) => {
      upsert(cell);
      invalidateCells();
      toast.success(`Ячейка ${cell.code} создана`);
    },
    [upsert, invalidateCells],
  );

  const handleSaved = useCallback(
    (cell: StorageCell) => {
      upsert(cell);
      // Код и подпись лежат и в списках товаров.
      invalidate();
      setEditingId(null);
      toast.success(`Ячейка ${cell.code} сохранена`);
    },
    [upsert, invalidate],
  );

  const reorder = useCallback(
    async (cell: StorageCell, direction: -1 | 1) => {
      const from = cells.findIndex((c) => c.id === cell.id);
      const to = from + direction;
      if (reordering || from < 0 || to < 0 || to >= cells.length) return;
      const ordered = cells.map((c) => c.id);
      [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
      const position = new Map(ordered.map((id, i) => [id, i]));
      const key = storageCellsKey(warehouseId);
      const previous = queryClient.getQueryData<StorageCell[]>(key);
      queryClient.setQueryData<StorageCell[]>(key, (old) =>
        old?.map((c) => ({ ...c, sortOrder: position.get(c.id) ?? c.sortOrder })),
      );
      setReordering(true);
      try {
        await storageCellsApi.updateOrder(ordered);
        invalidateCells();
      } catch (err) {
        queryClient.setQueryData(key, previous);
        toast.error(storageCellErrorMessage(err, 'Не удалось изменить порядок ячеек'));
      } finally {
        setReordering(false);
      }
    },
    [cells, reordering, queryClient, warehouseId, invalidateCells],
  );

  const removeCell = useCallback(
    async (cell: StorageCell, opts?: RemoveStorageCellParams): Promise<boolean> => {
      try {
        await storageCellsApi.remove(cell.id, opts);
        invalidate();
        return true;
      } catch (err) {
        if (storageCellErrorCode(err) === 'STORAGE_CELL_NOT_EMPTY') {
          // Список был устаревшим: в «пустую» ячейку уже положили товар — предлагаем перенос.
          invalidate();
          setMoveDialog({ cell, count: storageCellErrorProductsCount(err) ?? cell.productsCount });
        } else {
          toast.error(storageCellErrorMessage(err, 'Не удалось удалить ячейку'));
        }
        return false;
      }
    },
    [invalidate],
  );

  const requestDelete = useCallback((cell: StorageCell) => {
    if (cell.productsCount > 0) setMoveDialog({ cell, count: cell.productsCount });
    else setConfirmDelete(cell);
  }, []);

  const closeConfirm = useCallback(() => setConfirmDelete(null), []);
  const closeMoveDialog = useCallback(() => setMoveDialog(null), []);

  const confirmDeleteEmpty = () => {
    const cell = confirmDelete;
    if (!cell) return;
    void removeCell(cell).then((ok) => {
      if (ok) toast.success(`Ячейка ${cell.code} удалена`);
    });
  };

  const handleMove = useCallback(
    async (target: DeleteCellTarget, moveToId: string) => {
      const ok = await removeCell(target.cell, { moveTo: moveToId });
      if (ok) {
        const dest = cells.find((c) => c.id === moveToId);
        setMoveDialog(null);
        toast.success(
          dest
            ? `Товары перенесены в ${dest.code}, ячейка ${target.cell.code} удалена`
            : `Ячейка ${target.cell.code} удалена`,
        );
      }
      return ok;
    },
    [removeCell, cells],
  );

  const handleDetach = useCallback(
    async (target: DeleteCellTarget) => {
      const ok = await removeCell(target.cell, { detach: true });
      if (ok) {
        setMoveDialog(null);
        toast.success(`Ячейка ${target.cell.code} удалена, у товаров снят адрес`);
      }
      return ok;
    },
    [removeCell],
  );

  const showList = view === 'list';

  return (
    <>
      <Drawer
        open={open}
        onClose={handleClose}
        title={showList ? 'Ячейки хранения' : 'Создать ячейки'}
        subtitle={warehouseName}
        size="md"
      >
        {!showList ? (
          <CellGridCreator warehouseId={warehouseId} onCancel={() => setView('list')} onDone={() => setView('list')} />
        ) : (
          <div className="space-y-4">
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" icon={Plus} disabled={adding} onClick={() => setAdding(true)}>
                  Добавить ячейку
                </Button>
                <Button variant="secondary" size="sm" icon={LayoutGrid} onClick={() => setView('grid')}>
                  Создать сетку
                </Button>
              </div>
            )}

            {canManage && adding && (
              <AddCellForm
                warehouseId={warehouseId}
                cells={cells}
                onCreated={handleCreated}
                onCancel={() => setAdding(false)}
              />
            )}

            {cells.length > 0 && (
              <div className="space-y-2">
                <SearchInput
                  value={search}
                  onChange={(v) => {
                    setSearch(v);
                    setLimit(PAGE);
                  }}
                  placeholder="Найти ячейку по коду…"
                  aria-label="Найти ячейку по коду"
                />
                <p className="text-xs text-ink-3" aria-live="polite">
                  {query ? `Найдено ${filtered.length} из ${cells.length}` : countLabel(cells.length, CELL_FORMS)}
                </p>
              </div>
            )}

            {isLoading && cells.length === 0 ? (
              <div className="space-y-1.5" role="status" aria-label="Загрузка ячеек">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-lg" />
                ))}
              </div>
            ) : isError && cells.length === 0 ? (
              <div className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad-text" role="alert">
                Не удалось загрузить ячейки.{' '}
                <button type="button" onClick={refetch} className={cn('font-semibold underline', focusRing)}>
                  Повторить
                </button>
              </div>
            ) : cells.length === 0 ? (
              <EmptyState
                compact
                icon={MapPin}
                title="На складе пока нет ячеек"
                description={
                  canManage
                    ? 'Ячейка — адрес товара на складе: стеллаж, полка, место. Добавьте одну или создайте сразу много сеткой «стеллажи × полки × ячейки».'
                    : 'Ячейка — адрес товара на складе. Заводит их сотрудник с правом управления складом.'
                }
              />
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">Ничего не найдено по «{search.trim()}»</p>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {visible.map((cell, i) =>
                    editingId === cell.id ? (
                      <CellEditRow
                        key={cell.id}
                        cell={cell}
                        cells={cells}
                        onSaved={handleSaved}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <CellRow
                        key={cell.id}
                        cell={cell}
                        canManage={canManage}
                        canMoveUp={canReorder && i > 0}
                        canMoveDown={canReorder && i < cells.length - 1}
                        onSelect={() => onSelectCell(cell.id)}
                        onMoveUp={() => void reorder(cell, -1)}
                        onMoveDown={() => void reorder(cell, 1)}
                        onEdit={() => setEditingId(cell.id)}
                        onDelete={() => requestDelete(cell)}
                      />
                    ),
                  )}
                </ul>
                {filtered.length > limit && (
                  <Button variant="ghost" fullWidth onClick={() => setLimit((l) => l + PAGE)}>
                    Показать ещё {Math.min(PAGE, filtered.length - limit)}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={closeConfirm}
        onConfirm={confirmDeleteEmpty}
        title="Удалить ячейку?"
        message={
          confirmDelete ? `Ячейка ${confirmDelete.code} пуста. Она будет удалена без возможности восстановления.` : ''
        }
        confirmText="Удалить"
        variant="danger"
      />

      <StorageCellDeleteDialog
        target={moveDialog}
        warehouseId={warehouseId}
        hasOtherCells={cells.length > 1}
        onClose={closeMoveDialog}
        onMove={handleMove}
        onDetach={handleDetach}
      />
    </>
  );
}
