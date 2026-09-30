import { useEffect, useState } from 'react';
import { ArrowRightLeft, Unlink } from 'lucide-react';
import type { StorageCell } from '../../types';
import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import StorageCellSelect from './StorageCellSelect';
import { countLabel } from './format';

export interface DeleteCellTarget {
  cell: StorageCell;
  /** Сколько товаров лежит в ячейке: из списка или из ответа 409 (он свежее). */
  count: number;
}

const PRODUCT_FORMS: [string, string, string] = ['товар', 'товара', 'товаров'];

interface StorageCellDeleteDialogProps {
  target: DeleteCellTarget | null;
  warehouseId: string;
  /** Есть ли на складе другие ячейки — иначе переносить некуда, остаётся только «Открепить». */
  hasOtherCells: boolean;
  onClose: () => void;
  /** Возвращают true, если ячейка удалена — тогда владелец диалога его закрывает. */
  onMove: (target: DeleteCellTarget, moveToId: string) => Promise<boolean>;
  onDetach: (target: DeleteCellTarget) => Promise<boolean>;
}

/** Удаление ячейки с товарами: перенести их в другую ячейку или снять адрес. Пустая ячейка сюда не попадает. */
export default function StorageCellDeleteDialog({
  target,
  warehouseId,
  hasOtherCells,
  onClose,
  onMove,
  onDetach,
}: StorageCellDeleteDialogProps) {
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState<'move' | 'detach' | null>(null);
  const targetId = target?.cell.id;

  useEffect(() => {
    setMoveTo('');
  }, [targetId]);

  const run = async (kind: 'move' | 'detach', action: () => Promise<boolean>) => {
    setBusy(kind);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const optionCls = cn(
    'flex w-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-card',
    'transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-pop',
    'disabled:pointer-events-none disabled:opacity-50',
    focusRing,
  );

  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title={target ? `Удалить ячейку ${target.cell.code}` : 'Удалить ячейку'}
      description={target ? `В ячейке ${countLabel(target.count, PRODUCT_FORMS)}. Что с ними сделать?` : undefined}
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
          Отмена
        </Button>
      }
    >
      {target && (
        <div className="space-y-3">
          {hasOtherCells && (
            <div className="space-y-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <StorageCellSelect
                    warehouseId={warehouseId}
                    value={moveTo}
                    onChange={setMoveTo}
                    excludeId={target.cell.id}
                    label={`Перенести ${countLabel(target.count, PRODUCT_FORMS)} в ячейку`}
                    emptyLabel="Выберите ячейку"
                  />
                </div>
              </div>
              <Button
                fullWidth
                disabled={!moveTo || busy !== null}
                loading={busy === 'move'}
                onClick={() => void run('move', () => onMove(target, moveTo))}
              >
                Перенести и удалить
              </Button>
            </div>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run('detach', () => onDetach(target))}
            className={optionCls}
          >
            <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
              <Unlink className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">Открепить (без ячейки)</span>
              <span className="mt-0.5 block text-xs text-ink-3">Товары останутся на складе без адреса</span>
            </span>
          </button>
        </div>
      )}
    </Modal>
  );
}
