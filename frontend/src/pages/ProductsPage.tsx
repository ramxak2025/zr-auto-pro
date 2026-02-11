import { useState, useMemo, useRef, FormEvent } from 'react';
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
  Search,
  ChevronLeft,
  FolderOpen,
} from 'lucide-react';
import { productsApi, uploadsApi } from '../api/services';
import type { Product, PaginatedResponse } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

const CATEGORY_ICONS: Record<string, string> = {
  'Масла': '🛢️',
  'Фильтры': '🔧',
  'Тормозная система': '🛞',
  'Жидкости': '💧',
  'Электрика': '⚡',
  'ГРМ': '⛓️',
  'Подвеска': '🔩',
};

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
                  className="h-20 w-20 rounded-xl object-cover border border-gray-200"
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
                className="flex h-20 w-20 flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-primary-400 hover:text-primary-500"
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
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
              Закуп. цена
            </label>
            <input
              type="number"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              min="0"
              step="0.01"
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || uploading}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading || uploading}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
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

function WriteoffModal({ isOpen, onClose, product, onSubmit, isLoading }: WriteoffModalProps) {
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const qty = parseInt(quantity);
    if (!qty || qty <= 0) { toast.error('Введите количество'); return; }
    if (qty > product.stock) { toast.error('Количество превышает остаток'); return; }
    if (!reason.trim()) { toast.error('Укажите причину списания'); return; }
    onSubmit({ quantity: qty, reason: reason.trim() });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Списание товара">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Товар: <span className="font-medium text-gray-900">{product.name}</span>
          <br />Остаток: <span className="font-medium text-gray-900">{product.stock}</span>
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Количество *</label>
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} min="1" max={product.stock}
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Причина *</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Причина списания..."
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none" />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={isLoading} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Отмена</button>
          <button type="submit" disabled={isLoading} className="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}Списать
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

function InventoryModal({ isOpen, onClose, product, onSubmit, isLoading }: InventoryModalProps) {
  const [actualStock, setActualStock] = useState(product.stock.toString());
  const [reason, setReason] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const actual = parseInt(actualStock);
    if (isNaN(actual) || actual < 0) { toast.error('Введите корректный остаток'); return; }
    if (!reason.trim()) { toast.error('Укажите причину'); return; }
    onSubmit({ actualStock: actual, reason: reason.trim() });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Инвентаризация">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Товар: <span className="font-medium text-gray-900">{product.name}</span>
          <br />В системе: <span className="font-medium text-gray-900">{product.stock}</span>
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Фактический остаток *</label>
          <input type="number" value={actualStock} onChange={(e) => setActualStock(e.target.value)} min="0"
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Причина *</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Причина корректировки..."
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none" />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={isLoading} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Отмена</button>
          <button type="submit" disabled={isLoading} className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}Провести
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Product Card — used in folder view
// ---------------------------------------------------------------------------

function ProductCard({
  product,
  onEdit,
  onWriteoff,
  onInventory,
  onDelete,
}: {
  product: Product;
  onEdit: () => void;
  onWriteoff: () => void;
  onInventory: () => void;
  onDelete: () => void;
}) {
  const isLow = product.stock <= product.minStock;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col hover:shadow-lg transition-shadow">
      {/* Image */}
      <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center relative">
        {product.photo ? (
          <img src={product.photo} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <Package className="h-10 w-10 text-gray-300" />
        )}
        {isLow && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">
            <AlertTriangle className="h-3 w-3" />
            Мало
          </div>
        )}
      </div>
      {/* Info */}
      <div className="flex-1 p-3 space-y-1.5">
        <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-tight">{product.name}</p>
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-primary-600">{formatMoney(product.sellPrice)}</span>
          <span className={`text-xs font-medium ${isLow ? 'text-red-600' : 'text-gray-400'}`}>{product.stock} шт</span>
        </div>
        <p className="text-[11px] text-gray-400">Закуп: {formatMoney(product.costPrice)}</p>
      </div>
      {/* Actions */}
      <div className="flex items-center border-t border-gray-50">
        <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors text-[11px] font-medium">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={onWriteoff} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition-colors text-[11px] font-medium border-l border-gray-50">
          <PackageMinus className="h-3.5 w-3.5" />
        </button>
        <button onClick={onInventory} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors text-[11px] font-medium border-l border-gray-50">
          <ClipboardCheck className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDelete} className="flex-1 flex items-center justify-center gap-1 py-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors text-[11px] font-medium border-l border-gray-50">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page — Folder-based warehouse view
// ---------------------------------------------------------------------------

export default function ProductsPage() {
  const queryClient = useQueryClient();

  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [writeoffTarget, setWriteoffTarget] = useState<Product | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState<Product | null>(null);

  // ---- Queries ----

  const {
    data: productsData,
    isLoading,
  } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', { limit: 1000 }],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 1000 });
      return res.data;
    },
    staleTime: 60_000,
  });

  const { data: categories = [] } = useQuery<string[]>({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const res = await productsApi.getCategories();
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  const allProducts = productsData?.data || [];

  // Group by category
  const categoryGroups = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of allProducts) {
      const cat = p.category || 'Без категории';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allProducts]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchText) return [];
    const q = searchText.toLowerCase();
    return allProducts.filter((p) => p.name.toLowerCase().includes(q));
  }, [searchText, allProducts]);

  // Products in active category
  const categoryProducts = activeCategory
    ? (categoryGroups.find(([cat]) => cat === activeCategory)?.[1] || [])
    : [];

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
    mutationFn: ({ id, data }: { id: string; data: { quantity: number; reason: string } }) =>
      productsApi.writeoff(id, data),
    onSuccess: () => {
      toast.success('Товар списан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setWriteoffTarget(null);
    },
    onError: () => toast.error('Не удалось списать товар'),
  });

  const inventoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { actualStock: number; reason: string } }) =>
      productsApi.inventory(id, data),
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

  const isMutating = createMutation.isPending || updateMutation.isPending;

  // ---- Which products to render ----
  const displayProducts = searchText ? searchResults : categoryProducts;
  const showingSearch = !!searchText;
  const showingCategory = !!activeCategory && !searchText;
  const showingFolders = !searchText && !activeCategory;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Склад</h1>
          <p className="text-xs text-gray-400 mt-0.5">{allProducts.length} товаров</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary-700 active:scale-[0.97]"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Поиск по названию..."
          className="block w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-all focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/10"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : (
        <>
          {/* Back button when inside category */}
          {showingCategory && (
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Все категории
            </button>
          )}

          {/* Category title */}
          {showingCategory && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-lg">
                {CATEGORY_ICONS[activeCategory!] || <FolderOpen className="h-5 w-5 text-primary-500" />}
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">{activeCategory}</h2>
                <p className="text-xs text-gray-400">{categoryProducts.length} товаров</p>
              </div>
            </div>
          )}

          {/* Folder view — categories as cards */}
          {showingFolders && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {categoryGroups.map(([cat, products]) => {
                const hasLow = products.some((p) => p.stock <= p.minStock);
                const totalItems = products.length;
                // Show first product image as category preview
                const previewImg = products.find((p) => p.photo)?.photo;

                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setActiveCategory(cat);
                      setSearchText('');
                    }}
                    className="relative flex flex-col items-center rounded-2xl border border-gray-100 bg-white p-4 shadow-sm
                      hover:shadow-md hover:border-primary-200 active:scale-[0.97] transition-all text-center"
                  >
                    {hasLow && (
                      <div className="absolute top-2 right-2">
                        <AlertTriangle className="h-4 w-4 text-orange-500" />
                      </div>
                    )}
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 mb-3 overflow-hidden">
                      {previewImg ? (
                        <img src={previewImg} alt={cat} className="w-full h-full object-cover rounded-2xl" />
                      ) : (
                        <span className="text-2xl">{CATEGORY_ICONS[cat] || ''}</span>
                      )}
                      {!previewImg && !CATEGORY_ICONS[cat] && (
                        <FolderOpen className="h-7 w-7 text-gray-400" />
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 leading-tight">{cat}</p>
                    <p className="text-[11px] text-gray-400 mt-1">{totalItems} товаров</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Product cards grid (search or in-category view) */}
          {(showingSearch || showingCategory) && (
            displayProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Package className="h-12 w-12 mb-3" />
                <p className="text-sm">
                  {showingSearch ? 'Товары не найдены' : 'В этой категории нет товаров'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {displayProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onEdit={() => openEdit(product)}
                    onWriteoff={() => setWriteoffTarget(product)}
                    onInventory={() => setInventoryTarget(product)}
                    onDelete={() => setDeleteTarget(product)}
                  />
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* Modals */}
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

      {writeoffTarget && (
        <WriteoffModal
          key={`wo-${writeoffTarget.id}`}
          isOpen={!!writeoffTarget}
          onClose={() => setWriteoffTarget(null)}
          product={writeoffTarget}
          onSubmit={(data) => writeoffMutation.mutate({ id: writeoffTarget.id, data })}
          isLoading={writeoffMutation.isPending}
        />
      )}

      {inventoryTarget && (
        <InventoryModal
          key={`inv-${inventoryTarget.id}`}
          isOpen={!!inventoryTarget}
          onClose={() => setInventoryTarget(null)}
          product={inventoryTarget}
          onSubmit={(data) => inventoryMutation.mutate({ id: inventoryTarget.id, data })}
          isLoading={inventoryMutation.isPending}
        />
      )}

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
