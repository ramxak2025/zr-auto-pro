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
  Check as CheckIcon,
  Move,
  FolderPlus,
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

function ProductRow({
  product,
  onClick,
}: {
  product: Product;
  onClick: () => void;
}) {
  const isLow = product.stock <= product.minStock;

  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-3 w-full bg-white rounded-xl border border-gray-100 px-3 py-2.5 hover:shadow-sm hover:border-primary-200 transition-all text-left active:bg-gray-50">
      {/* Thumbnail */}
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-50 flex-shrink-0 overflow-hidden">
        {product.photo ? (
          <img src={product.photo} alt={product.name} className="w-full h-full object-cover rounded-lg" />
        ) : (
          <Package className="h-5 w-5 text-gray-300" />
        )}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
          {isLow && (
            <span className="flex items-center gap-0.5 bg-red-50 text-red-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
              <AlertTriangle className="h-2.5 w-2.5" />Мало
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs ${isLow ? 'text-red-500' : 'text-gray-400'}`}>{product.stock} шт</span>
          <span className="text-[10px] text-gray-300">&middot;</span>
          <span className="text-[11px] text-gray-400">Закуп: {formatMoney(product.costPrice)}</span>
        </div>
      </div>
      {/* Price */}
      <span className="text-sm font-bold text-primary-600 flex-shrink-0">{formatMoney(product.sellPrice)}</span>
      <ChevronLeft className="h-4 w-4 text-gray-300 flex-shrink-0 rotate-180" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Product Detail Modal — edit, delete, writeoff, inventory accessible here
// ---------------------------------------------------------------------------

function ProductDetailModal({ product, onClose, onEdit, onWriteoff, onInventory, onDelete }: {
  product: Product;
  onClose: () => void;
  onEdit: () => void;
  onWriteoff: () => void;
  onInventory: () => void;
  onDelete: () => void;
}) {
  const isLow = product.stock <= product.minStock;

  return (
    <Modal isOpen onClose={onClose} title={product.name} size="lg">
      <div className="space-y-5">
        {/* Photo + info */}
        <div className="flex items-start gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gray-50 flex-shrink-0 overflow-hidden">
            {product.photo ? (
              <img src={product.photo} alt={product.name} className="w-full h-full object-cover rounded-xl" />
            ) : (
              <Package className="h-8 w-8 text-gray-300" />
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            {product.category && (
              <span className="inline-block text-[11px] font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">{product.category}</span>
            )}
            <p className="text-base font-bold text-gray-900">{product.name}</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[11px] text-gray-400 mb-0.5">Закуп. цена</p>
            <p className="text-sm font-bold text-gray-900">{formatMoney(product.costPrice)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[11px] text-gray-400 mb-0.5">Продажная цена</p>
            <p className="text-sm font-bold text-primary-600">{formatMoney(product.sellPrice)}</p>
          </div>
          <div className={`rounded-xl p-3 ${isLow ? 'bg-red-50' : 'bg-gray-50'}`}>
            <p className="text-[11px] text-gray-400 mb-0.5">Остаток</p>
            <p className={`text-sm font-bold ${isLow ? 'text-red-600' : 'text-gray-900'}`}>
              {product.stock} шт {isLow && <AlertTriangle className="inline h-3 w-3 ml-1" />}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[11px] text-gray-400 mb-0.5">Мин. остаток</p>
            <p className="text-sm font-bold text-gray-900">{product.minStock} шт</p>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <button type="button" onClick={onEdit}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <Pencil className="h-4 w-4 text-primary-500" />Редактировать
          </button>
          <button type="button" onClick={onWriteoff}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <PackageMinus className="h-4 w-4 text-orange-500" />Списание
          </button>
          <button type="button" onClick={onInventory}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <ClipboardCheck className="h-4 w-4 text-blue-500" />Инвентаризация
          </button>
          <button type="button" onClick={onDelete}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
            <Trash2 className="h-4 w-4" />Удалить товар
          </button>
        </div>
      </div>
    </Modal>
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
  const [detailTarget, setDetailTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [writeoffTarget, setWriteoffTarget] = useState<Product | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState<Product | null>(null);

  // Select & move state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

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

  const moveMutation = useMutation({
    mutationFn: async ({ productIds, category }: { productIds: string[]; category: string }) => {
      await Promise.all(productIds.map((id) => productsApi.update(id, { category })));
    },
    onSuccess: () => {
      toast.success('Товары перемещены');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedProducts(new Set());
      setSelectMode(false);
      setShowMoveModal(false);
    },
    onError: () => toast.error('Не удалось переместить товары'),
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
          {/* Back button + select toggle when inside category */}
          {showingCategory && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => { setActiveCategory(null); setSelectMode(false); setSelectedProducts(new Set()); }}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Все категории
              </button>
              {categoryProducts.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSelectMode((v) => !v); setSelectedProducts(new Set()); }}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${selectMode ? 'bg-primary-100 text-primary-700' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                  {selectMode ? 'Отмена' : 'Выбрать'}
                </button>
              )}
            </div>
          )}

          {/* Category title */}
          {showingCategory && (
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-base">
                {CATEGORY_ICONS[activeCategory!] || <FolderOpen className="h-4 w-4 text-primary-500" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">{activeCategory}</h2>
                <p className="text-[11px] text-gray-400">{categoryProducts.length} товаров</p>
              </div>
            </div>
          )}

          {/* Folder view — categories as list */}
          {showingFolders && (
            <div className="space-y-1.5">
              {categoryGroups.map(([cat, products]) => {
                const hasLow = products.some((p) => p.stock <= p.minStock);
                const totalItems = products.length;

                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setActiveCategory(cat);
                      setSearchText('');
                    }}
                    className="flex items-center gap-3 w-full rounded-xl border border-gray-100 bg-white px-4 py-3
                      hover:shadow-sm hover:border-primary-200 active:bg-gray-50 transition-all text-left"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 flex-shrink-0">
                      {CATEGORY_ICONS[cat] ? (
                        <span className="text-lg">{CATEGORY_ICONS[cat]}</span>
                      ) : (
                        <FolderOpen className="h-5 w-5 text-primary-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{cat}</p>
                      <p className="text-[11px] text-gray-400">{totalItems} товаров</p>
                    </div>
                    {hasLow && (
                      <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                    )}
                    <ChevronLeft className="h-4 w-4 text-gray-300 flex-shrink-0 rotate-180" />
                  </button>
                );
              })}
              {/* Add new folder button */}
              <button
                type="button"
                onClick={() => setShowFolderModal(true)}
                className="flex items-center gap-3 w-full rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 px-4 py-3 hover:border-primary-300 hover:bg-primary-50/30 active:bg-gray-100 transition-all text-left"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 flex-shrink-0">
                  <FolderPlus className="h-5 w-5 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-500">Новая папка</p>
              </button>
            </div>
          )}

          {/* Product list (search or in-category view) */}
          {(showingSearch || showingCategory) && (
            displayProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Package className="h-12 w-12 mb-3" />
                <p className="text-sm">
                  {showingSearch ? 'Товары не найдены' : 'В этой категории нет товаров'}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {displayProducts.map((product) => (
                  <div key={product.id} className="flex items-center gap-2">
                    {selectMode && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProducts((prev) => {
                            const next = new Set(prev);
                            if (next.has(product.id)) next.delete(product.id);
                            else next.add(product.id);
                            return next;
                          });
                        }}
                        className={`flex h-5 w-5 items-center justify-center rounded-md border-2 flex-shrink-0 transition-colors ${
                          selectedProducts.has(product.id)
                            ? 'border-primary-600 bg-primary-600'
                            : 'border-gray-300 bg-white hover:border-primary-400'
                        }`}
                      >
                        {selectedProducts.has(product.id) && (
                          <CheckIcon className="h-3 w-3 text-white" />
                        )}
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <ProductRow
                        product={product}
                        onClick={() => {
                          if (selectMode) {
                            setSelectedProducts((prev) => {
                              const next = new Set(prev);
                              if (next.has(product.id)) next.delete(product.id);
                              else next.add(product.id);
                              return next;
                            });
                          } else {
                            setDetailTarget(product);
                          }
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* Bottom action bar when products are selected */}
      {selectMode && selectedProducts.size > 0 && (
        <div className="fixed bottom-[68px] inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-gray-100 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Выбрано: {selectedProducts.size}</span>
            <button
              type="button"
              onClick={() => setShowMoveModal(true)}
              className="flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
            >
              <Move className="h-4 w-4" />
              Переместить
            </button>
          </div>
        </div>
      )}

      {/* Product detail — actions accessible from here */}
      {detailTarget && (
        <ProductDetailModal
          product={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => { openEdit(detailTarget); setDetailTarget(null); }}
          onWriteoff={() => { setWriteoffTarget(detailTarget); setDetailTarget(null); }}
          onInventory={() => { setInventoryTarget(detailTarget); setDetailTarget(null); }}
          onDelete={() => { setDeleteTarget(detailTarget); setDetailTarget(null); }}
        />
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

      {/* Move to folder modal */}
      {showMoveModal && (
        <Modal isOpen onClose={() => setShowMoveModal(false)} title="Переместить в папку">
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {categoryGroups
              .filter(([cat]) => cat !== activeCategory)
              .map(([cat]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => moveMutation.mutate({ productIds: Array.from(selectedProducts), category: cat })}
                  className="flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <FolderOpen className="h-5 w-5 text-primary-500" />
                  <span className="text-sm font-medium text-gray-900">{cat}</span>
                </button>
              ))}
            {/* New folder option */}
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div className="flex items-center gap-2 px-4">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Новая папка..."
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder-gray-400 focus:border-primary-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newFolderName.trim()) moveMutation.mutate({ productIds: Array.from(selectedProducts), category: newFolderName.trim() });
                  }}
                  disabled={!newFolderName.trim()}
                  className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-40"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Add new folder modal */}
      {showFolderModal && (
        <Modal isOpen onClose={() => { setShowFolderModal(false); setNewFolderName(''); }} title="Новая папка" size="sm">
          <div className="space-y-4">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Название папки..."
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowFolderModal(false); setNewFolderName(''); }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newFolderName.trim()) {
                    setActiveCategory(newFolderName.trim());
                    setShowFolderModal(false);
                    setNewFolderName('');
                  }
                }}
                disabled={!newFolderName.trim()}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-40"
              >
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
