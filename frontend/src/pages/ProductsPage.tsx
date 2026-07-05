import { useState, useMemo, useRef, useEffect, useCallback, memo, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Reorder, useDragControls } from 'framer-motion';
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
  GripVertical,
  ArrowLeftRight,
  Recycle,
} from 'lucide-react';
import { productsApi, uploadsApi, warehouseCategoriesApi, warehousesApi, stockMovementsApi } from '../api/services';
import type { Product, BundleItem, PaginatedResponse, StockMovement, Warehouse as WarehouseRecord } from '../types';
import { UserRole } from '../types';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import TrashModal from '../components/TrashModal';
import ConfirmDialog from '../components/ConfirmDialog';
import VirtualProductGrid from '../components/VirtualProductGrid';
import VirtualList from '../components/VirtualList';
import { formatMoney } from '../../../shared/utils/formatters';
import { DEFAULT_UNIT, UNIT_PRESETS, formatQty, unitLabel } from '../utils/units';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the image URL as-is (client-side compression handles size) */
function thumbUrl(url?: string): string | undefined {
  return url || undefined;
}

// 120 (дробные количества): значения единиц храним русскими метками
// ('шт','м','кг','л','уп','компл'); legacy-коды ('pcs','m','l','kg')
// разруливает unitLabel из utils/units. UNIT_OPTIONS оставлен в прежней
// форме {value,label} — value теперь совпадает с label.
const UNIT_OPTIONS = UNIT_PRESETS.map((u) => ({ value: u, label: u }));

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
  warrantyDays: number | null;
  warehouseId?: string;
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
  /** Warehouse the create form should default to (currently active picker). */
  defaultWarehouseId?: string;
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
  defaultWarehouseId,
}: ProductFormModalProps) {
  const [name, setName] = useState(product?.name || '');
  const [category, setCategory] = useState(product?.category || defaultCategory || '');
  const [photo, setPhoto] = useState(product?.photo || '');
  const [uploading, setUploading] = useState(false);
  const [costPrice, setCostPrice] = useState(product?.costPrice?.toString() || '0');
  const [sellPrice, setSellPrice] = useState(product?.sellPrice?.toString() || '0');
  const [stock, setStock] = useState(product?.stock?.toString() || '0');
  const [minStock, setMinStock] = useState(product?.minStock?.toString() || '0');
  // 120: legacy-код ('pcs'→'шт') нормализуем сразу — чипсы подсветят значение,
  // сохранение перезапишет legacy-код русской меткой.
  const [unit, setUnit] = useState(unitLabel(product?.unit) || DEFAULT_UNIT);
  const [isBundle, setIsBundle] = useState(product?.isBundle || false);
  const [bundleItems, setBundleItems] = useState<BundleItem[]>(product?.bundleItems || []);
  const [bundleSearch, setBundleSearch] = useState('');
  const [warrantyDays, setWarrantyDays] = useState(product?.warrantyDays != null ? String(product.warrantyDays) : '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bundleSearchResults = useMemo(() => {
    if (!bundleSearch.trim()) return [];
    const q = bundleSearch.toLowerCase();
    return allProducts
      .filter(
        (p) => !p.isBundle && p.name.toLowerCase().includes(q) && !bundleItems.some((bi) => bi.productId === p.id),
      )
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
    const trimmedWd = warrantyDays.trim();
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
      warrantyDays: trimmedWd === '' ? null : Math.max(0, Math.floor(Number(trimmedWd))),
      // For new products, fall back to the currently selected warehouse from
      // the page. Edits keep the product's own warehouseId untouched here.
      warehouseId: product?.warehouseId || defaultWarehouseId || undefined,
    });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={product ? 'Редактировать товар' : 'Новый товар'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4 max-h-[75vh] overflow-y-auto">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Фото товара</label>
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
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Категория</label>
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
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Единица измерения</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Закуп. цена</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Продажная цена</label>
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
              Остаток {unit !== DEFAULT_UNIT && <span className="text-gray-400 font-normal">({unitLabel(unit)})</span>}
            </label>
            <input
              type="number"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              min="0"
              step={unit === DEFAULT_UNIT ? '1' : '0.001'}
              className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Мин. остаток</label>
            <input
              type="number"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              min="0"
              step={unit === DEFAULT_UNIT ? '1' : '0.001'}
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
                  <div
                    key={bi.productId}
                    className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200"
                  >
                    <span className="flex-1 text-sm text-gray-900 truncate">{bi.name}</span>
                    <input
                      type="number"
                      value={bi.quantity}
                      onChange={(e) => updateBundleItemQty(bi.productId, parseInt(e.target.value) || 1)}
                      min="1"
                      className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm text-center focus:border-primary-500 focus:outline-none"
                    />
                    <span className="text-xs text-gray-400">
                      {unitLabel(allProducts.find((p) => p.id === bi.productId)?.unit)}
                    </span>
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
                    <span className="text-xs text-gray-400">
                      {p.stock} {unitLabel(p.unit)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Warranty days */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Срок гарантии (дней)</label>
          <input
            type="number"
            value={warrantyDays}
            onChange={(e) => setWarrantyDays(e.target.value)}
            min="0"
            step="1"
            placeholder="Оставьте пустым — без гарантии"
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <p className="text-xs text-gray-400 mt-1">
            Дней с момента продажи. На этот товар можно будет оформить гарантийный возврат.
          </p>
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
  onSubmit: (data: { quantity: number; reason: string; recordAsExpense: boolean }) => void;
  isLoading: boolean;
}

function WriteoffModal({ isOpen, onClose, product, onSubmit, isLoading }: WriteoffModalProps) {
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [recordAsExpense, setRecordAsExpense] = useState(true);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const qty = parseFloat(quantity);
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
    onSubmit({ quantity: qty, reason: reason.trim(), recordAsExpense });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Списание товара">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Товар: <span className="font-medium text-gray-900">{product.name}</span>
          <br />
          Остаток: <span className="font-medium text-gray-900">{formatQty(product.stock)}</span>{' '}
          {unitLabel(product.unit)}
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Количество ({unitLabel(product.unit)}) *
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min="0.001"
            step="0.001"
            max={product.stock}
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Причина *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Причина списания..."
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Учёт</label>
          <div className="space-y-2">
            <label className="flex items-start gap-2.5 cursor-pointer rounded-xl border border-gray-200 px-3 py-2.5 hover:border-primary-300">
              <input
                type="radio"
                name="writeoff-mode"
                checked={recordAsExpense}
                onChange={() => setRecordAsExpense(true)}
                className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">По закупке (как расход)</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Спишет товар и создаст запись в расходах на сумму закупки. Прибыль уменьшится.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer rounded-xl border border-gray-200 px-3 py-2.5 hover:border-primary-300">
              <input
                type="radio"
                name="writeoff-mode"
                checked={!recordAsExpense}
                onChange={() => setRecordAsExpense(false)}
                className="mt-0.5 h-4 w-4 text-primary-600 focus:ring-primary-500"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">Просто списать</p>
                <p className="text-xs text-gray-500 mt-0.5">Уберёт остаток без проводки в расходы.</p>
              </div>
            </label>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}Списать
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Transfer Modal — move stock from main → defect or main → used
// ---------------------------------------------------------------------------

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

function TransferModal({
  isOpen,
  onClose,
  product,
  warehouses,
  sourceWarehouseId,
  onSubmit,
  isLoading,
}: TransferModalProps) {
  const defectWh = warehouses.find((w) => w.kind === 'defect');
  const usedWh = warehouses.find((w) => w.kind === 'used');
  const [mode, setMode] = useState<'defect' | 'used'>('defect');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const qty = parseFloat(quantity);
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
    <Modal isOpen={isOpen} onClose={onClose} title="Перенос на другой склад">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Товар: <span className="font-medium text-gray-900">{product.name}</span>
          <br />
          Остаток на основном: <span className="font-medium text-gray-900">{formatQty(product.stock)}</span>{' '}
          {unitLabel(product.unit)}
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Куда перенести</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('defect')}
              disabled={!defectWh}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50 ${
                mode === 'defect'
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-amber-300'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
              Брак
            </button>
            <button
              type="button"
              onClick={() => setMode('used')}
              disabled={!usedWh}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50 ${
                mode === 'used'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
              }`}
            >
              <Recycle className="w-4 h-4" />
              Б/У
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Количество ({unitLabel(product.unit)}) *
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min="0.001"
            step="0.001"
            max={product.stock}
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Комментарий</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Например: дефект, не подошёл..."
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Перенести
          </button>
        </div>
        {/* Currently unused: sourceWarehouseId param kept for future flexibility. */}
        <input type="hidden" value={sourceWarehouseId} readOnly />
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
    if (isNaN(a) || a < 0) {
      toast.error('Введите корректный остаток');
      return;
    }
    if (!reason.trim()) {
      toast.error('Укажите причину');
      return;
    }
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
              <p className={`text-lg font-bold ${actual !== product.stock ? 'text-primary-600' : 'text-gray-400'}`}>
                {actual}
              </p>
              <p className="text-[10px] text-gray-400 uppercase">Факт</p>
            </div>
            <div>
              <p
                className={`text-lg font-bold ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}
              >
                {diff > 0 ? '+' : ''}
                {diff !== 0 ? formatQty(diff) : '—'}
              </p>
              <p className="text-[10px] text-gray-400 uppercase">Разница</p>
            </div>
          </div>
          {/* Cost impact for shortage/excess */}
          {diff !== 0 && (
            <div
              className={`mt-3 rounded-lg p-2 text-center ${diff < 0 ? 'bg-red-50 border border-red-100' : 'bg-green-50 border border-green-100'}`}
            >
              <p className={`text-[10px] uppercase font-semibold ${diff < 0 ? 'text-red-500' : 'text-green-500'}`}>
                {diff < 0 ? 'Сумма недостачи' : 'Сумма излишков'}
              </p>
              <p className={`text-sm font-bold ${diff < 0 ? 'text-red-700' : 'text-green-700'}`}>
                {formatMoney(diff < 0 ? damageAmount : excessAmount)}
              </p>
              <p className="text-[10px] text-gray-400">
                {Math.abs(diff).toFixed(product.unit === 'pcs' ? 0 : 2)} {unitLabel(product.unit)} x{' '}
                {formatMoney(product.costPrice)}
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Фактический остаток</label>
          <input
            type="number"
            value={actualStock}
            onChange={(e) => setActualStock(e.target.value)}
            min="0"
            step="any"
            className="block w-full rounded-xl border border-gray-300 px-4 py-3 text-base font-semibold focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Причина</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Причина корректировки..."
            className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading || diff === 0}
            className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
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
        selected
          ? 'border-primary-500 ring-2 ring-primary-500/20'
          : recentlyChecked
            ? 'border-green-200 ring-1 ring-green-100'
            : 'border-gray-100'
      }`}
      style={recentlyChecked ? { backgroundColor: '#f0fdf4' } : { backgroundColor: '#ffffff' }}
    >
      {/* Select checkbox overlay */}
      {selectMode && (
        <div className="absolute top-2 left-2 z-10">
          <div
            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
              selected ? 'border-primary-600 bg-primary-600' : 'border-white bg-white/80 shadow-sm'
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
          <img
            src={thumbUrl(product.photo) || product.photo}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
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
        <p className="text-sm font-bold text-gray-900 mt-1">{formatMoney(product.sellPrice)}</p>
        {/* Inventory check date */}
        {lastInventoryDate && !recentlyChecked && (
          <p className="text-[10px] text-gray-400 mt-0.5">Проверено: {formatDateShort(lastInventoryDate)}</p>
        )}
        {recentlyChecked && <p className="text-[10px] text-green-600 font-medium mt-0.5">Проверено сегодня</p>}
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
  onDelete,
  canManage,
  recentlyChecked,
  lastCheckDate,
  dragHandleProps,
}: {
  name: string;
  count: number;
  hasLow: boolean;
  onClick: () => void;
  onDelete?: () => void;
  canManage?: boolean;
  recentlyChecked?: boolean;
  lastCheckDate?: string;
  /** Pointer-down handler that activates the drag — provided by Reorder.Item parent. */
  dragHandleProps?: { onPointerDown: (e: React.PointerEvent) => void };
}) {
  return (
    <div
      className={`flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all ${
        recentlyChecked ? 'border-green-200 bg-green-50/50' : 'border-gray-100 bg-white hover:border-gray-200'
      }`}
    >
      {/* Drag handle — long-press / press-and-drag to reorder */}
      {canManage && dragHandleProps && (
        <button
          type="button"
          aria-label="Перетащите чтобы переставить"
          className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none p-1 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors"
          onPointerDown={(e) => {
            e.stopPropagation();
            dragHandleProps.onPointerDown(e);
          }}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      {/* Main area — clickable to navigate */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => e.key === 'Enter' && onClick()}
        className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer active:opacity-70"
      >
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${recentlyChecked ? 'bg-green-100' : 'bg-primary-50'}`}
        >
          <FolderOpen className={`h-4.5 w-4.5 ${recentlyChecked ? 'text-green-500' : 'text-primary-500'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400">{count} шт</span>
            {lastCheckDate && !recentlyChecked && (
              <span className="text-[10px] text-gray-400">проверка {formatDateShort(lastCheckDate)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {recentlyChecked && (
            <div className="flex items-center gap-0.5 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">
              <CheckIcon className="h-2.5 w-2.5" />
            </div>
          )}
          {hasLow && <AlertTriangle className="h-4 w-4 text-orange-500" />}
          <ChevronLeft className="h-4 w-4 text-gray-300 rotate-180" />
        </div>
      </div>

      {/* Delete button */}
      {canManage && onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-2 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
          title="Удалить папку"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// Reorder.Item wrapper — wires the folder tile into framer-motion's
// gesture-driven list. dragListener={false} disables the default whole-row
// drag (which would conflict with the tap-to-open behaviour) and instead
// hands control to a manually-triggered useDragControls() bound to the
// grip handle inside FolderTile. Long-press / press-and-drag on the grip
// starts the drag; release commits via Reorder.Group's onReorder.
function FolderTileReorderItem({
  folder,
  checkInfo,
  canManage,
  onClick,
  onDelete,
}: {
  folder: { name: string; count: number; hasLow: boolean; catId: string; fullPath: string };
  checkInfo?: { recentlyChecked: boolean; lastCheckDate?: string };
  canManage?: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      value={folder}
      dragListener={false}
      dragControls={dragControls}
      // Disable layout animations on the wrapper itself so the folder
      // tile's own border/transition styles aren't fought.
    >
      <FolderTile
        name={folder.name}
        count={folder.count}
        hasLow={folder.hasLow}
        onClick={onClick}
        onDelete={onDelete}
        canManage={canManage}
        recentlyChecked={checkInfo?.recentlyChecked}
        lastCheckDate={checkInfo?.lastCheckDate}
        dragHandleProps={{ onPointerDown: (e) => dragControls.start(e) }}
      />
    </Reorder.Item>
  );
}

// ---------------------------------------------------------------------------
// Product Detail Modal — edit, delete, writeoff, inventory accessible here
// ---------------------------------------------------------------------------

const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
  income: { label: 'Приход', color: 'text-green-600 bg-green-50' },
  expense: { label: 'Расход', color: 'text-blue-600 bg-blue-50' },
  writeoff: { label: 'Списание', color: 'text-orange-600 bg-orange-50' },
  inventory: { label: 'Инвентаризация', color: 'text-purple-600 bg-purple-50' },
  defect_transfer: { label: 'В брак', color: 'text-amber-600 bg-amber-50' },
  used_transfer: { label: 'В Б/У', color: 'text-blue-600 bg-blue-50' },
  defect_return_to_supplier: { label: 'Поставщику', color: 'text-red-700 bg-red-50' },
  customer_return: { label: 'Возврат клиента', color: 'text-teal-700 bg-teal-50' },
};

function ProductDetailModal({
  product,
  onClose,
  onEdit,
  onWriteoff,
  onInventory,
  onDelete,
  onTransfer,
  canTransfer,
}: {
  product: Product;
  onClose: () => void;
  onEdit: () => void;
  onWriteoff: () => void;
  onInventory: () => void;
  onDelete: () => void;
  onTransfer?: () => void;
  canTransfer?: boolean;
}) {
  const [tab, setTab] = useState<'info' | 'movements' | 'prices'>('info');
  const isLow = product.stock <= product.minStock;
  const uLabel = unitLabel(product.unit);

  const { data: movements, isLoading: movLoading } = useQuery({
    queryKey: ['product-movements', product.id],
    queryFn: async () => {
      const res = await productsApi.getProductMovements(product.id);
      return res.data;
    },
    enabled: tab === 'movements',
    staleTime: 30_000,
  });

  const { data: priceHistory, isLoading: priceLoading } = useQuery({
    queryKey: ['product-prices', product.id],
    queryFn: async () => {
      const res = await productsApi.getProductPriceHistory(product.id);
      return res.data;
    },
    enabled: tab === 'prices',
    staleTime: 30_000,
  });

  const fmtDate = (d: string) => {
    const dt = new Date(d);
    return (
      dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
      ' ' +
      dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    );
  };

  return (
    <Modal isOpen onClose={onClose} title={product.name} size="lg">
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {[
            { key: 'info' as const, label: 'Информация' },
            { key: 'movements' as const, label: 'Движение' },
            { key: 'prices' as const, label: 'Цены' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-xs font-semibold text-center relative transition-colors ${tab === t.key ? 'text-primary-600' : 'text-gray-400'}`}
            >
              {t.label}
              {tab === t.key && <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary-500 rounded-full" />}
            </button>
          ))}
        </div>

        {/* Tab: Info */}
        {tab === 'info' && (
          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gray-50 flex-shrink-0 overflow-hidden">
                {product.photo ? (
                  <img
                    src={product.photo}
                    alt={product.name}
                    className="w-full h-full object-cover rounded-xl"
                    loading="lazy"
                  />
                ) : (
                  <Package className="h-8 w-8 text-gray-300" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {product.category && (
                    <span className="inline-block text-[11px] font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">
                      {product.category}
                    </span>
                  )}
                  {product.isBundle && (
                    <span className="inline-block text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                      Комплект
                    </span>
                  )}
                </div>
                <p className="text-base font-bold text-gray-900">{product.name}</p>
              </div>
            </div>

            {product.isBundle && product.bundleItems && product.bundleItems.length > 0 && (
              <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-primary-600 uppercase tracking-wider">Состав комплекта</p>
                {product.bundleItems.map((bi, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <Package className="h-3.5 w-3.5 text-primary-400 flex-shrink-0" />
                    <span className="flex-1 text-gray-900 truncate">{bi.name}</span>
                    <span className="text-gray-500 font-medium">
                      {bi.quantity} {unitLabel('pcs')}
                    </span>
                  </div>
                ))}
              </div>
            )}

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
                <p className="text-sm font-bold text-gray-900">
                  {product.minStock} {uLabel}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={onEdit}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Pencil className="h-4 w-4 text-primary-500" />
                Редактировать
              </button>
              {canTransfer && onTransfer && (
                <button
                  type="button"
                  onClick={onTransfer}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <ArrowLeftRight className="h-4 w-4 text-amber-500" />
                  Перенос в брак / Б/У
                </button>
              )}
              <button
                type="button"
                onClick={onWriteoff}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <PackageMinus className="h-4 w-4 text-orange-500" />
                Списание
              </button>
              <button
                type="button"
                onClick={onInventory}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <ClipboardCheck className="h-4 w-4 text-blue-500" />
                Инвентаризация
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Удалить товар
              </button>
            </div>
          </div>
        )}

        {/* Tab: Movement history */}
        {tab === 'movements' && (
          <div className="space-y-2">
            {movLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : !movements || movements.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-400">Нет движений по товару</div>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {movements.map((m: any) => {
                  const info = MOVEMENT_LABELS[m.type] || { label: m.type, color: 'text-gray-600 bg-gray-50' };
                  const diff = m.stockAfter - m.stockBefore;
                  return (
                    <div key={m.id} className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-gray-50">
                      <div
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 mt-0.5 ${info.color}`}
                      >
                        {info.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-bold ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-600'}`}
                          >
                            {diff > 0 ? '+' : ''}
                            {diff} {uLabel}
                          </span>
                          <span className="text-xs text-gray-400">
                            {m.stockBefore} → {m.stockAfter}
                          </span>
                        </div>
                        {m.reason && <p className="text-xs text-gray-500 mt-0.5 truncate">{m.reason}</p>}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-400">{fmtDate(m.createdAt)}</span>
                          {m.user && <span className="text-[10px] text-gray-400">• {m.user.fullName}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab: Price history */}
        {tab === 'prices' && (
          <div className="space-y-2">
            {/* Current prices */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded-xl bg-gray-50 p-3 text-center">
                <p className="text-[10px] text-gray-400 mb-0.5">Закупочная</p>
                <p className="text-base font-bold text-gray-900">{formatMoney(product.costPrice)}</p>
              </div>
              <div className="rounded-xl bg-primary-50 p-3 text-center">
                <p className="text-[10px] text-gray-400 mb-0.5">Продажная</p>
                <p className="text-base font-bold text-primary-600">{formatMoney(product.sellPrice)}</p>
              </div>
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">История изменений</p>

            {priceLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : !priceHistory || priceHistory.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-400">Цены не менялись</div>
            ) : (
              <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
                {priceHistory.map((p: any) => {
                  const costChanged = p.costPriceBefore !== p.costPriceAfter;
                  const sellChanged = p.sellPriceBefore !== p.sellPriceAfter;
                  return (
                    <div key={p.id} className="px-3 py-2.5 rounded-xl bg-gray-50">
                      <div className="space-y-1">
                        {costChanged && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-gray-400 w-16">Закуп.</span>
                            <span className="text-gray-500 line-through">{formatMoney(p.costPriceBefore)}</span>
                            <span className="text-gray-400">→</span>
                            <span
                              className={`font-bold ${p.costPriceAfter > p.costPriceBefore ? 'text-red-600' : 'text-green-600'}`}
                            >
                              {formatMoney(p.costPriceAfter)}
                            </span>
                          </div>
                        )}
                        {sellChanged && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-gray-400 w-16">Продаж.</span>
                            <span className="text-gray-500 line-through">{formatMoney(p.sellPriceBefore)}</span>
                            <span className="text-gray-400">→</span>
                            <span
                              className={`font-bold ${p.sellPriceAfter > p.sellPriceBefore ? 'text-green-600' : 'text-red-600'}`}
                            >
                              {formatMoney(p.sellPriceAfter)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-gray-400">{fmtDate(p.createdAt)}</span>
                        {p.user && <span className="text-[10px] text-gray-400">• {p.user.fullName}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
    queryFn: async () => {
      const res = await productsApi.getWarehouseStats();
      return res.data;
    },
    staleTime: 60_000,
    enabled: isOwner,
  });

  const [searchText, setSearchText] = useState('');
  const [activePath, setActivePath] = useState<string[]>([]);

  // Warehouse switcher state
  const [activeWarehouseId, setActiveWarehouseId] = useState<string>('');

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailTarget, setDetailTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [writeoffTarget, setWriteoffTarget] = useState<Product | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState<Product | null>(null);
  const [transferTarget, setTransferTarget] = useState<Product | null>(null);

  // Global warehouse operations
  const [warehouseOpsOpen, setWarehouseOpsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [warehouseOpsMode, setWarehouseOpsMode] = useState<'inventory' | 'writeoff' | null>(null);
  const [warehouseOpsProducts, setWarehouseOpsProducts] = useState<Record<string, { actual: string; reason: string }>>(
    {},
  );

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

  // Warehouses list — drives the switcher. Default to main on first load.
  const { data: warehouses } = useQuery<WarehouseRecord[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!activeWarehouseId && warehouses && warehouses.length > 0) {
      const main = warehouses.find((w) => w.kind === 'main') || warehouses[0];
      setActiveWarehouseId(main.id);
    }
  }, [warehouses, activeWarehouseId]);

  const activeWarehouseKind = useMemo<WarehouseRecord['kind'] | null>(() => {
    return warehouses?.find((w) => w.id === activeWarehouseId)?.kind ?? null;
  }, [warehouses, activeWarehouseId]);

  const { data: productsData, isLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', { limit: 1000, warehouseId: activeWarehouseId || 'all' }],
    queryFn: async () => {
      const params: { limit: number; warehouseId?: string } = { limit: 1000 };
      if (activeWarehouseId) params.warehouseId = activeWarehouseId;
      const res = await productsApi.getAll(params);
      return res.data;
    },
    staleTime: 30_000,
    enabled: !!activeWarehouseId,
    placeholderData: (prev) => prev,
  });

  const allProducts = productsData?.data || [];

  // Inventory movements feed ONLY the "recently checked" badge on folder cards
  // (see `folderCheckInfo` below). It's auxiliary decoration, not core data, so
  // we lazy-load it:
  //   - `enabled` only when the folder/root tree is on screen (i.e. NOT while
  //     searching) and products exist — the badge never renders during search,
  //     so don't pay for the fetch there.
  //   - `limit: 200` matches the backend, which hard-caps `/products/movements`
  //     at `LIMIT 200 ORDER BY created_at DESC` and ignores larger values.
  //     The old `limit: 5000` was a no-op illusion that suggested a 5000-row
  //     payload; 200 newest-first rows are enough to derive the latest
  //     inventory date per product for the badge.
  const movementsEnabled = !searchText && allProducts.length > 0;
  const { data: inventoryMovements } = useQuery<StockMovement[]>({
    queryKey: ['inventory-movements'],
    queryFn: async () => {
      const res = await productsApi.getMovements({ limit: 200 });
      // res.data can be StockMovement[] or { data: StockMovement[] } depending on API
      const raw = res.data as any;
      const list: StockMovement[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      return list.filter((m: StockMovement) => m.type === 'inventory');
    },
    staleTime: 60_000,
    enabled: movementsEnabled,
    placeholderData: (prev) => prev,
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
    queryFn: async () => {
      const res = await warehouseCategoriesApi.getAll();
      return res.data;
    },
    staleTime: 30_000,
  });

  const createCategoryMutation = useMutation({
    mutationFn: (path: string) => warehouseCategoriesApi.create(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: ({ id, deleteContents }: { id: string; deleteContents?: boolean }) =>
      warehouseCategoriesApi.remove(id, { deleteContents }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-trash'] });
      toast.success(vars.deleteContents ? 'Папка и товары удалены' : 'Папка удалена');
    },
    onError: () => toast.error('Ошибка удаления папки'),
  });

  // Some folders are "path-only" — they aren't backed by a row in
  // warehouse_categories (they exist purely because some products list that
  // string in their `category` column). For those there's no category id to
  // hit the backend's removeCategory endpoint with, so we soft-delete every
  // product whose category equals the path or starts with `${path}/` directly.
  // Live-only filter (deletedAt IS NULL) is implicit — soft-deleted products
  // are filtered out of `allProducts` upstream.
  const deletePathContentsMutation = useMutation({
    mutationFn: async (path: string) => {
      const matched = allProducts.filter(
        (p: Product) => !!p.category && (p.category === path || p.category.startsWith(path + '/')),
      );
      if (matched.length === 0) return { count: 0 };
      await Promise.all(matched.map((p: Product) => productsApi.remove(p.id)));
      return { count: matched.length };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-trash'] });
      toast.success(res.count > 0 ? `Папка и ${res.count} товаров удалены` : 'Папка удалена');
    },
    onError: () => toast.error('Не удалось удалить товары'),
  });

  const reorderCategoriesMutation = useMutation({
    mutationFn: (orderedIds: string[]) => warehouseCategoriesApi.updateOrder(orderedIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['warehouse-categories'] }),
  });

  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ id: string; name: string; path: string } | null>(null);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    allProducts.forEach((p: Product) => {
      if (p.category) cats.add(p.category);
    });
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

    // Build full path for each subfolder; look up warehouse category id + sort_order.
    const catLookup = new Map<string, { id: string; sort_order: number }>();
    if (warehouseCats) {
      for (const wc of warehouseCats) catLookup.set(wc.path, { id: wc.id, sort_order: (wc as any).sort_order || 0 });
    }

    const sortedSubfolders = Array.from(subfolderSet.entries())
      .map(([name, data]) => {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        const catInfo = catLookup.get(fullPath);
        return { name, fullPath, catId: catInfo?.id || '', sortOrder: catInfo?.sort_order || 0, ...data };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

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
      const folderProducts = allProducts.filter((p) => {
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
    mutationFn: ({ id, data }: { id: string; data: ProductFormData }) => productsApi.update(id, data),
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
    mutationFn: ({ id, data }: { id: string; data: { quantity: number; reason: string; recordAsExpense: boolean } }) =>
      stockMovementsApi.create({
        type: 'writeoff',
        productId: id,
        quantity: data.quantity,
        reason: data.reason,
        warehouseId: activeWarehouseId || undefined,
        purchasePrice: writeoffTarget?.costPrice,
        recordAsExpense: data.recordAsExpense,
      }),
    onSuccess: () => {
      toast.success('Товар списан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['defect-writeoff-report'] });
      setWriteoffTarget(null);
    },
    onError: () => toast.error('Не удалось списать товар'),
  });

  // Move stock between warehouses (main → defect, main → used)
  const transferMutation = useMutation({
    mutationFn: ({
      productId,
      type,
      targetWarehouseId,
      quantity,
      purchasePrice,
      reason,
    }: {
      productId: string;
      type: 'defect_transfer' | 'used_transfer';
      targetWarehouseId: string;
      quantity: number;
      purchasePrice?: number;
      reason?: string;
    }) =>
      stockMovementsApi.create({
        type,
        productId,
        quantity,
        purchasePrice,
        reason,
        sourceWarehouseId: activeWarehouseId || undefined,
        targetWarehouseId,
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.type === 'defect_transfer' ? 'Перенесено в брак' : 'Перенесено в Б/У');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['defect-writeoff-report'] });
      setTransferTarget(null);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Не удалось перенести товар';
      toast.error(typeof msg === 'string' ? msg : 'Не удалось перенести товар');
    },
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

  // Bulk move-to-trash for selected products. Backend remove() now soft-deletes,
  // so this fans out to one DELETE /products/:id call per selected id and the
  // items land in the trash, restorable from the Trash button.
  const bulkTrashMutation = useMutation({
    mutationFn: async (productIds: string[]) => {
      await Promise.all(productIds.map((id) => productsApi.remove(id)));
    },
    onSuccess: (_, productIds) => {
      toast.success(
        `${productIds.length} ${productIds.length === 1 ? 'товар перемещён' : 'товаров перемещено'} в корзину`,
      );
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-trash'] });
      setSelectedProducts(new Set());
      setSelectMode(false);
    },
    onError: () => toast.error('Не удалось переместить в корзину'),
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

  // Parse rows from a 2D array (header + data rows) — shared between Excel and CSV
  function parseImportRows(rawRows: string[][]) {
    if (rawRows.length < 2) {
      toast.error('Файл пустой или содержит только заголовок');
      return;
    }

    const detectMap = (row: string[]) => {
      const cols = row.map((c) =>
        String(c ?? '')
          .trim()
          .toLowerCase(),
      );
      const m = { name: -1, category: -1, unit: -1, sellPrice: -1, costPrice: -1, stock: -1, minStock: -1 };
      cols.forEach((h, i) => {
        if (!h) return;
        if (/наименование|название|name/.test(h)) m.name = i;
        else if (/групп|категори|category|group/.test(h)) m.category = i;
        else if (/единиц|ед\b|unit/.test(h)) m.unit = i;
        else if (/продаж|розниц|sell/.test(h)) m.sellPrice = i;
        else if (/закуп|себестоим|cost|purchase/.test(h)) m.costPrice = i;
        else if (/остаток|stock|количество|кол/.test(h) && !/мин/.test(h)) m.stock = i;
        else if (/мин.*остат|min.*stock/.test(h)) m.minStock = i;
      });
      return m;
    };

    // Auto-find header row: Excel sometimes has empty/merged rows before headers.
    // Scan the first 10 rows for the one that matches most fields.
    let headerIdx = 0;
    let colMap = detectMap(rawRows[0]);
    let bestScore = Object.values(colMap).filter((v) => v >= 0).length;
    for (let i = 1; i < Math.min(rawRows.length, 10); i++) {
      const m = detectMap(rawRows[i]);
      const score = Object.values(m).filter((v) => v >= 0).length;
      if (score > bestScore) {
        bestScore = score;
        colMap = m;
        headerIdx = i;
      }
    }

    // Fallback: if no header matched for name, assume old positional format
    if (colMap.name < 0) {
      colMap.name = 0;
      colMap.category = 1;
      colMap.costPrice = 2;
      colMap.sellPrice = 3;
      colMap.stock = 4;
      colMap.minStock = 5;
      colMap.unit = 6;
      headerIdx = 0;
    }

    const col = (row: string[], idx: number) => (idx >= 0 && row ? String(row[idx] ?? '').trim() : '');
    // Russian locale uses "," as decimal sep in Excel → normalize
    const toNum = (s: string) => parseFloat(s.replace(/\s/g, '').replace(',', '.')) || 0;

    const rows = rawRows
      .slice(headerIdx + 1)
      .map((row) => ({
        name: col(row, colMap.name),
        category: col(row, colMap.category),
        costPrice: colMap.costPrice >= 0 ? toNum(col(row, colMap.costPrice)) : 0,
        sellPrice: colMap.sellPrice >= 0 ? toNum(col(row, colMap.sellPrice)) : 0,
        stock: colMap.stock >= 0 ? toNum(col(row, colMap.stock)) : 0,
        minStock: colMap.minStock >= 0 ? toNum(col(row, colMap.minStock)) : 0,
        unit: col(row, colMap.unit) || DEFAULT_UNIT,
      }))
      .filter((r) => r.name);

    if (rows.length === 0) {
      toast.error('Не найдено товаров для импорта');
      return;
    }

    setImportData(rows);
    setShowImportModal(true);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const isCsv = /\.(csv|txt)$/i.test(file.name) || file.type === 'text/csv';

    const parseWithSheetJS = (data: ArrayBuffer | string, type: 'array' | 'string') => {
      try {
        const input = type === 'array' ? new Uint8Array(data as ArrayBuffer) : (data as string);
        const workbook = XLSX.read(input as any, { type, raw: false, cellDates: false, codepage: 65001 });
        const sheetName = workbook.SheetNames[0];
        const sheet = sheetName ? workbook.Sheets[sheetName] : null;
        if (!sheet) {
          toast.error('Файл не содержит листов с данными');
          return;
        }
        const rawRows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
        parseImportRows(rawRows);
      } catch (err: any) {
        toast.error(`Ошибка парсинга: ${err?.message || 'неизвестная ошибка'}`);
      }
    };

    if (isCsv) {
      // CSV: try UTF-8 first. If we detect mojibake (replacement chars from bad decode),
      // retry with Windows-1251 — the default Excel CSV encoding in Russian locale.
      const readAs = (encoding: string) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = (ev.target?.result as string) || '';
          if (encoding === 'utf-8' && /\uFFFD/.test(text)) {
            // Replacement chars = wrong encoding, retry as Windows-1251
            readAs('windows-1251');
            return;
          }
          parseWithSheetJS(text, 'string');
        };
        reader.onerror = () => toast.error('Не удалось прочитать файл');
        reader.readAsText(file, encoding);
      };
      readAs('utf-8');
    } else {
      // Excel (.xlsx / .xls): binary read
      const reader = new FileReader();
      reader.onload = (ev) => parseWithSheetJS(ev.target?.result as ArrayBuffer, 'array');
      reader.onerror = () => toast.error('Не удалось прочитать файл');
      reader.readAsArrayBuffer(file);
    }

    // Reset input so same file can be selected again
    e.target.value = '';
  }

  async function handleImportConfirm() {
    if (!importData || importData.length === 0) return;
    setImporting(true);
    try {
      const res = await productsApi.importCsv(importData);
      const result = res.data;
      const parts = [`${result.created} новых`, `${result.updated} обновлено`];
      if (result.skipped) parts.push(`${result.skipped} пропущено`);
      toast.success(`Импорт: ${parts.join(', ')}`);
      if (result.errors && result.errors.length > 0) {
        // Show first few failing rows so user knows what went wrong
        result.errors.forEach((e) => toast.error(e, { duration: 6000 }));
      }
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowImportModal(false);
      setImportData(null);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Ошибка импорта';
      toast.error(typeof msg === 'string' ? msg : 'Ошибка импорта');
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

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Render product list — each row: thumbnail | name | stock | costPrice? | sellPrice
  function renderProductList(products: Product[], isSearch?: boolean) {
    return (
      // Mobile: single full-width column. Desktop: multi-column grid so the
      // warehouse fills wide monitors instead of one stretched column.
      <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-x-3 gap-y-1">
        {products.map((product) => {
          const isLow = product.stock <= product.minStock;
          const isSelected = selectedProducts.has(product.id);
          return (
            <div
              key={product.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!isSearch && selectMode) toggleSelect(product.id);
                else setDetailTarget(product);
              }}
              onKeyDown={(e) => e.key === 'Enter' && setDetailTarget(product)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer active:bg-gray-50 transition-all ${
                isSelected
                  ? 'border-primary-500 bg-primary-50/50'
                  : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
              }`}
            >
              {/* Select checkbox */}
              {!isSearch && selectMode && (
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-2 flex-shrink-0 ${
                    isSelected ? 'border-primary-600 bg-primary-600' : 'border-gray-300 bg-white'
                  }`}
                >
                  {isSelected && <CheckIcon className="h-3 w-3 text-white" />}
                </div>
              )}

              {/* Thumbnail — long-press opens full photo */}
              <div
                className="h-10 w-10 rounded-lg bg-gray-50 overflow-hidden flex-shrink-0 flex items-center justify-center"
                onContextMenu={(e) => {
                  if (product.photo) {
                    e.preventDefault();
                    setPhotoPreview(product.photo);
                  }
                }}
                onTouchStart={() => {
                  if (!product.photo) return;
                  const timer = setTimeout(() => setPhotoPreview(product.photo!), 400);
                  const cancel = () => clearTimeout(timer);
                  document.addEventListener('touchend', cancel, { once: true });
                  document.addEventListener('touchmove', cancel, { once: true });
                }}
              >
                {product.photo ? (
                  <img
                    src={thumbUrl(product.photo) || product.photo}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Package className="h-5 w-5 text-gray-200" />
                )}
              </div>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                {product.isBundle && (
                  <span className="text-[9px] font-bold bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full">
                    КМП
                  </span>
                )}
              </div>

              {/* Stock */}
              <div className="flex-shrink-0 text-right">
                <span className={`text-xs font-medium ${isLow ? 'text-red-500' : 'text-gray-500'}`}>
                  {product.stock} {unitLabel(product.unit)}
                </span>
              </div>

              {/* Cost price — visible to director, admin, superadmin */}
              {canManageWarehouse && (
                <div className="flex-shrink-0 w-16 text-right hidden sm:block">
                  <span className="text-[11px] text-gray-400">{formatMoney(product.costPrice)}</span>
                </div>
              )}

              {/* Sell price */}
              <div className="flex-shrink-0 w-20 text-right">
                <span className="text-sm font-bold text-gray-900">{formatMoney(product.sellPrice)}</span>
              </div>
            </div>
          );
        })}
      </div>
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
              <span className="hidden xl:inline">Экспорт</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:scale-[0.97] transition-all"
              title="Импорт из Excel / CSV"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden xl:inline">Импорт</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              onChange={handleImportFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setTrashOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:scale-[0.97] transition-all"
              title="Корзина"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden xl:inline">Корзина</span>
            </button>
            <button
              type="button"
              onClick={() => setWarehouseOpsOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 active:scale-[0.97] transition-all"
              title="Складские операции"
            >
              <Warehouse className="h-4 w-4" />
              <span className="hidden xl:inline">Операции</span>
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

      {/* Warehouse switcher — main / defect / used */}
      {warehouses && warehouses.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
          {warehouses.map((w) => {
            const active = w.id === activeWarehouseId;
            const Icon = w.kind === 'defect' ? AlertTriangle : w.kind === 'used' ? Recycle : Package;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  setActiveWarehouseId(w.id);
                  setActivePath([]);
                  setSelectMode(false);
                  setSelectedProducts(new Set());
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
                  active
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {w.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Warehouse stats for owner */}
      {isOwner && warehouseStats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
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
            <p className="text-base font-bold text-gray-700 mt-0.5">
              {formatMoney(warehouseStats.lastMonthProductCost)}
            </p>
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
                    selectMode ? 'bg-primary-100 text-primary-700' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {selectMode ? 'Отмена' : 'Выбрать'}
                </button>
              )}
            </div>
          )}

          {/* ── Category folders list ── */}
          {(showingRoot || showingFolderContents) && subfolders.length > 0 && (
            <div className="space-y-1.5">
              {/* Reorder.Group lets users grab a folder by its drag-handle and reorder.
                  Works on both pointer (mouse) and touch — long-press the grip dots,
                  drag, drop. We sync the resulting order to the backend via
                  reorderCategoriesMutation, but only fire when the order really
                  changed to avoid extra writes. */}
              <Reorder.Group
                axis="y"
                values={subfolders}
                onReorder={(next) => {
                  const before = subfolders
                    .map((f) => f.catId)
                    .filter(Boolean)
                    .join('|');
                  const after = next
                    .map((f: { catId: string }) => f.catId)
                    .filter(Boolean)
                    .join('|');
                  if (before === after) return;
                  reorderCategoriesMutation.mutate(next.map((f: { catId: string }) => f.catId).filter(Boolean));
                }}
                className="space-y-1.5"
              >
                {subfolders.map((folder) => (
                  <FolderTileReorderItem
                    key={folder.name}
                    folder={folder}
                    checkInfo={folderCheckInfo.get(folder.name)}
                    canManage={canManageWarehouse}
                    onClick={() => enterFolder(folder.name)}
                    onDelete={() =>
                      setDeleteFolderTarget({ id: folder.catId, name: folder.name, path: folder.fullPath })
                    }
                  />
                ))}
              </Reorder.Group>
              {canManageWarehouse && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setShowFolderModal(true)}
                  onKeyDown={(e) => e.key === 'Enter' && setShowFolderModal(true)}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border-2 border-dashed border-gray-200 active:bg-gray-50 transition-colors cursor-pointer"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 flex-shrink-0">
                    <FolderPlus className="h-4.5 w-4.5 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-400">Новая папка</p>
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
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border-2 border-dashed border-gray-200 active:bg-gray-50 transition-colors cursor-pointer"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 flex-shrink-0">
                <FolderPlus className="h-4.5 w-4.5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-400">Новая папка</p>
            </div>
          )}

          {/* ── Products grid ── */}
          {(showingRoot || showingFolderContents) && currentProducts.length > 0 && renderProductList(currentProducts)}

          {/* Empty state */}
          {showingFolderContents && subfolders.length === 0 && currentProducts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Package className="h-12 w-12 mb-3" />
              <p className="text-sm">В этой папке пока нет товаров</p>
            </div>
          )}

          {/* Search results */}
          {showingSearch &&
            (searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Package className="h-12 w-12 mb-3" />
                <p className="text-sm">Товары не найдены</p>
              </div>
            ) : (
              renderProductList(searchResults, true)
            ))}
        </>
      )}

      {/* Bottom action bar when products are selected */}
      {selectMode && selectedProducts.size > 0 && (
        <div className="sticky bottom-20 md:bottom-0 z-10 -mx-4 bg-white/95 backdrop-blur border-t border-gray-100 px-4 py-3 rounded-xl shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-gray-600 flex-shrink-0">Выбрано: {selectedProducts.size}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowMoveModal(true)}
                className="flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
              >
                <Move className="h-4 w-4" />
                Переместить
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids = Array.from(selectedProducts);
                  if (ids.length === 0) return;
                  if (
                    confirm(
                      `Переместить ${ids.length} ${ids.length === 1 ? 'товар' : 'товаров'} в корзину? Можно будет восстановить.`,
                    )
                  ) {
                    bulkTrashMutation.mutate(ids);
                  }
                }}
                disabled={bulkTrashMutation.isPending}
                className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />В корзину
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product detail */}
      {detailTarget && (
        <ProductDetailModal
          product={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => {
            openEdit(detailTarget);
            setDetailTarget(null);
          }}
          onWriteoff={() => {
            setWriteoffTarget(detailTarget);
            setDetailTarget(null);
          }}
          onInventory={() => {
            setInventoryTarget(detailTarget);
            setDetailTarget(null);
          }}
          onDelete={() => {
            setDeleteTarget(detailTarget);
            setDetailTarget(null);
          }}
          // Перенос доступен только с основного склада (продаём с main; брак/б/у —
          // конечные точки, дальше — списание или возврат поставщику).
          canTransfer={activeWarehouseKind === 'main'}
          onTransfer={() => {
            setTransferTarget(detailTarget);
            setDetailTarget(null);
          }}
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
          defaultWarehouseId={activeWarehouseId || undefined}
        />
      )}

      {transferTarget && warehouses && (
        <TransferModal
          key={`tr-${transferTarget.id}`}
          isOpen={!!transferTarget}
          onClose={() => setTransferTarget(null)}
          product={transferTarget}
          warehouses={warehouses}
          sourceWarehouseId={activeWarehouseId}
          isLoading={transferMutation.isPending}
          onSubmit={(data) =>
            transferMutation.mutate({
              productId: transferTarget.id,
              type: data.type,
              targetWarehouseId: data.targetWarehouseId,
              quantity: data.quantity,
              purchasePrice: data.purchasePrice,
              reason: data.reason,
            })
          }
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
        message={`Переместить "${deleteTarget?.name}" в корзину? Товар можно будет восстановить.`}
        confirmText="В корзину"
        variant="danger"
      />

      {/* Delete folder modal — two-action chooser:
          (1) keep products, move them to root
          (2) delete the folder AND send its products to trash (recoverable). */}
      {deleteFolderTarget && (
        <Modal isOpen onClose={() => setDeleteFolderTarget(null)} title="Удалить папку" size="sm">
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Что сделать с папкой <span className="font-semibold text-gray-900">«{deleteFolderTarget.name}»</span>?
            </p>

            {/* Option 1 — keep products, drop the folder. Backend supports this
                only for folders that have a real warehouse_categories row;
                "path-only" folders (inferred from product.category) are
                non-deletable on their own and need the path-soft-delete fallback below. */}
            {deleteFolderTarget.id ? (
              <button
                type="button"
                onClick={() => {
                  deleteCategoryMutation.mutate({ id: deleteFolderTarget.id });
                  setDeleteFolderTarget(null);
                }}
                className="card-interactive w-full flex items-start gap-3 px-4 py-3 text-left"
              >
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 flex-shrink-0">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">Удалить только папку</p>
                  <p className="text-xs text-gray-500 mt-0.5">Товары внутри переедут в корень склада</p>
                </div>
              </button>
            ) : null}

            {/* Option 2 — soft-delete the folder's contents.
                For id-backed folders we hit the backend's deleteContents flag.
                For path-only folders we fan out per-product DELETE requests so
                every product whose category sits in this path lands in the trash. */}
            <button
              type="button"
              onClick={() => {
                if (deleteFolderTarget.id) {
                  deleteCategoryMutation.mutate({ id: deleteFolderTarget.id, deleteContents: true });
                } else if (deleteFolderTarget.path) {
                  deletePathContentsMutation.mutate(deleteFolderTarget.path);
                }
                setDeleteFolderTarget(null);
              }}
              className="card-interactive w-full flex items-start gap-3 px-4 py-3 text-left border-red-100 hover:border-red-200"
            >
              <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-500 flex-shrink-0">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">Удалить вместе с товарами</p>
                <p className="text-xs text-gray-500 mt-0.5">Товары попадут в корзину, можно будет восстановить</p>
              </div>
            </button>

            <button type="button" onClick={() => setDeleteFolderTarget(null)} className="btn-ghost w-full">
              Отмена
            </button>
          </div>
        </Modal>
      )}

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
                      const targetCategory =
                        activePath.length > 0
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
            <button
              type="button"
              onClick={() => {
                setWarehouseOpsMode('inventory');
                setWarehouseOpsProducts({});
              }}
              className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-blue-50 transition-colors text-left border border-gray-100"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <ClipboardCheck className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Инвентаризация</p>
                <p className="text-xs text-gray-500">Пересчёт остатков на складе</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setWarehouseOpsMode('writeoff');
                setWarehouseOpsProducts({});
              }}
              className="w-full flex items-center gap-3 p-4 rounded-xl hover:bg-orange-50 transition-colors text-left border border-gray-100"
            >
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
        <Modal
          isOpen
          onClose={() => {
            setWarehouseOpsMode(null);
            setWarehouseOpsOpen(false);
          }}
          title="Инвентаризация"
          size="lg"
        >
          <GlobalInventoryForm
            products={allProducts}
            categories={categories}
            activePath={activePath}
            onSubmit={async (items) => {
              for (const item of items) {
                await productsApi.updateStock(item.productId, {
                  type: 'inventory',
                  quantity: item.actual,
                  reason: item.reason || 'Инвентаризация',
                });
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
        <Modal
          isOpen
          onClose={() => {
            setWarehouseOpsMode(null);
            setWarehouseOpsOpen(false);
          }}
          title="Списание товаров"
          size="lg"
        >
          <GlobalWriteoffForm
            products={allProducts}
            onSubmit={async (items) => {
              for (const item of items) {
                await productsApi.updateStock(item.productId, {
                  type: 'writeoff',
                  quantity: item.quantity,
                  reason: item.reason,
                });
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
                    const folderPath =
                      activePath.length > 0 ? activePath.join('/') + '/' + newFolderName.trim() : newFolderName.trim();
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
        <Modal
          isOpen
          onClose={() => {
            setShowImportModal(false);
            setImportData(null);
          }}
          title="Импорт товаров"
          size="lg"
        >
          <div className="space-y-4">
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
              <p className="text-xs font-semibold text-blue-900 mb-1">Поддерживаются Excel (.xlsx, .xls) и CSV файлы</p>
              <p className="text-[11px] text-blue-800 font-mono">
                Наименование | Группа | Единица измерения | Цена продажи | Цена закупки
              </p>
              <p className="text-[10px] text-blue-600 mt-1">
                Колонки определяются автоматически по заголовку. Группы/папки через /
              </p>
            </div>
            <p className="text-sm text-gray-600">
              Найдено <span className="font-bold text-gray-900">{importData.length}</span> товаров для импорта. Товары с
              совпадающими названиями будут обновлены.
            </p>

            <div className="max-h-80 overflow-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Название</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Группа</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-600">Ед.</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Продажа</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Закупка</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-600">Остаток</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {importData.slice(0, 50).map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{item.name}</td>
                      <td className="px-3 py-2 text-gray-500">{item.category || '—'}</td>
                      <td className="px-3 py-2 text-center text-gray-500">
                        {unitLabel(item.unit) !== DEFAULT_UNIT ? unitLabel(item.unit) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{item.sellPrice || 0}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{item.costPrice || 0}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{item.stock || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importData.length > 50 && (
                <p className="text-center text-xs text-gray-400 py-2">... и ещё {importData.length - 50} товаров</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setImportData(null);
                }}
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

      {/* Photo preview overlay — shown on long-press/right-click on thumbnail */}
      {photoPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPhotoPreview(null)}
          onTouchEnd={() => setPhotoPreview(null)}
        >
          <img src={photoPreview} alt="" className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain" />
        </div>
      )}

      {/* Trash bin — soft-deleted products with restore / hard-delete / empty */}
      <TrashModal isOpen={trashOpen} onClose={() => setTrashOpen(false)} />
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

function InventoryReport({ items, onClose }: { items: InventoryReportItem[]; onClose: () => void }) {
  const shortageItems = items.filter((i) => i.diff < 0);
  const excessItems = items.filter((i) => i.diff > 0);
  const matchItems = items.filter((i) => i.diff === 0);

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
            {shortageItems.map((item) => (
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
            {excessItems.map((item) => (
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
            {matchItems.map((item) => (
              <div key={item.productId} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-[11px] text-gray-400">
                      Остаток: {item.actual} {unitLabel(item.unit)}
                    </p>
                  </div>
                  <CheckIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center justify-end pt-3 border-t border-gray-100">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
        >
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
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const filtered = useMemo(() => {
    let list = products.filter((p) => !p.isBundle);
    if (filterCat) {
      list = list.filter((p) => p.category === filterCat || (p.category && p.category.startsWith(filterCat + '/')));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
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
    if (items.length === 0) {
      toast.error('Укажите фактические остатки');
      return;
    }
    setSubmitting(true);
    try {
      // Build report data before submitting (uses current stock values)
      const report: InventoryReportItem[] = items.map((item) => {
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
    return <InventoryReport items={reportItems} onClose={onClose} />;
  }

  const countedIds = new Set(Object.keys(entries).filter((id) => entries[id].actual !== ''));

  return (
    <div className="space-y-4 max-h-[70vh] flex flex-col">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск товара..."
            className="input pl-9"
          />
        </div>
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="input w-auto">
          <option value="">Все папки</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
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
            <div
              className={`rounded-xl border p-3 mb-2 transition-colors ${isCounted ? 'border-green-200 bg-green-50/30' : 'border-gray-100 bg-white'}`}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-[11px] text-gray-400">
                    В системе: <span className="font-semibold text-gray-600">{p.stock}</span> {unitLabel(p.unit)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number"
                    value={entry.actual}
                    onChange={(e) =>
                      setEntries((prev) => ({
                        ...prev,
                        [p.id]: { ...(prev[p.id] || { reason: '' }), actual: e.target.value },
                      }))
                    }
                    placeholder="Факт"
                    className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-center font-semibold focus:border-primary-500 focus:outline-none"
                    min="0"
                    step="any"
                  />
                  {diff !== null && diff !== 0 && (
                    <span className={`text-xs font-bold ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {diff > 0 ? '+' : ''}
                      {diff}
                    </span>
                  )}
                  {isCounted && diff === 0 && <CheckIcon className="w-4 h-4 text-green-500" />}
                </div>
              </div>
            </div>
          );
        }}
      />
      {filtered.length === 0 && <div className="text-center py-8 text-sm text-gray-400">Товары не найдены</div>}

      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400">{countedIds.size} позиций</p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || countedIds.size === 0}
          className="flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
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
    let list = products.filter((p) => !p.isBundle && p.stock > 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
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
    if (items.length === 0) {
      toast.error('Укажите количество для списания');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(items);
    } finally {
      setSubmitting(false);
    }
  };

  const count = Object.values(entries).filter((v) => v.quantity !== '' && parseFloat(v.quantity) > 0).length;

  return (
    <div className="space-y-4 max-h-[70vh] flex flex-col">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск товара..."
          className="input pl-9"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Общая причина списания</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Брак, просрочка..."
          className="input"
        />
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
                  <p className="text-[11px] text-gray-400">
                    Остаток: <span className="font-semibold text-gray-600">{p.stock}</span> {unitLabel(p.unit)}
                  </p>
                </div>
                <input
                  type="number"
                  value={entry.quantity}
                  onChange={(e) =>
                    setEntries((prev) => ({
                      ...prev,
                      [p.id]: { quantity: e.target.value, reason: prev[p.id]?.reason || '' },
                    }))
                  }
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
      {filtered.length === 0 && <div className="text-center py-8 text-sm text-gray-400">Товары не найдены</div>}

      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400">{count} позиций</p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || count === 0}
          className="flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageMinus className="w-4 h-4" />}
          Списать
        </button>
      </div>
    </div>
  );
}
