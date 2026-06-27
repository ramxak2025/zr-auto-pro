import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Bell, GripVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import LoadingSpinner from './LoadingSpinner';
import { columnDotStyle } from './WorkStatusPicker';
import { checksApi } from '../api/services';
import type { WorkBoardColumn } from '../types';

// Shared cache key for the full (active + inactive) column list. Lives under the
// ['checks', …] prefix so the same invalidations that refresh the board / journal
// also refresh this list.
export const BOARD_COLUMNS_KEY = ['checks', 'board-columns'] as const;

// A small, friendly palette for quick selection; the native picker still allows
// any hex.
const PRESET_COLORS = ['#3B82F6', '#F59E0B', '#22C55E', '#8B5CF6', '#EF4444', '#14B8A6', '#EC4899', '#6B7280'];

const DEFAULT_COLOR = '#3B82F6';

function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full border-2 transition-transform ${
            value.toLowerCase() === c.toLowerCase() ? 'border-gray-900 scale-110' : 'border-white shadow-sm'
          }`}
          style={{ backgroundColor: c }}
          aria-label={`Цвет ${c}`}
        />
      ))}
      <label
        className="h-7 w-7 rounded-full border border-gray-200 overflow-hidden cursor-pointer relative"
        title="Свой цвет"
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span className="block h-full w-full" style={{ backgroundColor: value }} />
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
    <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Название колонки (напр. «На диагностике»)"
        className="input w-full"
        maxLength={40}
      />
      <ColorField value={color} onChange={setColor} />
      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={notifyClient}
          onChange={(e) => setNotifyClient(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        Уведомлять клиента при входе в эту колонку («машина готова»)
      </label>
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary btn-sm" disabled={pending}>
            Отмена
          </button>
        )}
        <button type="button" onClick={submit} className="btn-primary btn-sm" disabled={pending}>
          {submitLabel}
        </button>
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
    <div
      className={`flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 ${
        column.isActive ? '' : 'opacity-60'
      }`}
    >
      {/* Reorder */}
      <div className="flex flex-col -my-1">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={busy || index === 0}
          className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"
          aria-label="Выше"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={busy || index === total - 1}
          className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300"
          aria-label="Ниже"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />
      <span className="h-3 w-3 rounded-full flex-shrink-0" style={columnDotStyle(column.color)} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-gray-900 truncate">{column.label}</span>
          {column.notifyClient && <Bell className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
        </div>
        {!column.isActive && <span className="text-[11px] text-gray-400">Скрыта с доски</span>}
      </div>

      {/* Actions */}
      <button
        type="button"
        onClick={onToggleActive}
        disabled={busy}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        title={column.isActive ? 'Скрыть с доски' : 'Показать на доске'}
      >
        {column.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 disabled:opacity-50"
        title="Изменить"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50"
        title="Удалить"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function WorkBoardColumnsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data: columns, isLoading } = useQuery<WorkBoardColumn[]>({
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
      setConfirmDeleteId(null);
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
    <Modal isOpen={isOpen} onClose={onClose} title="Настройка колонок доски" size="lg">
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Колонки доски настраиваются под ваш процесс. Порядок — слева направо на доске. Скрытые колонки временно
            убираются с доски, не теряя заказ-наряды.
          </p>

          {/* Columns list */}
          <div className="space-y-2.5">
            {sorted.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
                <p className="text-sm text-gray-400">Пока нет колонок. Добавьте первую.</p>
              </div>
            )}
            {sorted.map((column, index) =>
              editingId === column.id ? (
                <ColumnForm
                  key={column.id}
                  initial={column}
                  submitLabel="Сохранить"
                  pending={updateMutation.isPending}
                  onSubmit={(data) => updateMutation.mutate({ id: column.id, ...data })}
                  onCancel={() => setEditingId(null)}
                />
              ) : confirmDeleteId === column.id ? (
                <div
                  key={column.id}
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap"
                >
                  <p className="text-sm text-red-700">Удалить «{column.label}»? Заказ-наряды из неё уйдут с доски.</p>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="btn-secondary btn-sm"
                      disabled={removeMutation.isPending}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMutation.mutate(column.id)}
                      className="btn-danger btn-sm"
                      disabled={removeMutation.isPending}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ) : (
                <ColumnRow
                  key={column.id}
                  column={column}
                  index={index}
                  total={sorted.length}
                  busy={busy}
                  onEdit={() => {
                    setConfirmDeleteId(null);
                    setEditingId(column.id);
                  }}
                  onToggleActive={() => updateMutation.mutate({ id: column.id, isActive: !column.isActive })}
                  onDelete={() => {
                    setEditingId(null);
                    setConfirmDeleteId(column.id);
                  }}
                  onMove={(dir) => move(index, dir)}
                />
              ),
            )}
          </div>

          {/* Add */}
          {showAdd ? (
            <ColumnForm
              submitLabel="Добавить"
              pending={createMutation.isPending}
              onSubmit={(data) => createMutation.mutate(data)}
              onCancel={() => setShowAdd(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setConfirmDeleteId(null);
                setShowAdd(true);
              }}
              className="btn-secondary w-full justify-center"
            >
              <Plus className="h-4 w-4" />
              Добавить колонку
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
