import { useEffect, useRef, useState } from 'react';
import type { Product } from '../../types';
import { Button, Input, Field } from '../../ui';
import { unitLabel } from '../../utils/units';
import {
  formatPurchaseOrderMoney,
  MIN_PURCHASE_ORDER_QUANTITY,
  parsePurchaseOrderQuantity,
  purchaseOrderLineValue,
  type PurchaseOrderLineValue,
  type PurchaseOrderPickerLine,
} from '../../../../shared/utils/purchaseOrderInput';

export default function PurchaseOrderLineEditor({
  product,
  line,
  onConfirm,
  onCancel,
}: {
  product: Product;
  line?: PurchaseOrderPickerLine;
  onConfirm: (value: PurchaseOrderLineValue) => void;
  onCancel: () => void;
}) {
  const [quantityText, setQuantityText] = useState(line?.quantityText ?? '1');
  const [costPriceText, setCostPriceText] = useState(line?.costPriceText ?? String(product.costPrice));
  const latest = useRef({
    quantityText: line?.quantityText ?? '1',
    costPriceText: line?.costPriceText ?? String(product.costPrice),
  });
  const [error, setError] = useState('');
  const quantityRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    quantityRef.current?.focus();
  }, []);
  const minimum = Math.max(MIN_PURCHASE_ORDER_QUANTITY, line?.receivedQuantity ?? 0);
  const value = purchaseOrderLineValue(quantityText, costPriceText, minimum);
  const confirm = () => {
    const input = purchaseOrderLineValue(latest.current.quantityText, latest.current.costPriceText, minimum);
    if (!input) {
      setError(
        parsePurchaseOrderQuantity(latest.current.quantityText) === null
          ? 'Количество должно быть больше нуля, до 3 знаков после запятой.'
          : Number(latest.current.quantityText.replace(',', '.')) < minimum
            ? `Уже принято ${minimum}. Уменьшить количество ниже нельзя.`
            : 'Укажите закупочную цену от 0, до 2 знаков после запятой.',
      );
      return;
    }
    try {
      onConfirm(input);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить позицию. Повторите.');
    }
  };
  return (
    <section aria-label="Параметры товара в заказе" className="space-y-5">
      <div>
        <h3 className="break-words text-base font-semibold text-ink">{product.name}</h3>
        <p className="mt-2 text-sm text-ink-2">
          Цена за единицу в этом заказе. Карточка товара и остаток не меняются до приёмки.
        </p>
      </div>
      <Field label={`Количество, ${unitLabel(product.unit)}`} htmlFor="po-picker-quantity">
        <Input
          ref={quantityRef}
          id="po-picker-quantity"
          inputMode="decimal"
          value={quantityText}
          onChange={(e) => {
            latest.current.quantityText = e.target.value;
            setQuantityText(e.target.value);
            setError('');
          }}
        />
      </Field>
      <Field label={`Закупочная цена за ${unitLabel(product.unit)}, ₽`} htmlFor="po-picker-cost">
        <Input
          id="po-picker-cost"
          inputMode="decimal"
          value={costPriceText}
          onChange={(e) => {
            latest.current.costPriceText = e.target.value;
            setCostPriceText(e.target.value);
            setError('');
          }}
        />
      </Field>
      {(line?.receivedQuantity ?? 0) > 0 && (
        <p className="text-xs text-ink-3">Уже принято: {line?.receivedQuantity}. Это минимальное количество.</p>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-sm text-ink-2">Итого за позицию</span>
        <strong className="tabular-nums text-ink" aria-live="polite">
          {value ? formatPurchaseOrderMoney(value.quantity * value.costPrice) : '—'}
        </strong>
      </div>
      {error && (
        <p role="alert" className="text-sm text-bad-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          Отмена
        </Button>
        <Button onClick={confirm}>{line ? 'Сохранить позицию' : 'Добавить в заказ'}</Button>
      </div>
    </section>
  );
}
