import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Bell, GripVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { columnDotStyle } from './WorkStatusPicker';
import { checksApi } from '../api/services';
import type { WorkBoardColumn } from '../types';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';

// Shared cache key for the full (active + inactive) column list. Lives under the
// ['checks', …] prefix so the same invalidations that refresh the board / journal
// also refresh this list.
export const BOARD_COLUMNS_KEY = ['checks', 'board-columns'] as const;

// A small, friendly palette for quick selection; the native picker still allows
// any hex. Цвет колонки — смысл, заданный владельцем, поэтому остаётся inline.
const PRESET_COLORS = ['#3B82F6', '#F59E0B', '#22C55E', '#8B5CF6', '#EF4444', '#14B8A6', '#EC4899', '#6B7280'];

const DEFAULT_COLOR = '#3B82F6';

function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Цвет колонки" className="flex flex-wrap items-center gap-2">
      {PRESET_COLORS.map((c) => {
        const checked = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(c)}
            className={cn(
              'h-7 w-7 rounded-full border-2 transition-transform duration-150',
              focusRing,
              checked ? 'scale-110 border-ink' : 'border-surface shadow-sm',
            )}
            style={{ backgroundColor: c }}
            aria-label={`Цвет ${c}`}
          />
        );
      })}
      <label
        className={cn(
          'relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-line-strong',
          focusRing,
        )}
        title="Свой цвет"
      >
        <span className="sr-only">Свой цвет</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span className="block h-full w-full" style={{ backgroundColor: value }} aria-hidden="true" />
      </label>
    </div>
  );
}

/** Inline add / edit form, reused for both create and update. */
function ColumnForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: Pick<WorkBoardColumn, 'label' | 'color' | 'notifyClient'>;
  submitLabel: string;
  pending: boolean;
  onSubmit: (data: { label: string; color: string; notifyClient: boolean }) => void;
  onCancel?: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_COLOR);
  const [notifyClient, setNotifyClient] = useState(initial?.notifyClient ?? false);

  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error('Введите название колонки');
      return;
    }
    onSubmit({ label: trimmed, color, notifyClient });
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
      <Input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        aria-label="Название колонки"
        placeholder="Название колонки (напр. «На диагностике»)"
        maxLength={40}
      />
      <ColorField value={color} onChange={setColor} />
      <Checkbox
        label="Уведомлять клиента при входе в эту колонку"
        description="Например, «машина готова»"
        checked={notifyClient}
        onChange={(e) => setNotifyClient(e.target.checked)}
      />
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
            Отмена
          </Button>
        )}
        <Button size="sm" onClick={submit} loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function ColumnRow({
  column,
  index,
  total,
  busy,
  onEdit,
  onToggleActive,
  onDelete,
  onMove,
}: {
  column: WorkBoardColumn;
  index: number;
  total: number;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-2',
        !column.isActive && 'opacity-60',
      )}
    >
      <div className="-my-1 flex flex-col">
        <IconButton
          label="Выше"
          icon={ChevronUp}
          size="sm"
          className="h-6"
          onClick={() => onMove(-1)}
          disabled={busy || index === 0}
        />
        <IconButton
          label="Ниже"
          icon={ChevronDown}
          size="sm"
          className="h-6"
          onClick={() => onMove(1)}
          disabled={busy || index === total - 1}
        />
      </div>

      <GripVertical className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
      <span className="h-3 w-3 flex-shrink-0 rounded-full" style={columnDotStyle(column.color)} aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{column.label}</span>
          {column.notifyClient && (
            <Bell className="h-3.5 w-3.5 flex-shrink-0 text-warn" aria-label="Уведомляет клиента" />
          )}
        </div>
        {!column.isActive && <span className="text-2xs text-ink-3">Скрыта с доски</span>}
      </div>

      <IconButton
        label={column.isActive ? 'Скрыть с доски' : 'Показать на доске'}
        icon={column.isActive ? Eye : EyeOff}
        size="sm"
        onClick={onToggleActive}
        disabled={busy}
      />
      <IconButton label="Изменить колонку" icon={Pencil} size="sm" onClick={onEdit} disabled={busy} />
      <IconButton label="Удалить колонку" icon={Trash2} size="sm" variant="danger" onClick={onDelete} disabled={busy} />
    </li>
  );
}

export default function WorkBoardColumnsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkBoardColumn | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const {
    data: columns,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<WorkBoardColumn[]>({
    queryKey: BOARD_COLUMNS_KEY,
    queryFn: async () => (await checksApi.boardColumns.list()).data,
    enabled: isOpen,
  });

  const sorted = (columns ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['checks'] });

  const createMutation = useMutation({
    mutationFn: (data: { label: string; color: string; notifyClient: boolean }) => checksApi.boardColumns.create(data),
    onSuccess: () => {
      invalidate();
      setShowAdd(false);
      toast.success('Колонка добавлена');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Не удалось добавить колонку'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Parameters<typeof checksApi.boardColumns.update>[1]) =>
      checksApi.boardColumns.update(id, data),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Не удалось изменить колонку'),
  });

  const reorderMutation = useMutation({
    mutationFn: ({ a, b }: { a: WorkBoardColumn; b: WorkBoardColumn }) =>
      Promise.all([
        checksApi.boardColumns.update(a.id, { sortOrder: b.sortOrder }),
        checksApi.boardColumns.update(b.id, { sortOrder: a.sortOrder }),
      ]),
    onSuccess: () => invalidate(),
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Не удалось изменить порядок'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => checksApi.boardColumns.remove(id),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
      toast.success('Колонка удалена');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Не удалось удалить колонку'),
  });

  const busy =
    createMutation.isPending || updateMutation.isPending || reorderMutation.isPending || removeMutation.isPending;

  const move = (index: number, dir: -1 | 1) => {
    const a = sorted[index];
    const b = sorted[index + dir];
    if (!a || !b) return;
    reorderMutation.mutate({ a, b });
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Настройка колонок доски"
        description="Порядок — слева направо на доске. Скрытые колонки временно убираются с доски, не теряя заказ-наряды."
        size="lg"
      >
        {isLoading ? (
          <div className="space-y-2.5" aria-busy="true" aria-label="Загрузка колонок">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center" role="alert">
            <p className="text-sm text-ink-2">Не удалось загрузить колонки</p>
            <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching}>
              Повторить
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-2.5">
              {sorted.length === 0 && (
                <li className="rounded-xl border border-dashed border-line-strong py-8 text-center">
                  <p className="text-sm text-ink-3">Пока нет колонок. Добавьте первую.</p>
                </li>
              )}
              {sorted.map((column, index) =>
                editingId === column.id ? (
                  <li key={column.id}>
                    <ColumnForm
                      initial={column}
                      submitLabel="Сохранить"
                      pending={updateMutation.isPending}
                      onSubmit={(data) => updateMutation.mutate({ id: column.id, ...data })}
                      onCancel={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <ColumnRow
                    key={column.id}
                    column={column}
                    index={index}
                    total={sorted.length}
                    busy={busy}
                    onEdit={() => setEditingId(column.id)}
                    onToggleActive={() => updateMutation.mutate({ id: column.id, isActive: !column.isActive })}
                    onDelete={() => {
                      setEditingId(null);
                      setConfirmDelete(column);
                    }}
                    onMove={(dir) => move(index, dir)}
                  />
                ),
              )}
            </ul>

            {showAdd ? (
              <ColumnForm
                submitLabel="Добавить"
                pending={createMutation.isPending}
                onSubmit={(data) => createMutation.mutate(data)}
                onCancel={() => setShowAdd(false)}
              />
            ) : (
              <Button
                variant="secondary"
                fullWidth
                icon={Plus}
                onClick={() => {
                  setEditingId(null);
                  setShowAdd(true);
                }}
              >
                Добавить колонку
              </Button>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && removeMutation.mutate(confirmDelete.id)}
        title="Удалить колонку"
        message={`Удалить «${confirmDelete?.label ?? ''}»? Заказ-наряды из неё уйдут с доски.`}
        confirmText="Удалить"
        variant="danger"
        loading={removeMutation.isPending}
      />
    </>
  );
}
