import { useState, useRef, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Package,
  PackageMinus,
  ClipboardCheck,
  AlertTriangle,
  ImagePlus,
  X,
} from 'lucide-react';
import { productsApi, uploadsApi } from '../api/services';
import type { Product, PaginatedResponse } from '../types';
import SearchInput from '../components/SearchInput';
import Pagination from '../components/Pagination';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

// ---------------------------------------------------------------------------
// Product Form Modal
// ---------------------------------------------------------------------------

interface ProductFormData {
  name: string;
  category: string;
  photo?: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
}

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  product?: Product | null;
  onSubmit: (data: ProductFormData) => void;
  isLoading: boolean;
  categories: string[];
}

function ProductFormModal({
  isOpen,
  onClose,
  product,
  onSubmit,
  isLoading,
  categories,
}: ProductFormModalProps) {
  const [name, setName] = useState(product?.name || '');
  const [category, setCategory] = useState(product?.category || '');
  const [photo, setPhoto] = useState(product?.photo || '');
  const [uploading, setUploading] = useState(false);
  const [costPrice, setCostPrice] = useState(product?.costPrice?.toString() || '0');
  const [sellPrice, setSellPrice] = useState(product?.sellPrice?.toString() || '0');
  const [stock, setStock] = useState(product?.stock?.toString() || '0');
  const [minStock, setMinStock] = useState(product?.minStock?.toString() || '0');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handlePhotoUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Максимальный размер файла: 5 МБ');
      return;
    }
    setUploading(true);
    try {
      const res = await uploadsApi.upload(file, 'products');
      setPhoto(res.data.url);
      toast.success('Фото загружено');
    } catch {
      toast.error('Не удалось загрузить фото');
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Введите название товара');
      return;
    }
    onSubmit({
      name: name.trim(),
      category: category.trim(),
      photo: photo || undefined,
      costPrice: parseFloat(costPrice) || 0,
      sellPrice: parseFloat(sellPrice) || 0,
      stock: parseInt(stock) || 0,
      minStock: parseInt(minStock) || 0,
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product ? 'Редактировать товар' : 'Новый товар'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Фото товара
          </label>
          <div className="flex items-center gap-4">
            {photo ? (
              <div className="relative">
                <img
                  src={photo}
                  alt="Фото товара"
                  className="h-20 w-20 rounded-lg object-cover border border-gray-200"
                />
                <button
                  type="button"
                  onClick={() => setPhoto('')}
                  className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-primary-400 hover:text-primary-500"
              >
                {uploading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <>
                    <ImagePlus className="h-6 w-6" />
                    <span className="text-[10px] mt-1">Загрузить</span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePhotoUpload(file);
                e.target.value = '';
              }}
            />
            {!photo && (
              <p className="text-xs text-gray-500">
                JPEG, PNG, WebP. Макс. 5 МБ.
                <br />
                Все мастера смогут видеть фото.
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Название <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название товара"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Категория
          </label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Категория"
            list="product-categories"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <datalist id="product-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Закупочная цена
            </label>
            <input
              type="number"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              min="0"
              step="0.01"
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Продажная цена
            </label>
            <input
              type="number"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              min="0"
              step="0.01"
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Остаток
            </label>
            <input
              type="number"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              min="0"
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Мин. остаток
            </label>
            <input
              type="number"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              min="0"
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || uploading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading || uploading}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {product ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Writeoff Modal
// ---------------------------------------------------------------------------

interface WriteoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  onSubmit: (data: { quantity: number; reason: string }) => void;
  isLoading: boolean;
}

function WriteoffModal({
  isOpen,
  onClose,
  product,
  onSubmit,
  isLoading,
}: WriteoffModalProps) {
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const qty = parseInt(quantity);
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
    onSubmit({ quantity: qty, reason: reason.trim() });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Списание товара">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Товар: <span className="font-medium text-gray-900">{product.name}</span>
          <br />
          Текущий остаток:{' '}
          <span className="font-medium text-gray-900">{product.stock}</span>
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Количество <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min="1"
            max={product.stock}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Причина <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Укажите причину списания..."
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Списать
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Inventory Modal
// ---------------------------------------------------------------------------

interface InventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  onSubmit: (data: { actualStock: number; reason: string }) => void;
  isLoading: boolean;
}

function InventoryModal({
  isOpen,
  onClose,
  product,
  onSubmit,
  isLoading,
}: InventoryModalProps) {
  const [actualStock, setActualStock] = useState(product.stock.toString());
  const [reason, setReason] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const actual = parseInt(actualStock);
    if (isNaN(actual) || actual < 0) {
      toast.error('Введите корректный остаток');
      return;
    }
    if (!reason.trim()) {
      toast.error('Укажите причину инвентаризации');
      return;
    }
    onSubmit({ actualStock: actual, reason: reason.trim() });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Инвентаризация">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Товар: <span className="font-medium text-gray-900">{product.name}</span>
          <br />
          Текущий остаток (в системе):{' '}
          <span className="font-medium text-gray-900">{product.stock}</span>
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Фактический остаток <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            value={actualStock}
            onChange={(e) => setActualStock(e.target.value)}
            min="0"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Причина <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Укажите причину корректировки..."
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Провести инвентаризацию
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const LIMIT = 20;

export default function ProductsPage() {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [writeoffTarget, setWriteoffTarget] = useState<Product | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState<Product | null>(null);

  // ---- Queries ----

  const queryParams: Record<string, any> = {
    page,
    limit: LIMIT,
  };
  if (search) queryParams.search = search;
  if (categoryFilter) queryParams.category = categoryFilter;
  if (lowStockOnly) queryParams.lowStock = true;

  const {
    data: productsData,
    isLoading,
    isError,
  } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', queryParams],
    queryFn: async () => {
      const res = await productsApi.getAll(queryParams);
      return res.data;
    },
    keepPreviousData: true,
  } as any);

  const { data: categories = [] } = useQuery<string[]>({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const res = await productsApi.getCategories();
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  // ---- Mutations ----

  const createMutation = useMutation({
    mutationFn: (data: ProductFormData) => productsApi.create(data),
    onSuccess: () => {
      toast.success('Товар создан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      closeForm();
    },
    onError: () => toast.error('Не удалось создать товар'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ProductFormData }) =>
      productsApi.update(id, data),
    onSuccess: () => {
      toast.success('Товар обновлён');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      closeForm();
    },
    onError: () => toast.error('Не удалось обновить товар'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => {
      toast.success('Товар удалён');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setDeleteTarget(null);
    },
    onError: () => toast.error('Не удалось удалить товар'),
  });

  const writeoffMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { quantity: number; reason: string };
    }) => productsApi.writeoff(id, data),
    onSuccess: () => {
      toast.success('Товар списан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setWriteoffTarget(null);
    },
    onError: () => toast.error('Не удалось списать товар'),
  });

  const inventoryMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { actualStock: number; reason: string };
    }) => productsApi.inventory(id, data),
    onSuccess: () => {
      toast.success('Инвентаризация проведена');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setInventoryTarget(null);
    },
    onError: () => toast.error('Ошибка инвентаризации'),
  });

  // ---- Handlers ----

  function openCreate() {
    setEditingProduct(null);
    setFormOpen(true);
  }

  function openEdit(product: Product) {
    setEditingProduct(product);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingProduct(null);
  }

  function handleFormSubmit(data: ProductFormData) {
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function handleSearchChange(v: string) {
    setSearch(v);
    setPage(1);
  }

  const products = productsData?.data || [];
  const total = productsData?.total || 0;
  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Склад</h1>
          <p className="text-sm text-gray-500 mt-1">Всего: {total}</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          Добавить товар
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="w-64">
          <SearchInput
            value={search}
            onChange={handleSearchChange}
            placeholder="Поиск по названию..."
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Категория
          </label>
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="block rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 min-w-[180px] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-colors"
          >
            <option value="">Все категории</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 pb-0.5 cursor-pointer">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => {
              setLowStockOnly(e.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="flex items-center gap-1.5 text-sm text-gray-700">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Мало на складе
          </span>
        </label>

        {(search || categoryFilter || lowStockOnly) && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setCategoryFilter('');
              setLowStockOnly(false);
              setPage(1);
            }}
            className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors pb-0.5"
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Не удалось загрузить список товаров</p>
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white">
          <EmptyState
            icon={Package}
            title={search || categoryFilter || lowStockOnly ? 'Ничего не найдено' : 'Нет товаров'}
            description={
              search || categoryFilter || lowStockOnly
                ? 'Попробуйте изменить параметры фильтрации'
                : 'Добавьте первый товар на склад'
            }
            action={
              !search && !categoryFilter && !lowStockOnly ? (
                <button
                  onClick={openCreate}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                >
                  <Plus className="h-4 w-4" />
                  Добавить товар
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="px-4 py-3 font-semibold text-gray-600 w-12"></th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Название</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Категория</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Закуп. цена
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Продажная цена
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Остаток
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Мин. остаток
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {products.map((product) => {
                    const isLow = product.stock <= product.minStock;
                    return (
                      <tr
                        key={product.id}
                        className="transition-colors hover:bg-gray-50"
                      >
                        <td className="px-4 py-3">
                          {product.photo ? (
                            <img
                              src={product.photo}
                              alt={product.name}
                              className="h-8 w-8 rounded object-cover"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-400">
                              <Package className="h-4 w-4" />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {product.name}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {product.category || '\u2014'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {formatMoney(product.costPrice)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900">
                          {formatMoney(product.sellPrice)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-medium ${
                            isLow ? 'text-red-600' : 'text-gray-900'
                          }`}
                        >
                          {isLow && (
                            <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                          )}
                          {product.stock}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {product.minStock}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(product)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                              title="Редактировать"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setWriteoffTarget(product)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-orange-50 hover:text-orange-600"
                              title="Списание"
                            >
                              <PackageMinus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setInventoryTarget(product)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                              title="Инвентаризация"
                            >
                              <ClipboardCheck className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(product)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              title="Удалить"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination page={page} total={total} limit={LIMIT} onChange={setPage} />
        </>
      )}

      {/* Create / Edit Modal */}
      {formOpen && (
        <ProductFormModal
          key={editingProduct?.id || 'new'}
          isOpen={formOpen}
          onClose={closeForm}
          product={editingProduct}
          onSubmit={handleFormSubmit}
          isLoading={isMutating}
          categories={categories}
        />
      )}

      {/* Writeoff Modal */}
      {writeoffTarget && (
        <WriteoffModal
          key={`wo-${writeoffTarget.id}`}
          isOpen={!!writeoffTarget}
          onClose={() => setWriteoffTarget(null)}
          product={writeoffTarget}
          onSubmit={(data) =>
            writeoffMutation.mutate({ id: writeoffTarget.id, data })
          }
          isLoading={writeoffMutation.isPending}
        />
      )}

      {/* Inventory Modal */}
      {inventoryTarget && (
        <InventoryModal
          key={`inv-${inventoryTarget.id}`}
          isOpen={!!inventoryTarget}
          onClose={() => setInventoryTarget(null)}
          product={inventoryTarget}
          onSubmit={(data) =>
            inventoryMutation.mutate({ id: inventoryTarget.id, data })
          }
          isLoading={inventoryMutation.isPending}
        />
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Удалить товар"
        message={`Вы уверены, что хотите удалить товар "${deleteTarget?.name}"? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
