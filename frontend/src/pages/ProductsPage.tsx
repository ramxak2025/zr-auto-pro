import { useState, useMemo, useRef, useEffect, useCallback, memo, FormEvent } from 'react';
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
  Warehouse,
  Download,
  Upload,
} from 'lucide-react';
import { productsApi, uploadsApi, warehouseCategoriesApi } from '../api/services';
import type { Product, BundleItem, PaginatedResponse, StockMovement } from '../types';
import { UserRole } from '../types';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import VirtualProductGrid from '../components/VirtualProductGrid';
import VirtualList from '../components/VirtualList';
import { formatMoney } from '../../../shared/utils/formatters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the image URL as-is (client-side compression handles size) */
function thumbUrl(url?: string): string | undefined {
  return url || undefined;
}

const UNIT_OPTIONS = [
  { value: 'pcs', label: 'шт' },
  { value: 'm', label: 'м' },
  { value: 'l', label: 'л' },
  { value: 'kg', label: 'кг' },
];

function unitLabel(unit?: string): string {
  const found = UNIT_OPTIONS.find((u) => u.value === unit);
  return found ? found.label : 'шт';
}

// Unified folder icons — all use the same clean icon style
const CATEGORY_ICONS: Record<string, string> = {};

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
  unit: string;
  isBundle: boolean;
  bundleItems: BundleItem[];
}

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  product?: Product | null;
  onSubmit: (data: ProductFormData) => void;
  isLoading: boolean;
  categories: string[];
  allProducts: Product[];
  defaultCategory?: string;
}

function ProductFormModal({
  isOpen,
  onClose,
  product,
  onSubmit,
  isLoading,
  categories,
  allProducts,
  defaultCategory,
}: ProductFormModalProps) {
  const [name, setName] = useState(product?.name || '');
  const [category, setCategory] = useState(product?.category || defaultCategory || '');
  const [photo, setPhoto] = useState(product?.photo || '');
  const [uploading, setUploading] = useState(false);
  const [costPrice, setCostPrice] = useState(product?.costPrice?.toString() || '0');
  const [sellPrice, setSellPrice] = useState(product?.sellPrice?.toString() || '0');
  const [stock, setStock] = useState(product?.stock?.toString() || '0');
  const [minStock, setMinStock] = useState(product?.minStock?.toString() || '0');
  const [unit, setUnit] = useState(product?.unit || 'pcs');
  const [isBundle, setIsBundle] = useState(product?.isBundle || false);
  const [bundleItems, setBundleItems] = useState<BundleItem[]>(product?.bundleItems || []);
  const [bundleSearch, setBundleSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bundleSearchResults = useMemo(() => {
    if (!bundleSearch.trim()) return [];
    const q = bundleSearch.toLowerCase();
    return allProducts
      .filter((p) => !p.isBundle && p.name.toLowerCase().includes(q) && !bundleItems.some((bi) => bi.productId === p.id))
      .slice(0, 8);
  }, [bundleSearch, allProducts, bundleItems]);

  function addBundleItem(p: Product) {
    setBundleItems((prev) => [...prev, { productId: p.id, name: p.name, quantity: 1 }]);
    setBundleSearch('');
  }

  function removeBundleItem(productId: string) {
    setBundleItems((prev) => prev.filter((bi) => bi.productId !== productId));
  }

  function updateBundleItemQty(productId: string, qty: number) {
    setBundleItems((prev) =>
      prev.map((bi) => (bi.productId === productId ? { ...bi, quantity: Math.max(1, qty) } : bi)),
    );
  }

  async function handlePhotoUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Максимальный размер файла: 5 МБ');
      return;
    }
    setUploading(true);
    try {
      const res = await uploadsApi.upload(file);
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
    if (isBundle && bundleItems.length === 0) {
      toast.error('Добавьте товары в комплект');
      return;
    }
    onSubmit({
      name: name.trim(),
      category: category.trim(),
      photo: photo || undefined,
      costPrice: parseFloat(costPrice) || 0,
      sellPrice: parseFloat(sellPrice) || 0,
      stock: parseFloat(stock) || 0,
      minStock: parseFloat(minStock) || 0,
      unit,
      isBundle,
      bundleItems: isBundle ? bundleItems : [],
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product ? 'Редактировать товар' : 'Новый товар'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4 max-h-[75vh] overflow-y-auto">
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
              accept="image/*"
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

        {/* Unit selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Единица измерения
          </label>
          <div className="flex gap-2">
            {UNIT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setUnit(opt.value)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  unit === opt.value
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
              Остаток {unit !== 'pcs' && <span className="text-gray-400 font-normal">({unit === 'm' ? 'м' : unit === 'l' ? 'л' : unit === 'kg' ? 'кг' : unit})</span>}
            </label>
            <input
              type="number"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              min="0"
              step={unit === 'pcs' ? '1' : '0.01'}
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
              step={unit === 'pcs' ? '1' : '0.01'}
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
        </div>

        {/* Bundle toggle */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => setIsBundle((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isBundle ? 'bg-primary-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isBundle ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm font-medium text-gray-700">Комплект (набор товаров)</span>
        </div>

        {/* Bundle items editor */}
        {isBundle && (
          <div className="space-y-3 rounded-xl border border-primary-200 bg-primary-50/50 p-3">
            <p className="text-xs font-semibold text-primary-600 uppercase tracking-wider">Состав комплекта</p>
            {bundleItems.length > 0 && (
              <div className="space-y-2">
                {bundleItems.map((bi) => (
                  <div key={bi.productId} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200">
                    <span className="flex-1 text-sm text-gray-900 truncate">{bi.name}</span>
                    <input
                      type="number"
                      value={bi.quantity}
                      onChange={(e) => updateBundleItemQty(bi.productId, parseInt(e.target.value) || 1)}
                      min="1"
                      className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm text-center focus:border-primary-500 focus:outline-none"
                    />
                    <span className="text-xs text-gray-400">{unitLabel(allProducts.find((p) => p.id === bi.productId)?.unit)}</span>
                    <button
                      type="button"
                      onClick={() => removeBundleItem(bi.productId)}
                      className="p-1 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={bundleSearch}
                onChange={(e) => setBundleSearch(e.target.value)}
                placeholder="Поиск товара для комплекта..."
                className="block w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none"
              />
            </div>
            {bundleSearchResults.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {bundleSearchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addBundleItem(p)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-left hover:bg-gray-50 transition-colors"
                  >
                    <Package className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="flex-1 text-sm text-gray-900 truncate">{p.name}</span>
                    <span className="text-xs text-gray-400">{p.stock} {unitLabel(p.unit)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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
    const qty = parseFloat(quantity);
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

  const actual = parseFloat(actualStock) || 0;
  const diff = actual - product.stock;
  const damageAmount = diff < 0 ? Math.abs(diff) * product.costPrice : 0;
  const excessAmount = diff > 0 ? diff * product.costPrice : 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const a = parseFloat(actualStock);
    if (isNaN(a) || a < 0) { toast.error('Введите корректный остаток'); return; }
    if (!reason.trim()) { toast.error('Укажите причину'); return; }
    onSubmit({ actualStock: a, reason: reason.trim() });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Инвентаризация">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Product info card */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
          <p className="text-sm font-semibold text-gray-900 mb-2">{product.name}</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-bold text-gray-800">{product.stock}</p>
              <p className="text-[10px] text-gray-400 uppercase">В системе</p>
            </div>
            <div>
              <p className={`text-lg font-bold ${actual !== product.stock ? 'text-primary-600' : 'text-gray-400'}`}>{actual}</p>
              <p className="text-[10px] text-gray-400 uppercase">Факт</p>
            </div>
            <div>
              <p className={`text-lg font-bold ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {diff > 0 ? '+' : ''}{diff !== 0 ? diff.toFixed(product.unit === 'pcs' ? 0 : 2) : '—'}
              </p>
              <p className="text-[10px] text-gray-400 uppercase">Разница</p>
            </div>
          </div>
          {/* Cost impact for shortage/excess */}
          {diff !== 0 && (
            <div className={`mt-3 rounded-lg p-2 text-center ${diff < 0 ? 'bg-red-50 border border-red-100' : 'bg-green-50 border border-green-100'}`}>
              <p className={`text-[10px] uppercase font-semibold ${diff < 0 ? 'text-red-500' : 'text-green-500'}`}>
                {diff < 0 ? 'Сумма недостачи' : 'Сумма излишков'}
              </p>
              <p className={`text-sm font-bold ${diff < 0 ? 'text-red-700' : 'text-green-700'}`}>
                {formatMoney(diff < 0 ? damageAmount : excessAmount)}
              </p>
              <p className="text-[10px] text-gray-400">
                {Math.abs(diff).toFixed(product.unit === 'pcs' ? 0 : 2)} {unitLabel(product.unit)} x {formatMoney(product.costPrice)}
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Фактический остаток</label>
          <input type="number" value={actualStock} onChange={(e) => setActualStock(e.target.value)} min="0" step="any"
            className="block w-full rounded-xl border border-gray-300 px-4 py-3 text-base font-semibold focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Причина</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Причина корректировки..."
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none" />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={isLoading} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">Отмена</button>
          <button type="submit" disabled={isLoading || diff === 0} className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}Провести инвентаризацию
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Product Grid Card — vertical card for 2-col grid layout
// ---------------------------------------------------------------------------

/** Format a date as dd.mm.yy */
function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const yy = d.getFullYear().toString().slice(-2);
  return `${dd}.${mm}.${yy}`;
}

/** Check if a date is within the last 24 hours */
function isWithin24h(dateStr: string): boolean {
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff < 24 * 60 * 60 * 1000;
}

const ProductCard = memo(function ProductCard({
  product,
  onClick,
  selectMode,
  selected,
  onToggleSelect,
  lastInventoryDate,
}: {
  product: Product;
  onClick: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  lastInventoryDate?: string;
}) {
  const isLow = product.stock <= product.minStock;
  const recentlyChecked = lastInventoryDate && isWithin24h(lastInventoryDate);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (selectMode && onToggleSelect) onToggleSelect();
        else onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (selectMode && onToggleSelect) onToggleSelect();
          else onClick();
        }
      }}
      className={`relative rounded-2xl overflow-hidden shadow-sm border transition-all active:scale-[0.97] cursor-pointer ${
        selected ? 'border-primary-500 ring-2 ring-primary-500/20' : recentlyChecked ? 'border-green-200 ring-1 ring-green-100' : 'border-gray-100'
      }`}
      style={recentlyChecked ? { backgroundColor: '#f0fdf4' } : { backgroundColor: '#ffffff' }}
    >
      {/* Select checkbox overlay */}
      {selectMode && (
        <div className="absolute top-2 left-2 z-10">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
              selected
                ? 'border-primary-600 bg-primary-600'
                : 'border-white bg-white/80 shadow-sm'
            }`}
          >
            {selected && <CheckIcon className="h-3 w-3 text-white" />}
          </div>
        </div>
      )}

      {/* Recently checked badge */}
      {recentlyChecked && (
        <div className="absolute top-2 right-2 z-10">
          <div className="flex items-center gap-0.5 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
            <CheckIcon className="h-2.5 w-2.5" />
          </div>
        </div>
      )}

      {/* Image area — use thumbnail for fast grid loading */}
      <div className="aspect-[4/3] bg-gray-50 flex items-center justify-center overflow-hidden">
        {product.photo ? (
          <img src={thumbUrl(product.photo) || product.photo} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Package className="h-10 w-10 text-gray-200" />
        )}
      </div>

      {/* Info */}
      <div className="p-2.5">
        <div className="flex items-start gap-1">
          <p className="text-[13px] font-medium text-gray-900 leading-tight line-clamp-2 min-h-[2.5em] flex-1">
            {product.name}
          </p>
          {product.isBundle && (
            <span className="flex-shrink-0 text-[9px] font-bold bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full mt-0.5">
              КМП
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          <span className={`text-[11px] ${isLow ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
            {product.stock} {unitLabel(product.unit)}
          </span>
          {isLow && <AlertTriangle className="h-3 w-3 text-red-500" />}
        </div>
        <p className="text-sm font-bold text-gray-900 mt-1">
          {formatMoney(product.sellPrice)}
        </p>
        {/* Inventory check date */}
        {lastInventoryDate && !recentlyChecked && (
          <p className="text-[10px] text-gray-400 mt-0.5">
            Проверено: {formatDateShort(lastInventoryDate)}
          </p>
        )}
        {recentlyChecked && (
          <p className="text-[10px] text-green-600 font-medium mt-0.5">
            Проверено сегодня
          </p>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Folder Tile — grid tile for category folders
// ---------------------------------------------------------------------------

function FolderTile({
  name,
  count,
  hasLow,
  onClick,
  recentlyChecked,
  lastCheckDate,
}: {
  name: string;
  count: number;
  hasLow: boolean;
  onClick: () => void;
  recentlyChecked?: boolean;
  lastCheckDate?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={`rounded-2xl overflow-hidden shadow-sm border p-4 flex flex-col items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer relative ${
        recentlyChecked ? 'border-green-200' : 'border-gray-100'
      }`}
      style={recentlyChecked ? { backgroundColor: '#f0fdf4' } : { backgroundColor: '#ffffff' }}
    >
      {hasLow && (
        <div className="absolute top-2 right-2">
          <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
        </div>
      )}
      {recentlyChecked && (
        <div className="absolute top-2 left-2">
          <div className="flex items-center gap-0.5 bg-green-500 text-white text-[8px] font-bold px-1 py-0.5 rounded-full">
            <CheckIcon className="h-2.5 w-2.5" />
          </div>
        </div>
      )}
      <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${recentlyChecked ? 'bg-green-100' : 'bg-primary-50'}`}>
        <FolderOpen className={`h-6 w-6 ${recentlyChecked ? 'text-green-500' : 'text-primary-500'}`} />
      </div>
      <p className="text-[13px] font-semibold text-gray-900 text-center truncate w-full">{name}</p>
      <p className="text-[11px] text-gray-400">{count} шт</p>
      {lastCheckDate && !recentlyChecked && (
        <p className="text-[9px] text-gray-400">{formatDateShort(lastCheckDate)}</p>
      )}
    </div>
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
  const uLabel = unitLabel(product.unit);

  return (
    <Modal isOpen onClose={onClose} title={product.name} size="lg">
      <div className="space-y-5">
        {/* Photo + info */}
        <div className="flex items-start gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gray-50 flex-shrink-0 overflow-hidden">
            {product.photo ? (
              <img src={product.photo} alt={product.name} className="w-full h-full object-cover rounded-xl" loading="lazy" />
            ) : (
              <Package className="h-8 w-8 text-gray-300" />
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              {product.category && (
                <span className="inline-block text-[11px] font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">{product.category}</span>
              )}
              {product.isBundle && (
                <span className="inline-block text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Комплект</span>
              )}
            </div>
            <p className="text-base font-bold text-gray-900">{product.name}</p>
          </div>
        </div>

        {/* Bundle contents */}
        {product.isBundle && product.bundleItems && product.bundleItems.length > 0 && (
          <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-primary-600 uppercase tracking-wider">Состав комплекта</p>
            {product.bundleItems.map((bi, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <Package className="h-3.5 w-3.5 text-primary-400 flex-shrink-0" />
                <span className="flex-1 text-gray-900 truncate">{bi.name}</span>
                <span className="text-gray-500 font-medium">{bi.quantity} {unitLabel('pcs')}</span>
              </div>
            ))}
          </div>
        )}

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
              {product.stock} {uLabel} {isLow && <AlertTriangle className="inline h-3 w-3 ml-1" />}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[11px] text-gray-400 mb-0.5">Мин. остаток</p>
            <p className="text-sm font-bold text-gray-900">{product.minStock} {uLabel}</p>
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
// Main Page — Grid-based warehouse catalog
// ---------------------------------------------------------------------------

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  const canManageWarehouse = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);
  const isOwner = isRole(UserRole.DIRECTOR, UserRole.SUPERADMIN);

  const { data: warehouseStats } = useQuery({
    queryKey: ['warehouse-stats'],
    queryFn: async () => { const res = await productsApi.getWarehouseStats(); return res.data; },
    staleTime: 60_000,
    enabled: isOwner,
  });

  const [searchText, setSearchText] = useState('');
  const [activePath, setActivePath] = useState<string[]>([]);

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailTarget, setDetailTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [writeoffTarget, setWriteoffTarget] = useState<Product | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState<Product | null>(null);

  // Global warehouse operations
  const [warehouseOpsOpen, setWarehouseOpsOpen] = useState(false);
  const [warehouseOpsMode, setWarehouseOpsMode] = useState<'inventory' | 'writeoff' | null>(null);
  const [warehouseOpsProducts, setWarehouseOpsProducts] = useState<Record<string, { actual: string; reason: string }>>({});

  // Select & move state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Import/Export
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<any[] | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- History-based back navigation for folders ----
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;

  useEffect(() => {
    window.history.pushState({ warehouseGuard: true }, '');

    const handler = () => {
      if (activePathRef.current.length > 0) {
        const newPath = activePathRef.current.slice(0, -1);
        activePathRef.current = newPath;
        setActivePath(newPath);
        setSelectMode(false);
        setSelectedProducts(new Set());
      }
      window.history.pushState({ warehouseGuard: true }, '');
    };

    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const enterFolder = useCallback((folderName: string) => {
    setActivePath((prev) => {
      const next = [...prev, folderName];
      activePathRef.current = next;
      return next;
    });
    setSearchText('');
    window.history.pushState({ warehouseFolder: true }, '');
  }, []);

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
    staleTime: 30_000,
  });

  const allProducts = productsData?.data || [];

  // Fetch inventory movements to determine last check dates for products
  const { data: inventoryMovements } = useQuery<StockMovement[]>({
    queryKey: ['inventory-movements'],
    queryFn: async () => {
      const res = await productsApi.getMovements({ limit: 5000 });
      // res.data can be StockMovement[] or { data: StockMovement[] } depending on API
      const raw = res.data as any;
      const list: StockMovement[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      return list.filter((m: StockMovement) => m.type === 'inventory');
    },
    staleTime: 60_000,
  });

  // Map: productId -> last inventory date string
  const lastInventoryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!inventoryMovements) return map;
    for (const m of inventoryMovements) {
      const existing = map.get(m.productId);
      if (!existing || new Date(m.createdAt) > new Date(existing)) {
        map.set(m.productId, m.createdAt);
      }
    }
    return map;
  }, [inventoryMovements]);

  // Fetch persisted empty warehouse categories
  const { data: warehouseCats } = useQuery<Array<{ id: string; path: string }>>({
    queryKey: ['warehouse-categories'],
    queryFn: async () => { const res = await warehouseCategoriesApi.getAll(); return res.data; },
    staleTime: 30_000,
  });

  const createCategoryMutation = useMutation({
    mutationFn: (path: string) => warehouseCategoriesApi.create(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
    },
  });

  const categories = useMemo(() => {
    const cats = new Set<string>();
    allProducts.forEach((p: Product) => { if (p.category) cats.add(p.category); });
    return Array.from(cats).sort();
  }, [allProducts]);

  const { subfolders, currentProducts } = useMemo(() => {
    const prefix = activePath.length > 0 ? activePath.join('/') : '';
    const subfolderSet = new Map<string, { count: number; hasLow: boolean }>();
    const prods: Product[] = [];

    for (const p of allProducts) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];

      if (activePath.length === 0) {
        if (catParts.length === 0 || cat === '') {
          prods.push(p);
        } else {
          const folderName = catParts[0];
          const existing = subfolderSet.get(folderName) || { count: 0, hasLow: false };
          existing.count++;
          if (p.stock <= p.minStock) existing.hasLow = true;
          subfolderSet.set(folderName, existing);
        }
      } else {
        if (cat === prefix) {
          prods.push(p);
        } else if (cat.startsWith(prefix + '/')) {
          const rest = cat.slice(prefix.length + 1);
          const nextSegment = rest.split('/')[0];
          const existing = subfolderSet.get(nextSegment) || { count: 0, hasLow: false };
          existing.count++;
          if (p.stock <= p.minStock) existing.hasLow = true;
          subfolderSet.set(nextSegment, existing);
        }
      }
    }

    // Merge in persisted empty categories from backend
    if (warehouseCats) {
      for (const wc of warehouseCats) {
        const wcParts = wc.path.split('/');
        if (activePath.length === 0) {
          const folderName = wcParts[0];
          if (!subfolderSet.has(folderName)) {
            subfolderSet.set(folderName, { count: 0, hasLow: false });
          }
        } else if (wc.path.startsWith(prefix + '/')) {
          const rest = wc.path.slice(prefix.length + 1);
          const nextSegment = rest.split('/')[0];
          if (!subfolderSet.has(nextSegment)) {
            subfolderSet.set(nextSegment, { count: 0, hasLow: false });
          }
        }
      }
    }

    const sortedSubfolders = Array.from(subfolderSet.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { subfolders: sortedSubfolders, currentProducts: prods };
  }, [allProducts, activePath, warehouseCats]);

  // Compute per-folder inventory check info: whether all products in folder
  // were checked within last 24h (recentlyChecked), and the latest check date
  const folderCheckInfo = useMemo(() => {
    const info = new Map<string, { recentlyChecked: boolean; lastCheckDate?: string }>();
    if (lastInventoryMap.size === 0) return info;
    const prefix = activePath.length > 0 ? activePath.join('/') : '';

    for (const folder of subfolders) {
      const folderPrefix = prefix ? `${prefix}/${folder.name}` : folder.name;
      // Find all products in this folder (directly or nested)
      const folderProducts = allProducts.filter(p => {
        const cat = p.category || '';
        return cat === folderPrefix || cat.startsWith(folderPrefix + '/');
      });
      if (folderProducts.length === 0) {
        info.set(folder.name, { recentlyChecked: false });
        continue;
      }
      let allCheckedRecently = true;
      let latestDate: string | undefined;
      for (const p of folderProducts) {
        const checkDate = lastInventoryMap.get(p.id);
        if (!checkDate) {
          allCheckedRecently = false;
        } else {
          if (!isWithin24h(checkDate)) allCheckedRecently = false;
          if (!latestDate || new Date(checkDate) > new Date(latestDate)) latestDate = checkDate;
        }
      }
      info.set(folder.name, { recentlyChecked: allCheckedRecently, lastCheckDate: latestDate });
    }
    return info;
  }, [subfolders, allProducts, activePath, lastInventoryMap]);

  const allCategoryPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const p of allProducts) {
      if (p.category) {
        const parts = p.category.split('/');
        for (let i = 1; i <= parts.length; i++) {
          paths.add(parts.slice(0, i).join('/'));
        }
      }
    }
    return Array.from(paths).sort();
  }, [allProducts]);

  const searchResults = useMemo(() => {
    if (!searchText) return [];
    const q = searchText.toLowerCase();
    return allProducts.filter((p) => p.name.toLowerCase().includes(q));
  }, [searchText, allProducts]);

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
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      toast.success('Товар удалён');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setDeleteTarget(null);
    },
    onError: () => toast.error('Не удалось удалить товар'),
  });

  const writeoffMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { quantity: number; reason: string } }) =>
      productsApi.updateStock(id, { type: 'writeoff', quantity: data.quantity, reason: data.reason }),
    onSuccess: () => {
      toast.success('Товар списан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setWriteoffTarget(null);
    },
    onError: () => toast.error('Не удалось списать товар'),
  });

  const inventoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { actualStock: number; reason: string } }) =>
      productsApi.updateStock(id, { type: 'inventory', quantity: data.actualStock, reason: data.reason }),
    onSuccess: () => {
      toast.success('Инвентаризация проведена');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
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
      // Auto-fill category from current folder path
      if (!data.category && activePath.length > 0) {
        data.category = activePath.join('/');
      }
      createMutation.mutate(data);
    }
  }

  async function handleExport() {
    try {
      const res = await productsApi.exportCsv();
      const blob = new Blob([res.data as any], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'products.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Файл экспортирован');
    } catch {
      toast.error('Ошибка экспорта');
    }
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length < 2) {
        toast.error('Файл пустой или содержит только заголовок');
        return;
      }
      // Detect separator (semicolon or comma)
      const sep = lines[0].includes(';') ? ';' : ',';
      const rows = lines.slice(1).map((line) => {
        const cols = line.split(sep).map((c) => c.trim());
        return {
          name: cols[0] || '',
          category: cols[1] || '',
          costPrice: parseFloat(cols[2]) || 0,
          sellPrice: parseFloat(cols[3]) || 0,
          stock: parseFloat(cols[4]) || 0,
          minStock: parseFloat(cols[5]) || 0,
          unit: cols[6] || 'pcs',
        };
      }).filter((r) => r.name);
      setImportData(rows);
      setShowImportModal(true);
    };
    reader.readAsText(file);
    // Reset input so same file can be selected again
    e.target.value = '';
  }

  async function handleImportConfirm() {
    if (!importData || importData.length === 0) return;
    setImporting(true);
    try {
      const res = await productsApi.importCsv(importData);
      const result = res.data;
      toast.success(`Импортировано: ${result.created} новых, ${result.updated} обновлено`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowImportModal(false);
      setImportData(null);
    } catch {
      toast.error('Ошибка импорта');
    } finally {
      setImporting(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isMutating = createMutation.isPending || updateMutation.isPending;

  // ---- Navigation state ----
  const isInFolder = activePath.length > 0;
  const showingSearch = !!searchText;
  const showingFolderContents = isInFolder && !searchText;
  const showingRoot = !searchText && !isInFolder;
  const currentPathStr = activePath.join('/');

  // Render product grid helper — uses virtual scrolling for large lists
  function renderProductGrid(products: Product[], isSearch?: boolean) {
    return (
      <VirtualProductGrid
        products={products}
        renderItem={(product) => (
          <ProductCard
            key={product.id}
            product={product}
            onClick={() => setDetailTarget(product)}
            selectMode={!isSearch && selectMode}
            selected={selectedProducts.has(product.id)}
            onToggleSelect={() => toggleSelect(product.id)}
            lastInventoryDate={lastInventoryMap.get(product.id)}
          />
        )}
      />
    );
  }

  return (
    <div className="space-y-4 pb-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Склад</h1>
          <p className="text-xs text-gray-400 mt-0.5">{allProducts.length} товаров</p>
        </div>
        {canManageWarehouse && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:scale-[0.97] transition-all"
              title="Экспорт CSV"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:scale-[0.97] transition-all"
              title="Импорт CSV"
            >
              <Upload className="h-4 w-4" />
            </button>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleImportFile} className="hidden" />
            <button
              type="button"
              onClick={() => setWarehouseOpsOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 active:scale-[0.97] transition-all"
              title="Складские операции"
            >
              <Warehouse className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 active:scale-[0.97] transition-all"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Добавить</span>
            </button>
          </div>
        )}
      </div>

      {/* Warehouse stats for owner */}
      {isOwner && warehouseStats && (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-indigo-50 p-3">
            <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider">Себестоимость склада</p>
            <p className="text-base font-bold text-indigo-700 mt-0.5">{formatMoney(warehouseStats.totalCostValue)}</p>
          </div>
          <div className="rounded-xl bg-green-50 p-3">
            <p className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">В розн. ценах</p>
            <p className="text-base font-bold text-green-700 mt-0.5">{formatMoney(warehouseStats.totalSellValue)}</p>
          </div>
          <div className="rounded-xl bg-orange-50 p-3">
            <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wider">Расход за месяц</p>
            <p className="text-base font-bold text-orange-700 mt-0.5">{formatMoney(warehouseStats.monthProductCost)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Расход пред. мес.</p>
            <p className="text-base font-bold text-gray-700 mt-0.5">{formatMoney(warehouseStats.lastMonthProductCost)}</p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Поиск по названию..."
          className="block w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/10"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : (
        <>
          {/* Breadcrumb + select toggle when inside a folder */}
          {showingFolderContents && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 text-sm min-w-0 overflow-hidden">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActivePath([]);
                    activePathRef.current = [];
                    setSelectMode(false);
                    setSelectedProducts(new Set());
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setActivePath([]);
                      activePathRef.current = [];
                      setSelectMode(false);
                      setSelectedProducts(new Set());
                    }
                  }}
                  className="text-primary-600 hover:text-primary-700 font-medium flex-shrink-0 cursor-pointer flex items-center gap-0.5"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Все
                </div>
                {activePath.map((segment, idx) => (
                  <span key={idx} className="flex items-center gap-1 min-w-0">
                    <span className="text-gray-300 flex-shrink-0">/</span>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        const newPath = activePath.slice(0, idx + 1);
                        setActivePath(newPath);
                        activePathRef.current = newPath;
                        setSelectMode(false);
                        setSelectedProducts(new Set());
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const newPath = activePath.slice(0, idx + 1);
                          setActivePath(newPath);
                          activePathRef.current = newPath;
                          setSelectMode(false);
                          setSelectedProducts(new Set());
                        }
                      }}
                      className={`truncate cursor-pointer ${
                        idx === activePath.length - 1
                          ? 'font-semibold text-gray-900'
                          : 'text-primary-600 hover:text-primary-700 font-medium'
                      }`}
                    >
                      {segment}
                    </div>
                  </span>
                ))}
              </div>
              {currentProducts.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectMode((v) => !v);
                    setSelectedProducts(new Set());
                  }}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 ${
                    selectMode
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {selectMode ? 'Отмена' : 'Выбрать'}
                </button>
              )}
            </div>
          )}

          {/* ── Category folders grid ── */}
          {(showingRoot || showingFolderContents) && subfolders.length > 0 && (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
              {subfolders.map((folder) => {
                const checkInfo = folderCheckInfo.get(folder.name);
                return (
                  <FolderTile
                    key={folder.name}
                    name={folder.name}
                    count={folder.count}
                    hasLow={folder.hasLow}
                    onClick={() => enterFolder(folder.name)}
                    recentlyChecked={checkInfo?.recentlyChecked}
                    lastCheckDate={checkInfo?.lastCheckDate}
                  />
                );
              })}
              {/* New folder tile */}
              {canManageWarehouse && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setShowFolderModal(true)}
                  onKeyDown={(e) => e.key === 'Enter' && setShowFolderModal(true)}
                  className="rounded-2xl overflow-hidden border-2 border-dashed border-gray-200 p-4 flex flex-col items-center gap-1.5 active:scale-[0.97] transition-all cursor-pointer bg-gray-50/50"
                >
                  <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center">
                    <FolderPlus className="h-6 w-6 text-gray-400" />
                  </div>
                  <p className="text-[11px] font-medium text-gray-400 text-center">Новая папка</p>
                </div>
              )}
            </div>
          )}

          {/* New folder button when no subfolders exist */}
          {canManageWarehouse && (showingRoot || showingFolderContents) && subfolders.length === 0 && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => setShowFolderModal(true)}
              onKeyDown={(e) => e.key === 'Enter' && setShowFolderModal(true)}
              className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 px-4 py-3 active:bg-gray-100 transition-colors cursor-pointer"
            >
              <FolderPlus className="h-4 w-4 text-gray-400" />
              <p className="text-sm font-medium text-gray-400">Новая папка</p>
            </div>
          )}

          {/* ── Products grid ── */}
          {(showingRoot || showingFolderContents) && currentProducts.length > 0 && (
            renderProductGrid(currentProducts)
          )}

          {/* Empty state */}
          {showingFolderContents && subfolders.length === 0 && currentProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Package className="h-12 w-12 mb-3" />
              <p className="text-sm">В этой папке пока нет товаров</p>
            </div>
          )}

          {/* Search results */}
          {showingSearch && (
            searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Package className="h-12 w-12 mb-3" />
                <p className="text-sm">Товары не найдены</p>
              </div>
            ) : (
              renderProductGrid(searchResults, true)
            )
          )}
        </>
      )}

      {/* Bottom action bar when products are selected */}
      {selectMode && selectedProducts.size > 0 && (
        <div className="sticky bottom-20 md:bottom-0 z-10 -mx-4 bg-white/95 backdrop-blur border-t border-gray-100 px-4 py-3 rounded-xl shadow-lg">
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

      {/* Product detail */}
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
          allProducts={allProducts}
          defaultCategory={activePath.length > 0 ? activePath.join('/') : undefined}
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
            {currentPathStr !== '' && (
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  moveMutation.mutate({
                    productIds: Array.from(selectedProducts),
                    category: '',
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    moveMutation.mutate({
                      productIds: Array.from(selectedProducts),
                      category: '',
                    });
                  }
                }}
                className="flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <FolderOpen className="h-5 w-5 text-gray-400 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-500">Без категории (корень)</span>
              </div>
            )}
            {allCategoryPaths
              .filter((path) => path !== currentPathStr)
              .map((path) => {
                const depth = path.split('/').length - 1;
                return (
                  <div
                    key={path}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      moveMutation.mutate({
                        productIds: Array.from(selectedProducts),
                        category: path,
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        moveMutation.mutate({
                          productIds: Array.from(selectedProducts),
                          category: path,
                        });
                      }
                    }}
                    className="flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left hover:bg-gray-50 transition-colors cursor-pointer"
                    style={{ paddingLeft: `${16 + depth * 16}px` }}
                  >
                    <FolderOpen className="h-5 w-5 text-primary-500 flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-900 truncate">{path}</span>
                  </div>
                );
              })}
            <div className="border-t border-gray-100 pt-2 mt-2">
              <div className="flex items-center gap-2 px-4">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Новая папка..."
                  className="flex-1 min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder-gray-400 focus:border-primary-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newFolderName.trim()) {
                      const targetCategory = activePath.length > 0
                        ? activePath.join('/') + '/' + newFolderName.trim()
                        : newFolderName.trim();
                      moveMutation.mutate({
                        productIds: Array.from(selectedProducts),
                        category: targetCategory,
                      });
                    }
                  }}
                  disabled={!newFolderName.trim()}
                  className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-40 flex-shrink-0"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Warehouse operations chooser */}
      {warehouseOpsOpen && !warehouseOpsMode && (
        <Modal isOpen onClose={() => setWarehouseOpsOpen(false)} title="Складские операции" size="sm">
          <div className="space-y-2">
            <button type="button"
              onClick={() => { setWarehouseOpsMode('inventory'); setWarehouseOpsProducts({}); }}
              className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-blue-50 transition-colors text-left border border-gray-100">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <ClipboardCheck className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Инвентаризация</p>
                <p className="text-xs text-gray-500">Пересчёт остатков на складе</p>
              </div>
            </button>
            <button type="button"
              onClick={() => { setWarehouseOpsMode('writeoff'); setWarehouseOpsProducts({}); }}
              className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-orange-50 transition-colors text-left border border-gray-100">
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                <PackageMinus className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Списание</p>
                <p className="text-xs text-gray-500">Списать брак, потери, просрочку</p>
              </div>
            </button>
          </div>
        </Modal>
      )}

      {/* Global inventory modal */}
      {warehouseOpsMode === 'inventory' && (
        <Modal isOpen onClose={() => { setWarehouseOpsMode(null); setWarehouseOpsOpen(false); }} title="Инвентаризация" size="lg">
          <GlobalInventoryForm
            products={allProducts}
            categories={categories}
            activePath={activePath}
            onSubmit={async (items) => {
              for (const item of items) {
                await productsApi.updateStock(item.productId, { type: 'inventory', quantity: item.actual, reason: item.reason || 'Инвентаризация' });
              }
              queryClient.invalidateQueries({ queryKey: ['products'] });
              queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
              toast.success(`Инвентаризация завершена (${items.length} позиций)`);
            }}
            onClose={() => {
              setWarehouseOpsMode(null);
              setWarehouseOpsOpen(false);
            }}
          />
        </Modal>
      )}

      {/* Global writeoff modal */}
      {warehouseOpsMode === 'writeoff' && (
        <Modal isOpen onClose={() => { setWarehouseOpsMode(null); setWarehouseOpsOpen(false); }} title="Списание товаров" size="lg">
          <GlobalWriteoffForm
            products={allProducts}
            onSubmit={async (items) => {
              for (const item of items) {
                await productsApi.updateStock(item.productId, { type: 'writeoff', quantity: item.quantity, reason: item.reason });
              }
              queryClient.invalidateQueries({ queryKey: ['products'] });
              toast.success(`Списано ${items.length} позиций`);
              setWarehouseOpsMode(null);
              setWarehouseOpsOpen(false);
            }}
          />
        </Modal>
      )}

      {/* Add new folder modal */}
      {showFolderModal && (
        <Modal
          isOpen
          onClose={() => {
            setShowFolderModal(false);
            setNewFolderName('');
          }}
          title={activePath.length > 0 ? `Новая подпапка в "${activePath[activePath.length - 1]}"` : 'Новая папка'}
          size="sm"
        >
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
                onClick={() => {
                  setShowFolderModal(false);
                  setNewFolderName('');
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newFolderName.trim()) {
                    const folderPath = activePath.length > 0
                      ? activePath.join('/') + '/' + newFolderName.trim()
                      : newFolderName.trim();
                    createCategoryMutation.mutate(folderPath);
                    enterFolder(newFolderName.trim());
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

      {/* Import preview modal */}
      {showImportModal && importData && (
        <Modal isOpen onClose={() => { setShowImportModal(false); setImportData(null); }} title="Импорт товаров" size="lg">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Найдено <span className="font-bold text-gray-900">{importData.length}</span> товаров для импорта.
              Товары с совпадающими названиями будут обновлены.
            </p>

            <div className="max-h-80 overflow-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Название</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Категория</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Закупка</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Розница</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Кол-во</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {importData.slice(0, 50).map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{item.name}</td>
                      <td className="px-3 py-2 text-gray-500">{item.category || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{item.costPrice}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{item.sellPrice}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{item.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importData.length > 50 && (
                <p className="text-center text-xs text-gray-400 py-2">
                  ... и ещё {importData.length - 50} товаров
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowImportModal(false); setImportData(null); }}
                disabled={importing}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleImportConfirm}
                disabled={importing}
                className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                Импортировать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inventory Report Line
// ---------------------------------------------------------------------------

interface InventoryReportItem {
  productId: string;
  name: string;
  unit?: string;
  stockBefore: number;
  actual: number;
  diff: number;
  costPrice: number;
  damageAmount: number; // shortage * costPrice (positive for shortage)
}

// ---------------------------------------------------------------------------
// Inventory Report View — shown after inventory is completed
// ---------------------------------------------------------------------------

function InventoryReport({
  items,
  onClose,
}: {
  items: InventoryReportItem[];
  onClose: () => void;
}) {
  const shortageItems = items.filter(i => i.diff < 0);
  const excessItems = items.filter(i => i.diff > 0);
  const matchItems = items.filter(i => i.diff === 0);

  const totalShortageAmount = shortageItems.reduce((sum, i) => sum + Math.abs(i.diff) * i.costPrice, 0);
  const totalExcessAmount = excessItems.reduce((sum, i) => sum + i.diff * i.costPrice, 0);

  return (
    <div className="space-y-4 max-h-[70vh] flex flex-col">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Недостача</p>
          <p className="text-base font-bold text-red-700 mt-0.5">{formatMoney(totalShortageAmount)}</p>
          <p className="text-[11px] text-red-400 mt-0.5">{shortageItems.length} поз.</p>
        </div>
        <div className="rounded-xl bg-green-50 border border-green-100 p-3 text-center">
          <p className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">Излишки</p>
          <p className="text-base font-bold text-green-700 mt-0.5">{formatMoney(totalExcessAmount)}</p>
          <p className="text-[11px] text-green-400 mt-0.5">{excessItems.length} поз.</p>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-center">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Совпало</p>
          <p className="text-base font-bold text-gray-700 mt-0.5">{matchItems.length}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">позиций</p>
        </div>
      </div>

      {/* Detailed list */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5">
        {/* Shortage items first */}
        {shortageItems.length > 0 && (
          <>
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wider pt-1">Недостача</p>
            {shortageItems.map(item => (
              <div key={item.productId} className="rounded-xl border border-red-100 bg-red-50/40 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-[11px] text-gray-400">
                      Было: {item.stockBefore} → Факт: {item.actual} {unitLabel(item.unit)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-red-600">{item.diff}</p>
                    <p className="text-[11px] text-red-400">{formatMoney(Math.abs(item.diff) * item.costPrice)}</p>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Excess items */}
        {excessItems.length > 0 && (
          <>
            <p className="text-xs font-semibold text-green-600 uppercase tracking-wider pt-2">Излишки</p>
            {excessItems.map(item => (
              <div key={item.productId} className="rounded-xl border border-green-100 bg-green-50/40 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-[11px] text-gray-400">
                      Было: {item.stockBefore} → Факт: {item.actual} {unitLabel(item.unit)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-green-600">+{item.diff}</p>
                    <p className="text-[11px] text-green-400">{formatMoney(item.diff * item.costPrice)}</p>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Matching items */}
        {matchItems.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider pt-2">Без расхождений</p>
            {matchItems.map(item => (
              <div key={item.productId} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-[11px] text-gray-400">Остаток: {item.actual} {unitLabel(item.unit)}</p>
                  </div>
                  <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center justify-end pt-3 border-t border-gray-100">
        <button type="button" onClick={onClose}
          className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700">
          Закрыть
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global Inventory Form
// ---------------------------------------------------------------------------

function GlobalInventoryForm({
  products,
  categories,
  activePath,
  onSubmit,
  onClose,
}: {
  products: Product[];
  categories: string[];
  activePath: string[];
  onSubmit: (items: Array<{ productId: string; actual: number; reason: string }>) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [entries, setEntries] = useState<Record<string, { actual: string; reason: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [reportItems, setReportItems] = useState<InventoryReportItem[] | null>(null);

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach(p => map.set(p.id, p));
    return map;
  }, [products]);

  const filtered = useMemo(() => {
    let list = products.filter(p => !p.isBundle);
    if (filterCat) {
      list = list.filter(p => p.category === filterCat || (p.category && p.category.startsWith(filterCat + '/')));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products, filterCat, search]);

  const handleSubmit = async () => {
    const items = Object.entries(entries)
      .filter(([, v]) => v.actual !== '')
      .map(([productId, v]) => ({
        productId,
        actual: parseFloat(v.actual) || 0,
        reason: v.reason || 'Инвентаризация',
      }));
    if (items.length === 0) { toast.error('Укажите фактические остатки'); return; }
    setSubmitting(true);
    try {
      // Build report data before submitting (uses current stock values)
      const report: InventoryReportItem[] = items.map(item => {
        const product = productMap.get(item.productId);
        const stockBefore = product?.stock ?? 0;
        const diff = item.actual - stockBefore;
        return {
          productId: item.productId,
          name: product?.name ?? 'Неизвестный товар',
          unit: product?.unit,
          stockBefore,
          actual: item.actual,
          diff,
          costPrice: product?.costPrice ?? 0,
          damageAmount: diff < 0 ? Math.abs(diff) * (product?.costPrice ?? 0) : 0,
        };
      });

      await onSubmit(items);
      setReportItems(report);
    } finally {
      setSubmitting(false);
    }
  };

  // Show report after successful inventory
  if (reportItems) {
    return (
      <InventoryReport items={reportItems} onClose={onClose} />
    );
  }

  const countedIds = new Set(Object.keys(entries).filter(id => entries[id].actual !== ''));

  return (
    <div className="space-y-4 max-h-[70vh] flex flex-col">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск товара..." className="input pl-9" />
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="input w-auto">
          <option value="">Все папки</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <p className="text-xs text-gray-400">
        Посчитано: <span className="font-bold text-primary-600">{countedIds.size}</span> / {filtered.length} товаров
      </p>

      <VirtualList
        items={filtered}
        getKey={(p) => p.id}
        estimateSize={72}
        className="flex-1 overflow-y-auto min-h-0"
        renderItem={(p) => {
          const entry = entries[p.id] || { actual: '', reason: '' };
          const actual = entry.actual !== '' ? parseFloat(entry.actual) || 0 : null;
          const diff = actual !== null ? actual - p.stock : null;
          const isCounted = entry.actual !== '';

          return (
            <div className={`rounded-xl border p-3 mb-2 transition-colors ${isCounted ? 'border-green-200 bg-green-50/30' : 'border-gray-100 bg-white'}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-[11px] text-gray-400">В системе: <span className="font-semibold text-gray-600">{p.stock}</span> {unitLabel(p.unit)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number"
                    value={entry.actual}
                    onChange={e => setEntries(prev => ({ ...prev, [p.id]: { ...prev[p.id] || { reason: '' }, actual: e.target.value } }))}
                    placeholder="Факт"
                    className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-center font-semibold focus:border-primary-500 focus:outline-none"
                    min="0"
                    step="any"
                  />
                  {diff !== null && diff !== 0 && (
                    <span className={`text-xs font-bold ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {diff > 0 ? '+' : ''}{diff}
                    </span>
                  )}
                  {isCounted && diff === 0 && (
                    <CheckIcon className="w-4 h-4 text-green-500" />
                  )}
                </div>
              </div>
            </div>
          );
        }}
      />
      {filtered.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400">Товары не найдены</div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400">{countedIds.size} позиций</p>
        <button type="button" onClick={handleSubmit} disabled={submitting || countedIds.size === 0}
          className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
          Провести инвентаризацию
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global Writeoff Form
// ---------------------------------------------------------------------------

function GlobalWriteoffForm({
  products,
  onSubmit,
}: {
  products: Product[];
  onSubmit: (items: Array<{ productId: string; quantity: number; reason: string }>) => void;
}) {
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<Record<string, { quantity: string; reason: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');

  const filtered = useMemo(() => {
    let list = products.filter(p => !p.isBundle && p.stock > 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products, search]);

  const handleSubmit = async () => {
    const items = Object.entries(entries)
      .filter(([, v]) => v.quantity !== '' && parseFloat(v.quantity) > 0)
      .map(([productId, v]) => ({
        productId,
        quantity: parseFloat(v.quantity) || 0,
        reason: v.reason || reason || 'Списание',
      }));
    if (items.length === 0) { toast.error('Укажите количество для списания'); return; }
    setSubmitting(true);
    try { await onSubmit(items); } finally { setSubmitting(false); }
  };

  const count = Object.values(entries).filter(v => v.quantity !== '' && parseFloat(v.quantity) > 0).length;

  return (
    <div className="space-y-4 max-h-[70vh] flex flex-col">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск товара..." className="input pl-9" />
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Общая причина списания</label>
        <input type="text" value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Брак, просрочка..." className="input" />
      </div>

      <VirtualList
        items={filtered}
        getKey={(p) => p.id}
        estimateSize={72}
        className="flex-1 overflow-y-auto min-h-0"
        renderItem={(p) => {
          const entry = entries[p.id] || { quantity: '', reason: '' };
          return (
            <div className="rounded-xl border border-gray-100 bg-white p-3 mb-2">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-[11px] text-gray-400">Остаток: <span className="font-semibold text-gray-600">{p.stock}</span> {unitLabel(p.unit)}</p>
                </div>
                <input
                  type="number"
                  value={entry.quantity}
                  onChange={e => setEntries(prev => ({ ...prev, [p.id]: { quantity: e.target.value, reason: prev[p.id]?.reason || '' } }))}
                  placeholder="Кол-во"
                  className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-center font-semibold focus:border-orange-500 focus:outline-none"
                  min="0"
                  max={p.stock}
                  step="any"
                />
              </div>
            </div>
          );
        }}
      />
      {filtered.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400">Товары не найдены</div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400">{count} позиций</p>
        <button type="button" onClick={handleSubmit} disabled={submitting || count === 0}
          className="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageMinus className="w-4 h-4" />}
          Списать
        </button>
      </div>
    </div>
  );
}
