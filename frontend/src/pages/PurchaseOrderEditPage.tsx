import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Package, ShoppingCart, Sparkles, Send } from 'lucide-react';
import toast from 'react-hot-toast';

import { purchaseOrdersApi, suppliersApi, productsApi, warehousesApi } from '../api/services';
import { loadProductCatalog } from '../../../shared/api/productCatalog';
import { useAuth } from '../contexts/AuthContext';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  QueryState,
  Select,
  SkeletonCard,
  Textarea,
} from '../ui';
import type { DataTableColumn } from '../ui';
import ProductPickerDrawer from '../components/checks/ProductPickerDrawer';
import type { PurchaseOrder, Product, PurchaseOrderSuggestionGroup, Warehouse } from '../types';
import { formatQty } from '../utils/units';
import {
  MIN_PURCHASE_ORDER_QUANTITY,
  parsePurchaseOrderCost,
  parsePurchaseOrderQuantity,
  purchaseOrderLineValue,
  formatPurchaseOrderMoney,
  type PurchaseOrderLineValue,
} from '../../../shared/utils/purchaseOrderInput';

/** Строка черновика: количество и цена — строки ввода («12,5» печатается чисто), числа — при отправке. */
interface LineDraft {
  productId: string;
  name: string;
  quantity: string;
  costPrice: string;
  received: number;
}

const lineQty = (line: LineDraft): number | null => parsePurchaseOrderQuantity(line.quantity);
const linePrice = (line: LineDraft): number | null => parsePurchaseOrderCost(line.costPrice);
const lineTotal = (line: LineDraft): number | null => {
  const value = purchaseOrderLineValue(
    line.quantity,
    line.costPrice,
    Math.max(MIN_PURCHASE_ORDER_QUANTITY, line.received),
  );
  return value ? value.quantity * value.costPrice : null;
};

export default function PurchaseOrderEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const isEdit = !!id;

  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<LineDraft[]>([]);
  const itemsRef = useRef(items);
  const writeItems = useCallback((change: LineDraft[] | ((previous: LineDraft[]) => LineDraft[])) => {
    const next = typeof change === 'function' ? change(itemsRef.current) : change;
    itemsRef.current = next;
    setItems(next);
  }, []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerWarehouseId, setPickerWarehouseId] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Создание/правка заказа — suppliers_manage (волна Битрикс24; байпас
  // superadmin/director — внутри hasPermission, admin — по матрице роли).
  useEffect(() => {
    if (!hasPermission('suppliers_manage')) {
      navigate('/purchase-orders', { replace: true });
    }
  }, [hasPermission, navigate]);

  // Поставщики для селекта. В кеш — массив (тот же ключ и форма, что в
  // PurchaseOrdersPage): ключ 'suppliers' в whitelist persistent-кеша.
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', { search: '', page: 1, limit: 1000 }],
    queryFn: async () => {
      const res = await suppliersApi.getAll({ page: 1, limit: 1000 });
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Полный каталог для пикера (общий кеш с Кассой).
  const {
    data: allProducts,
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useQuery<Product[]>({
    queryKey: ['products-all'],
    queryFn: () => loadProductCatalog(productsApi.getAll, { warehouseId: 'all' }),
    staleTime: 60_000,
  });

  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (!warehouses?.length) return;
    if (!warehouses.some((w) => w.id === pickerWarehouseId)) {
      setPickerWarehouseId((warehouses.find((w) => w.kind === 'main') ?? warehouses[0]).id);
    }
  }, [warehouses, pickerWarehouseId]);
  const pickerProducts = useMemo(() => {
    const list = allProducts ?? [];
    if (!pickerWarehouseId) return list;
    const isMain = warehouses?.find((w) => w.id === pickerWarehouseId)?.kind === 'main';
    return list.filter((p) => p.warehouseId === pickerWarehouseId || (isMain && !p.warehouseId));
  }, [allProducts, pickerWarehouseId, warehouses]);

  // Правка — грузим существующий черновик.
  const {
    data: existing,
    isLoading: loadingExisting,
    isError: existingError,
    isFetching: existingFetching,
    refetch: refetchExisting,
  } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: async () => (await purchaseOrdersApi.getById(id as string)).data as PurchaseOrder,
    enabled: isEdit,
  });

  // Гидрируем форму из черновика один раз.
  useEffect(() => {
    if (!isEdit || hydrated || !existing) return;
    if (existing.status !== 'draft') {
      toast.error('Заказ уже оформлен — редактирование недоступно');
      navigate(`/purchase-orders/${existing.id}`, { replace: true });
      return;
    }
    setSupplierId(existing.supplierId);
    setNote(existing.note || '');
    writeItems(
      (existing.items || []).map((it) => ({
        productId: it.productId,
        name: it.name,
        quantity: String(it.quantity),
        costPrice: String(it.costPrice),
        received: it.receivedQuantity ?? 0,
      })),
    );
    setHydrated(true);
  }, [isEdit, hydrated, existing, navigate, writeItems]);

  const total = useMemo(() => {
    let sum = 0;
    for (const item of items) {
      const amount = lineTotal(item);
      if (amount === null) return null;
      sum += amount;
    }
    return sum;
  }, [items]);

  const updateLine = (idx: number, patch: Partial<LineDraft>) => {
    writeItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeLine = (idx: number) => {
    if ((itemsRef.current[idx]?.received ?? 0) > 0) {
      toast.error('Уже принятую позицию нельзя удалить');
      return;
    }
    writeItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const addProduct = (product: Product) => {
    writeItems((prev) => {
      if (prev.some((it) => it.productId === product.id)) return prev;
      return [
        ...prev,
        { productId: product.id, name: product.name, quantity: '1', costPrice: String(product.costPrice), received: 0 },
      ];
    });
  };

  const updatePickerLine = (product: Product, value: PurchaseOrderLineValue) => {
    const received = itemsRef.current.find((line) => line.productId === product.id)?.received ?? 0;
    if (value.quantity < received) throw new Error(`Уже принято ${received}. Уменьшить количество ниже нельзя.`);
    writeItems((previous) => {
      const next: LineDraft = {
        productId: product.id,
        name: product.name,
        quantity: String(value.quantity),
        costPrice: String(value.costPrice),
        received,
      };
      return previous.some((line) => line.productId === product.id)
        ? previous.map((line) => (line.productId === product.id ? next : line))
        : [...previous, next];
    });
  };

  const applySuggestion = (group: PurchaseOrderSuggestionGroup) => {
    if (group.supplierId) setSupplierId(group.supplierId);
    writeItems(
      group.items.map((it) => ({
        productId: it.productId,
        name: it.name,
        quantity: String(it.suggestedQuantity > 0 ? it.suggestedQuantity : 1),
        costPrice: String(it.costPrice),
        received: 0,
      })),
    );
    setSuggestOpen(false);
    if (!group.supplierId) toast('Выберите поставщика для дозаказа', { icon: 'ℹ️' });
  };

  const validate = (): boolean => {
    if (!supplierId) {
      toast.error('Выберите поставщика');
      return false;
    }
    if (items.length === 0) {
      toast.error('Добавьте хотя бы один товар');
      return false;
    }
    if (
      itemsRef.current.some(
        (it) => !purchaseOrderLineValue(it.quantity, it.costPrice, Math.max(MIN_PURCHASE_ORDER_QUANTITY, it.received)),
      )
    ) {
      toast.error(
        'Проверьте количество (от 0,001) и закупочную цену (от 0, до 2 знаков). Уже принятое количество нельзя уменьшить.',
      );
      return false;
    }
    return true;
  };

  const buildPayload = () => ({
    supplierId,
    note: note.trim() || undefined,
    items: itemsRef.current.map((it) => {
      const value = purchaseOrderLineValue(
        it.quantity,
        it.costPrice,
        Math.max(MIN_PURCHASE_ORDER_QUANTITY, it.received),
      );
      if (!value) throw new Error('Проверьте количество и закупочную цену.');
      return { productId: it.productId, ...value };
    }),
  });

  // Сохранить черновик (создать или обновить) и вернуть заказ.
  const persist = async (): Promise<PurchaseOrder> => {
    const payload = buildPayload();
    if (isEdit) {
      const res = await purchaseOrdersApi.update(id as string, payload);
      return res.data;
    }
    const res = await purchaseOrdersApi.create(payload);
    return res.data;
  };

  const saveDraftMutation = useMutation({
    mutationFn: persist,
    onSuccess: (po) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order', po.id] });
      toast.success('Черновик сохранён');
      navigate(`/purchase-orders/${po.id}`);
    },
    onError: () => toast.error('Не удалось сохранить заказ'),
  });

  const orderMutation = useMutation({
    mutationFn: async (): Promise<PurchaseOrder> => {
      const po = await persist();
      const res = await purchaseOrdersApi.order(po.id);
      return res.data;
    },
    onSuccess: (po) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-order', po.id] });
      toast.success('Заказ оформлен');
      navigate(`/purchase-orders/${po.id}`);
    },
    onError: () => toast.error('Не удалось оформить заказ'),
  });

  const isBusy = saveDraftMutation.isPending || orderMutation.isPending;

  const onSaveDraft = () => {
    if (!validate()) return;
    saveDraftMutation.mutate();
  };

  const onOrder = () => {
    if (!validate()) return;
    orderMutation.mutate();
  };

  const title = isEdit ? 'Редактировать заказ' : 'Новый заказ поставщику';

  if (isEdit && (loadingExisting || existingError)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <PageHeader title={title} icon={ShoppingCart} backTo="/purchase-orders" />
        <QueryState
          isLoading={loadingExisting}
          isError={existingError}
          onRetry={() => refetchExisting()}
          isFetching={existingFetching}
          errorTitle="Не удалось загрузить заказ"
          loader={
            <div className="space-y-5">
              <SkeletonCard lines={3} />
              <SkeletonCard lines={4} />
            </div>
          }
        >
          <></>
        </QueryState>
      </div>
    );
  }

  const lineColumns: DataTableColumn<LineDraft>[] = [
    {
      key: 'name',
      header: 'Товар',
      render: (l) => <span className="font-medium text-ink">{l.name}</span>,
      footer: () => 'Итого',
    },
    {
      key: 'quantity',
      header: 'Кол-во',
      numeric: true,
      interactive: true,
      width: 96,
      render: (l, idx) => (
        <Input
          size="sm"
          inputMode="decimal"
          aria-label={`Количество — ${l.name}`}
          value={l.quantity}
          invalid={lineQty(l) === null || (lineQty(l) ?? 0) < l.received}
          onChange={(e) => updateLine(idx, { quantity: e.target.value })}
          className="text-right tabular-nums"
        />
      ),
    },
    {
      key: 'costPrice',
      header: 'Цена закупки',
      numeric: true,
      interactive: true,
      width: 120,
      render: (l, idx) => (
        <Input
          size="sm"
          inputMode="decimal"
          aria-label={`Цена закупки — ${l.name}`}
          value={l.costPrice}
          invalid={linePrice(l) === null}
          onChange={(e) => updateLine(idx, { costPrice: e.target.value })}
          className="text-right tabular-nums"
        />
      ),
    },
    {
      key: 'total',
      header: 'Сумма',
      numeric: true,
      hideBelow: 'sm',
      width: 120,
      render: (l) => (
        <span className="font-medium tabular-nums text-ink">
          {lineTotal(l) === null ? '—' : formatPurchaseOrderMoney(lineTotal(l) as number)}
        </span>
      ),
      footer: () => <span className="tabular-nums">{total === null ? '—' : formatPurchaseOrderMoney(total)}</span>,
    },
    {
      key: 'remove',
      header: <span className="sr-only">Убрать</span>,
      interactive: true,
      align: 'right',
      width: 48,
      render: (l, idx) => (
        <IconButton
          label={`Убрать ${l.name}`}
          disabled={l.received > 0}
          icon={Trash2}
          size="sm"
          variant="danger"
          onClick={() => removeLine(idx)}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader
        title={title}
        icon={ShoppingCart}
        backTo="/purchase-orders"
        subtitle={
          items.length > 0
            ? `${items.length} поз. · ${total === null ? 'проверьте позиции' : formatPurchaseOrderMoney(total)}`
            : 'Черновик: поставщик, позиции, цены закупки'
        }
        actions={
          <>
            <Button variant="secondary" onClick={onSaveDraft} loading={saveDraftMutation.isPending} disabled={isBusy}>
              Сохранить черновик
            </Button>
            <Button icon={Send} onClick={onOrder} loading={orderMutation.isPending} disabled={isBusy}>
              Оформить заказ
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader title="Поставщик" subtitle="У кого заказываем и что важно знать" />
        <CardBody className="space-y-4">
          <Field label="Поставщик" htmlFor="po-supplier" required>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                id="po-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                placeholder="Выберите поставщика"
                options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
                className="sm:flex-1"
              />
              {!isEdit && (
                <Button
                  variant="secondary"
                  icon={Sparkles}
                  onClick={() => setSuggestOpen(true)}
                  className="whitespace-nowrap"
                >
                  Дозаказ по дефициту
                </Button>
              )}
            </div>
          </Field>

          <Field label="Комментарий" htmlFor="po-note">
            <Textarea
              id="po-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Заметка к заказу…"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Товары"
          subtitle={items.length > 0 ? `${items.length} поз.` : 'Позиции заказа и цены закупки'}
          divider={items.length > 0}
          actions={
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setPickerOpen(true)}>
              Добавить товар
            </Button>
          }
        />
        {items.length === 0 ? (
          <CardBody padding="sm">
            <EmptyState
              compact
              icon={Package}
              title="В заказе пока нет товаров"
              description="Добавьте позиции из каталога или заполните заказ по дефициту"
            />
          </CardBody>
        ) : (
          <DataTable bare rows={items} rowKey={(l) => l.productId} columns={lineColumns} caption="Позиции заказа" />
        )}
      </Card>

      <ProductPickerDrawer
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={pickerProducts}
        warehouses={warehouses}
        selectedWarehouseId={pickerWarehouseId}
        onSelectWarehouse={setPickerWarehouseId}
        selectedIds={items.map((it) => it.productId)}
        onSelectProduct={addProduct}
        closeOnSelect={false}
        priceKind="cost"
        purchaseOrder={{
          lines: items.map((line) => ({
            productId: line.productId,
            quantityText: line.quantity,
            costPriceText: line.costPrice,
            receivedQuantity: line.received,
          })),
          onConfirm: updatePickerLine,
        }}
        isLoading={productsLoading}
        isError={productsError}
        onRetry={() => refetchProducts()}
      />

      <SuggestionsModal isOpen={suggestOpen} onClose={() => setSuggestOpen(false)} onApply={applySuggestion} />
    </div>
  );
}

// ─── Дозаказ по дефициту ─────────────────────────────────────────────────────

interface SuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (group: PurchaseOrderSuggestionGroup) => void;
}

function SuggestionsModal({ isOpen, onClose, onApply }: SuggestionsModalProps) {
  const {
    data: groups,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['purchase-order-suggestions'],
    queryFn: async () => (await purchaseOrdersApi.suggestions()).data as PurchaseOrderSuggestionGroup[],
    enabled: isOpen,
    staleTime: 60_000,
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Дозаказ по дефициту"
      description="Товары ниже минимального остатка, сгруппированные по поставщику"
      size="lg"
    >
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        isEmpty={!groups || groups.length === 0}
        empty={{
          icon: Sparkles,
          title: 'Дефицита нет',
          description: 'Все товары с минимальным остатком в наличии',
        }}
        minHeight="py-10"
      >
        <div className="space-y-3">
          {(groups ?? []).map((group, gi) => (
            <Card key={group.supplierId || `none-${gi}`} as="article" padding="sm">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="truncate text-sm font-semibold text-ink">{group.supplierName || 'Без поставщика'}</h3>
                <Button variant="secondary" size="sm" onClick={() => onApply(group)}>
                  Заполнить
                </Button>
              </div>
              <ul className="divide-y divide-line text-sm">
                {group.items.map((it) => (
                  <li key={it.productId} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="truncate text-ink-2">{it.name}</span>
                    <span className="flex-shrink-0 tabular-nums text-ink-3">
                      {formatQty(it.stock)} / {formatQty(it.minStock)} →{' '}
                      <span className="font-medium text-ink">+{formatQty(it.suggestedQuantity)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </QueryState>
    </Modal>
  );
}
