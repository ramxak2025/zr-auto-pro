import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { productsApi } from '../../api/services';
import { storageCellErrorMessage, useStorageCells } from '../../hooks/useStorageCells';
import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { MAX_BULK_CELLS } from '../../../../shared/utils/storageCells';
import StorageCellSelect from './StorageCellSelect';
import { countLabel } from './format';

const PRODUCT_FORMS: [string, string, string] = ['товар', 'товара', 'товаров'];

interface AssignCellModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Склад, чьи ячейки предлагаем: все выбранные товары должны лежать на нём. */
  warehouseId: string;
  productIds: string[];
  title?: string;
  description?: string;
  /** Ячейка, выбранная при открытии (у одного товара — его текущая). */
  initialCellId?: string | null;
  /** Текущая ячейка товара: остаётся в списке, даже если склад ещё не ответил. */
  currentCell?: { id: string; code: string; name?: string | null } | null;
  onDone?: (updated: number) => void;
}

/** Назначить (или снять) ячейку у одного или нескольких товаров одного склада. */
export default function AssignCellModal({
  isOpen,
  onClose,
  warehouseId,
  productIds,
  title = 'Назначить ячейку',
  description,
  initialCellId,
  currentCell,
  onDone,
}: AssignCellModalProps) {
  const { byId, invalidate } = useStorageCells(warehouseId);
  const [cellId, setCellId] = useState(initialCellId ?? '');
  // Пока поле не тронуто, «Назначить» недоступно: иначе пустое значение по умолчанию молча сняло бы адрес у всей выборки.
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Modal перевешивает Escape и фокус при каждой смене onClose — отдаём ему стабильную функцию.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const handleClose = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    if (!isOpen) return;
    setCellId(initialCellId ?? '');
    setTouched(false);
  }, [isOpen, initialCellId]);

  const submit = async () => {
    if (busy || productIds.length === 0) return;
    setBusy(true);
    let updated = 0;
    try {
      // Сервер принимает не больше MAX_BULK_CELLS товаров за запрос.
      for (let i = 0; i < productIds.length; i += MAX_BULK_CELLS) {
        const { data } = await productsApi.bulkAssignCell({
          productIds: productIds.slice(i, i + MAX_BULK_CELLS),
          storageCellId: cellId || null,
        });
        updated += data.updated;
      }
      const code = byId.get(cellId)?.code ?? currentCell?.code;
      if (!cellId) toast.success(`Адрес снят у ${countLabel(updated, PRODUCT_FORMS)}`);
      else if (updated === 0) toast.success('Товары уже лежат в этой ячейке');
      else toast.success(`В ячейке${code ? ` ${code}` : ''}: ${countLabel(updated, PRODUCT_FORMS)}`);
      onDone?.(updated);
      onClose();
    } catch (err) {
      const message = storageCellErrorMessage(err, 'Не удалось назначить ячейку');
      toast.error(
        updated > 0
          ? `${message}. Уже назначено: ${countLabel(updated, PRODUCT_FORMS)}, повторите для остальных`
          : message,
      );
    } finally {
      // Часть чанков могла записаться до сбоя — списки и счётчики ячеек обновляем в любом случае.
      invalidate();
      setBusy(false);
    }
  };

  const clearing = touched && !cellId;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={productIds.length === 0 || !touched}>
            {clearing ? 'Снять адрес' : 'Назначить'}
          </Button>
        </>
      }
    >
      <StorageCellSelect
        warehouseId={warehouseId}
        value={cellId}
        onChange={(id) => {
          setCellId(id);
          setTouched(true);
        }}
        canCreate
        currentCell={currentCell}
        emptyLabel="Без ячейки (снять адрес)"
      />
    </Modal>
  );
}
