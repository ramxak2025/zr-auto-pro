import { useRef, useState } from 'react';
import type { Product } from '../../types';
import type { PurchaseOrderLineValue, PurchaseOrderPickerLine } from '../../../../shared/utils/purchaseOrderInput';

export interface ProcurementPickerOptions {
  lines: PurchaseOrderPickerLine[];
  onConfirm: (product: Product, value: PurchaseOrderLineValue) => void;
  context?: 'order' | 'delivery';
}
export interface PickerDraft {
  product: Product;
  quantityText: string;
  costPriceText: string;
}
/** Unconfirmed text belongs to the picker, never to the financial document. */
export function useProcurementPickerDrafts(options?: ProcurementPickerOptions) {
  const drafts = useRef<Record<string, PickerDraft>>({});
  const [active, setActive] = useState<Product | null>(null);
  const [notice, setNotice] = useState('');
  const activeRef = useRef<Product | null>(null);
  const open = (product: Product) => {
    const line = options?.lines.find((line) => line.productId === product.id);
    drafts.current[product.id] ??= {
      product,
      quantityText: line?.quantityText ?? '1',
      costPriceText: line?.costPriceText ?? String(product.costPrice),
    };
    activeRef.current = product;
    setActive(product);
    setNotice('');
  };
  const cancel = (expectedId?: string) => {
    if (expectedId && activeRef.current?.id !== expectedId) return;
    const pending = activeRef.current ?? Object.values(drafts.current)[0]?.product;
    if (pending) delete drafts.current[pending.id];
    activeRef.current = null;
    setActive(null);
    setNotice('');
  };
  const confirm = (product: Product, value: PurchaseOrderLineValue) => {
    if (activeRef.current?.id !== product.id) throw new Error('Выбрана другая позиция. Проверьте её значения.');
    options?.onConfirm(product, value);
    activeRef.current = null;
    delete drafts.current[product.id];
    setActive(null);
    setNotice('');
  };
  const close = (onClose: () => void, restore: (product: Product) => void) => {
    const pending = (active && drafts.current[active.id]) || Object.values(drafts.current)[0];
    if (options && pending) {
      activeRef.current = pending.product;
      setActive(pending.product);
      setNotice('Добавьте позицию или отмените изменения перед закрытием.');
      restore(pending.product);
      return;
    }
    onClose();
  };
  return { active, notice, drafts, open, cancel, confirm, close };
}
