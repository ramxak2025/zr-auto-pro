import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Package, Search, Sparkles, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { purchaseOrdersApi, suppliersApi, productsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import InlineLoader from '../components/InlineLoader';
import Modal from '../components/Modal';
import type { PurchaseOrder, PaginatedResponse, Supplier, Product, PurchaseOrderSuggestionGroup } from '../types';
import { formatMoney } from '../../../shared/utils/formatters';

interface LineDraft {
  productId: string;
  name: string;
  quantity: number;
  costPrice: number;
}

export default function PurchaseOrderEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const isEdit = !!id;

  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<LineDraft[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Создание/правка заказа — suppliers_manage (волна Битрикс24; байпас
  // superadmin/director — внутри hasPermission, admin — по матрице роли).
  useEffect(() => {
    if (!hasPermission('suppliers_manage')) {
      navigate('/purchase-orders', { replace: true });
    }
  }, [hasPermission, navigate]);

  // Suppliers for the select.
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', { search: '', page: 1, limit: 1000 }],
    queryFn: () => suppliersApi.getAll({ page: 1, limit: 1000 }),
    select: (res) => (res.data as PaginatedResponse<Supplier>).data,
    staleTime: 5 * 60 * 1000,
  });

  // Full product catalogue for the picker (shares cache with the cash screen).
  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['products-all'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 1000 });
      return res.data?.data ?? (res.data as unknown as Product[]);
    },
    staleTime: 60_000,
  });

  // When editing, load the existing draft.
  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => purchaseOrdersApi.getById(id!),
    select: (res) => res.data as PurchaseOrder,
    enabled: isEdit,
  });

  // Hydrate the form from the loaded draft once.
  useEffect(() => {
    if (!isEdit || hydrated || !existing) return;
    if (existing.status !== 'draft') {
      toast.error('Заказ уже оформлен — редактирование недоступно');
      navigate(`/purchase-orders/${existing.id}`, { replace: true });
      return;
    }
    setSupplierId(existing.supplierId);
    setNote(existing.note || '');
    setItems(
      (existing.items || []).map((it) => ({
        productId: it.productId,
        name: it.name,
        quantity: it.quantity,
        costPrice: it.costPrice,
      })),
    );
    setHydrated(true);
  }, [isEdit, hydrated, existing, navigate]);

  const total = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.costPrice) || 0), 0),
    [items],
  );

  const updateLine = (idx: number, patch: Partial<LineDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeLine = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const addProduct = (product: Product) => {
    setItems((prev) => {
      if (prev.some((it) => it.productId === product.id)) return prev;
      return [...prev, { productId: product.id, name: product.name, quantity: 1, costPrice: product.costPrice }];
    });
  };

  const applySuggestion = (group: PurchaseOrderSuggestionGroup) => {
    if (group.supplierId) setSupplierId(group.supplierId);
    setItems(
      group.items.map((it) => ({
        productId: it.productId,
        name: it.name,
        quantity: it.suggestedQuantity > 0 ? it.suggestedQuantity : 1,
        costPrice: it.costPrice,
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
    if (items.some((it) => !(Number(it.quantity) > 0))) {
      toast.error('Количество должно быть больше нуля');
      return false;
    }
    return true;
  };

  const buildPayload = () => ({
    supplierId,
    note: note.trim() || undefined,
    items: items.map((it) => ({
      productId: it.productId,
      quantity: Number(it.quantity),
      costPrice: Number(it.costPrice) || 0,
    })),
  });

  // Persist the draft (create or update) and return the saved order.
  const persist = async (): Promise<PurchaseOrder> => {
    const payload = buildPayload();
    if (isEdit) {
      const res = await purchaseOrdersApi.update(id!, payload);
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

  if (isEdit && loadingExisting) {
    return <InlineLoader minHeight="min-h-[60vh]" />;
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/purchase-orders')}
          className="p-2 -ml-2 rounded-lg hover:bg-gray-100 text-gray-600"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {isEdit ? 'Редактировать заказ' : 'Новый заказ поставщику'}
        </h1>
      </div>

      {/* Supplier + suggestions */}
      <div className="card card-body space-y-4">
        <div>
          <label className="label">Поставщик *</label>
          <div className="flex gap-2">
            <select className="input flex-1" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Выберите поставщика</option>
              {(suppliers || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {!isEdit && (
              <button type="button" onClick={() => setSuggestOpen(true)} className="btn-secondary whitespace-nowrap">
                <Sparkles className="w-4 h-4" />
                Дозаказ
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="label">Комментарий</label>
          <textarea
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Заметка к заказу..."
          />
        </div>
      </div>

      {/* Line items */}
      <div className="card card-body space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Товары</h2>
          <button type="button" onClick={() => setPickerOpen(true)} className="btn-secondary btn-sm">
            <Plus className="w-4 h-4" />
            Добавить товар
          </button>
        </div>

        {items.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Нет товаров в заказе</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={it.productId} className="rounded-xl border border-gray-100 bg-white p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-900 min-w-0">{it.name}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    className="p-1 -mr-1 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 flex-shrink-0"
                    aria-label="Удалить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-end gap-3">
                  <div className="w-24">
                    <label className="label !mb-1 text-xs">Кол-во</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      className="input tabular-nums"
                      aria-label={`Количество — ${it.name}`}
                      value={it.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.valueAsNumber || 0 })}
                    />
                  </div>
                  <div className="w-32">
                    <label className="label !mb-1 text-xs">Цена закупки</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      className="input tabular-nums"
                      aria-label={`Цена закупки — ${it.name}`}
                      value={it.costPrice}
                      onChange={(e) => updateLine(idx, { costPrice: e.target.valueAsNumber || 0 })}
                    />
                  </div>
                  <div className="flex-1 text-right">
                    <p className="text-xs text-gray-500 mb-1">Сумма</p>
                    <p className="text-sm font-semibold text-gray-900 tabular-nums">
                      {formatMoney((Number(it.quantity) || 0) * (Number(it.costPrice) || 0))}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-100 pt-3">
            <span className="text-sm font-medium text-gray-600">Итого</span>
            <span className="text-lg font-bold text-gray-900 tabular-nums">{formatMoney(total)}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
        <button type="button" onClick={onSaveDraft} disabled={isBusy} className="btn-secondary">
          {saveDraftMutation.isPending ? 'Сохранение...' : 'Сохранить черновик'}
        </button>
        <button type="button" onClick={onOrder} disabled={isBusy} className="btn-primary">
          {orderMutation.isPending ? 'Оформление...' : 'Оформить заказ'}
        </button>
      </div>

      {/* Product picker */}
      <ProductPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={allProducts || []}
        selectedIds={items.map((it) => it.productId)}
        onSelect={addProduct}
      />

      {/* Suggestions */}
      <SuggestionsModal isOpen={suggestOpen} onClose={() => setSuggestOpen(false)} onApply={applySuggestion} />
    </div>
  );
}

// ─── Product picker ──────────────────────────────────────────────────────────

interface ProductPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  selectedIds: string[];
  onSelect: (product: Product) => void;
}

function ProductPickerModal({ isOpen, onClose, products, selectedIds, onSelect }: ProductPickerModalProps) {
  const [search, setSearch] = useState('');

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q)))
      : products;
    return list.slice(0, 100);
  }, [products, search]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Добавить товар" size="lg">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск товара..."
            className="input pl-10 w-full"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1 space-y-1.5">
          {results.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Ничего не найдено</p>
            </div>
          ) : (
            results.map((p) => {
              const added = selectedIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={added}
                  onClick={() => onSelect(p)}
                  className={`w-full flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${
                    added
                      ? 'border-gray-100 bg-gray-50 opacity-60 cursor-default'
                      : 'border-gray-100 bg-white hover:border-primary-300 hover:bg-primary-50/30'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-500 tabular-nums">
                      Остаток: {p.stock} {p.unit || 'шт'} · закупка {formatMoney(p.costPrice)}
                    </p>
                  </div>
                  {added ? (
                    <span className="text-xs font-medium text-primary-600 flex-shrink-0">Добавлен</span>
                  ) : (
                    <Plus className="w-4 h-4 text-primary-600 flex-shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Reorder suggestions ─────────────────────────────────────────────────────

interface SuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (group: PurchaseOrderSuggestionGroup) => void;
}

function SuggestionsModal({ isOpen, onClose, onApply }: SuggestionsModalProps) {
  const { data: groups, isLoading } = useQuery({
    queryKey: ['purchase-order-suggestions'],
    queryFn: () => purchaseOrdersApi.suggestions(),
    select: (res) => res.data as PurchaseOrderSuggestionGroup[],
    enabled: isOpen,
    staleTime: 60_000,
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Дозаказ по дефициту" size="lg">
      {isLoading ? (
        <InlineLoader />
      ) : !groups || groups.length === 0 ? (
        <div className="text-center py-10 text-gray-500">
          <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Нет товаров ниже минимального остатка</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group, gi) => (
            <div key={group.supplierId || `none-${gi}`} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-900">{group.supplierName || 'Без поставщика'}</span>
                <button type="button" onClick={() => onApply(group)} className="btn-primary btn-sm">
                  Заполнить
                </button>
              </div>
              <ul className="space-y-1">
                {group.items.map((it) => (
                  <li key={it.productId} className="flex items-center justify-between text-xs text-gray-600">
                    <span className="truncate">{it.name}</span>
                    <span className="flex-shrink-0 ml-2 tabular-nums">
                      {it.stock}/{it.minStock} → +{it.suggestedQuantity}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
