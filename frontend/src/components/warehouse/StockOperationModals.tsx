/**
 * Операции с остатком одного товара: списание, перенос на другой склад,
 * инвентаризация. Каждая — форма в Modal с футером «Отмена / действие».
 */
import { useState, type FormEvent } from 'react';
import { AlertTriangle, Recycle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Product, Warehouse as WarehouseRecord } from '../../types';
import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { RadioGroup } from '../../ui/RadioGroup';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Money } from '../../ui/Money';
import { cn } from '../../ui/cn';
import { formatQty, unitLabel } from '../../utils/units';
import { parseNumberInput } from './format';

function ProductSummary({ product, stockLabel = 'Остаток' }: { product: Product; stockLabel?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
      <p className="font-medium text-ink">{product.name}</p>
      <p className="text-ink-3">
        {stockLabel}:{' '}
        <span className="font-medium tabular-nums text-ink-2">
          {formatQty(product.stock)} {unitLabel(product.unit)}
        </span>
      </p>
    </div>
  );
}

// ─── Списание ────────────────────────────────────────────────────────────────

interface WriteoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  onSubmit: (data: { quantity: number; reason: string; recordAsExpense: boolean }) => void;
  isLoading: boolean;
}

type WriteoffMode = 'expense' | 'plain';

export function WriteoffModal({ isOpen, onClose, product, onSubmit, isLoading }: WriteoffModalProps) {
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<WriteoffMode>('expense');
  const unit = unitLabel(product.unit);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const qty = parseNumberInput(quantity);
    if (!qty || qty <= 0) {
      toast.error('Введите количество');
      return;
    }
    if (qty > product.stock) {
      toast.error('Количество превышает остаток');
      return;
    }
    if (!reason.trim()) {
      toast.error('Укажите причину списания');
      return;
    }
    onSubmit({ quantity: qty, reason: reason.trim(), recordAsExpense: mode === 'expense' });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Списание товара"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Отмена
          </Button>
          <Button type="submit" form="writeoff-form" loading={isLoading}>
            Списать
          </Button>
        </>
      }
    >
      <form id="writeoff-form" onSubmit={handleSubmit} className="space-y-4">
        <ProductSummary product={product} />
        <Field label={`Количество, ${unit}`} htmlFor="writeoff-qty" required>
          <Input
            id="writeoff-qty"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="tabular-nums"
          />
        </Field>
        <Field label="Причина" htmlFor="writeoff-reason" required>
          <Textarea
            id="writeoff-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Брак, потеря, просрочка…"
          />
        </Field>
        <RadioGroup<WriteoffMode>
          label="Учёт"
          value={mode}
          onChange={setMode}
          options={[
            {
              value: 'expense',
              label: 'По закупке (как расход)',
              description: 'Спишет товар и создаст запись в расходах на сумму закупки. Прибыль уменьшится.',
            },
            { value: 'plain', label: 'Просто списать', description: 'Уберёт остаток без проводки в расходы.' },
          ]}
        />
      </form>
    </Modal>
  );
}

// ─── Перенос: основной → брак / Б/У ──────────────────────────────────────────

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  warehouses: WarehouseRecord[];
  sourceWarehouseId: string;
  onSubmit: (data: {
    type: 'defect_transfer' | 'used_transfer';
    targetWarehouseId: string;
    quantity: number;
    purchasePrice?: number;
    reason?: string;
  }) => void;
  isLoading: boolean;
}

export function TransferModal({ isOpen, onClose, product, warehouses, onSubmit, isLoading }: TransferModalProps) {
  const defectWh = warehouses.find((w) => w.kind === 'defect');
  const usedWh = warehouses.find((w) => w.kind === 'used');
  const [mode, setMode] = useState<'defect' | 'used'>(defectWh ? 'defect' : 'used');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const qty = parseNumberInput(quantity);
    if (!qty || qty <= 0) {
      toast.error('Введите количество');
      return;
    }
    if (qty > product.stock) {
      toast.error('Количество превышает остаток');
      return;
    }
    const target = mode === 'defect' ? defectWh : usedWh;
    if (!target) {
      toast.error(mode === 'defect' ? 'Склад брака не найден' : 'Склад Б/У не найден');
      return;
    }
    onSubmit({
      type: mode === 'defect' ? 'defect_transfer' : 'used_transfer',
      targetWarehouseId: target.id,
      quantity: qty,
      purchasePrice: product.costPrice,
      reason: reason.trim() || undefined,
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Перенос на другой склад"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Отмена
          </Button>
          <Button type="submit" form="transfer-form" loading={isLoading}>
            Перенести
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={handleSubmit} className="space-y-4">
        <ProductSummary product={product} stockLabel="Остаток на основном" />
        <Field label="Куда перенести">
          <SegmentedControl<'defect' | 'used'>
            aria-label="Целевой склад"
            fullWidth
            value={mode}
            onChange={setMode}
            options={[
              { value: 'defect', label: 'Брак', icon: AlertTriangle, disabled: !defectWh },
              { value: 'used', label: 'Б/У', icon: Recycle, disabled: !usedWh },
            ]}
          />
        </Field>
        <Field label={`Количество, ${unitLabel(product.unit)}`} htmlFor="transfer-qty" required>
          <Input
            id="transfer-qty"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="tabular-nums"
          />
        </Field>
        <Field label="Комментарий" htmlFor="transfer-reason">
          <Textarea
            id="transfer-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: дефект, не подошёл…"
          />
        </Field>
      </form>
    </Modal>
  );
}

// ─── Инвентаризация одного товара ────────────────────────────────────────────

interface InventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  onSubmit: (data: { actualStock: number; reason: string }) => void;
  isLoading: boolean;
}

export function InventoryModal({ isOpen, onClose, product, onSubmit, isLoading }: InventoryModalProps) {
  const [actualStock, setActualStock] = useState(product.stock.toString());
  const [reason, setReason] = useState('');

  const actual = parseNumberInput(actualStock) ?? 0;
  const diff = actual - product.stock;
  const amount = Math.abs(diff) * product.costPrice;
  const unit = unitLabel(product.unit);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const a = parseNumberInput(actualStock);
    if (a === null || a < 0) {
      toast.error('Введите корректный остаток');
      return;
    }
    if (!reason.trim()) {
      toast.error('Укажите причину');
      return;
    }
    onSubmit({ actualStock: a, reason: reason.trim() });
  }

  const stat = (label: string, value: string, tone?: 'ok' | 'bad' | 'accent') => (
    <div className="min-w-0">
      <p className="text-xs text-ink-3">{label}</p>
      <p
        className={cn(
          'mt-0.5 truncate text-lg font-semibold tabular-nums tracking-tight',
          tone === 'ok'
            ? 'text-ok-text'
            : tone === 'bad'
              ? 'text-bad-text'
              : tone === 'accent'
                ? 'text-accent-text'
                : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Инвентаризация"
      description={product.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Отмена
          </Button>
          <Button type="submit" form="inventory-form" loading={isLoading} disabled={diff === 0}>
            Провести инвентаризацию
          </Button>
        </>
      }
    >
      <form id="inventory-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="grid grid-cols-3 gap-3">
            {stat('В системе', `${formatQty(product.stock)} ${unit}`)}
            {stat('Факт', `${formatQty(actual)} ${unit}`, diff !== 0 ? 'accent' : undefined)}
            {stat(
              'Разница',
              diff === 0 ? '—' : `${diff > 0 ? '+' : '−'}${formatQty(Math.abs(diff))} ${unit}`,
              diff > 0 ? 'ok' : diff < 0 ? 'bad' : undefined,
            )}
          </div>
          {diff !== 0 && (
            <p className={cn('mt-3 text-sm', diff < 0 ? 'text-bad-text' : 'text-ok-text')}>
              {diff < 0 ? 'Сумма недостачи' : 'Сумма излишков'}: <Money value={amount} className="font-semibold" />{' '}
              <span className="text-ink-3">
                ({formatQty(Math.abs(diff))} {unit} × <Money value={product.costPrice} />)
              </span>
            </p>
          )}
        </div>

        <Field label={`Фактический остаток, ${unit}`} htmlFor="inventory-actual" required>
          <Input
            id="inventory-actual"
            inputMode="decimal"
            value={actualStock}
            onChange={(e) => setActualStock(e.target.value)}
            className="text-base font-semibold tabular-nums"
          />
        </Field>
        <Field label="Причина" htmlFor="inventory-reason" required>
          <Textarea
            id="inventory-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Причина корректировки…"
          />
        </Field>
      </form>
    </Modal>
  );
}
