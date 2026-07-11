import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Search,
  FolderOpen,
  ChevronLeft,
  Package,
  X,
  Receipt,
  CreditCard,
  Banknote,
  Calculator,
  Minus,
  UserIcon,
  UserCheck,
  CalendarDays,
  Gauge,
  Pencil,
  ShieldCheck,
  ChevronDown as ChevronDownIcon,
  Warehouse as WarehouseIcon,
  LayoutTemplate,
  BookmarkPlus,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru as ruLocale } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  checksApi,
  clientsApi,
  carsApi,
  usersApi,
  servicesApi,
  productsApi,
  warrantyApi,
  warehousesApi,
} from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type {
  Client,
  Car,
  User,
  Service,
  Product,
  CheckServiceLine,
  CheckProductLine,
  CheckTemplate,
  WarrantyClaim,
  Warehouse,
  PosSettings,
} from '../types';
import { UserRole } from '../types';
import { formatPhone } from '../../../shared/validation/phone';
import { DEFAULT_UNIT, MIN_QTY, formatQty, parseQtyInput, roundQty, unitLabel } from '../utils/units';
import LastVisitBadge from '../components/LastVisitBadge';
import Modal from '../components/Modal';
import ClientSearchAutocomplete from '../components/ClientSearchAutocomplete';
import { TemplatePickerModal, SaveTemplateModal } from '../components/CheckTemplatesModals';

const formatCurrency = (value: number): string => {
  return value.toLocaleString('ru-RU') + ' \u20BD';
};

/**
 * clientRequestId \u2014 \u043A\u043B\u044E\u0447 \u0438\u0434\u0435\u043C\u043F\u043E\u0442\u0435\u043D\u0442\u043D\u043E\u0441\u0442\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0447\u0435\u043A\u0430 (\u0431\u044D\u043A\u0435\u043D\u0434, \u043C\u0438\u0433\u0440\u0430\u0446\u0438\u044F 111:
 * \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u043E\u0434\u0438\u043D \u0447\u0435\u043A \u043D\u0430 (tenant, clientRequestId)). \u0413\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u0435\u0442\u0441\u044F \u041E\u0414\u0418\u041D \u0440\u0430\u0437 \u043D\u0430
 * \u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0441\u0430\u0431\u043C\u0438\u0442 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u0435\u0442\u0441\u044F \u043F\u0440\u0438 \u0440\u0435\u0442\u0440\u0430\u0435 \u0442\u043E\u0433\u043E \u0436\u0435 \u0441\u0430\u0431\u043C\u0438\u0442\u0430 (\u0440\u0443\u0447\u043D\u043E\u0439 \u043F\u043E\u0432\u0442\u043E\u0440
 * \u043F\u043E\u0441\u043B\u0435 \u043E\u0448\u0438\u0431\u043A\u0438, replay \u0438\u0437 SW-\u043E\u0444\u043B\u0430\u0439\u043D-\u043E\u0447\u0435\u0440\u0435\u0434\u0438) \u2014 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u044B\u0439 POST \u0432\u0435\u0440\u043D\u0451\u0442 \u0423\u0416\u0415
 * \u0441\u043E\u0437\u0434\u0430\u043D\u043D\u044B\u0439 \u0447\u0435\u043A \u0432\u043C\u0435\u0441\u0442\u043E \u0434\u0443\u0431\u043B\u044F. \u0411\u044D\u043A\u0435\u043D\u0434 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 hex-UUID \u0444\u043E\u0440\u043C\u0443 (\u0438\u043D\u0430\u0447\u0435 400).
 */
function generateClientRequestId(): string {
  const cryptoObj = typeof crypto !== 'undefined' ? (crypto as { randomUUID?: () => string }) : undefined;
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID();
  // \u0424\u043E\u043B\u0431\u044D\u043A \u0434\u043B\u044F \u0441\u0442\u0430\u0440\u044B\u0445 WebView \u0431\u0435\u0437 randomUUID \u2014 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F UUID v4-\u0444\u043E\u0440\u043C\u0430
  // (\u0437\u0435\u0440\u043A\u0430\u043B\u0438\u0442 mobile/src/utils/offlineCheckQueue.ts::uuidV4FromRandom).
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Мерные единицы — только они получают дробный шаг 0.5 при добавлении. */
const METERED_UNITS = new Set(['м', 'кг', 'л']);

interface ServiceLineForm {
  serviceId: string;
  masterId: string;
  name: string;
  price: number;
  quantity: number;
}

interface ProductLineForm {
  productId: string;
  name: string;
  sellPrice: number;
  costPrice: number;
  quantity: number;
  unit?: string;
}

/**
 * QtyInput — поле количества строки товара (120, дробные количества).
 * Зеркало QtyInput из mobile/CheckCreateScreen.
 *
 * Старый контролируемый number-input (`value={line.quantity}` + пере-парс
 * на каждом символе) физически не давал набрать дробь: «0.» парсился в 0 →
 * `|| 0` → clamp в MIN_QTY → поле мгновенно перерисовывалось как «0.001»,
 * точка съедалась — и строка на ~0 ₽ могла тихо сохраниться. Здесь черновик
 * текста живёт локально: наверх коммитим каждое валидное значение ≥ MIN_QTY
 * (0.001), а на blur нормализуем отображение («2,» → «2», пусто/0 → откат к
 * последнему валидному). Запятая = точка, глубже 3 знаков не уходит
 * (parseQtyInput округляет — ровно NUMERIC(12,3)). Степперы ± снаружи
 * продолжают работать: пока поле не в фокусе, внешние изменения значения
 * синхронизируются в черновик.
 */
function QtyInput({
  value,
  onCommit,
  className,
}: {
  value: number;
  onCommit: (n: number) => void;
  className?: string;
}) {
  const [text, setText] = useState(() => formatQty(value));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(formatQty(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        const n = parseQtyInput(v);
        if (n !== null && n >= MIN_QTY) onCommit(n);
      }}
      onFocus={(e) => {
        focusedRef.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focusedRef.current = false;
        const n = parseQtyInput(text);
        if (n === null || n < MIN_QTY) {
          setText(formatQty(value));
        } else {
          setText(formatQty(n));
          onCommit(n);
        }
      }}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// Product Picker Modal
// ---------------------------------------------------------------------------

interface ProductPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onSelectProduct: (product: Product) => void;
  /** Available warehouses to pick from. Hidden if 0 or 1 warehouse. */
  warehouses?: Warehouse[];
  /** Currently selected warehouse id (controlled). */
  selectedWarehouseId?: string;
  /** Called when the user switches warehouse. */
  onSelectWarehouse?: (id: string) => void;
}

const WAREHOUSE_KIND_LABELS: Record<Warehouse['kind'], string> = {
  main: 'Основной склад',
  defect: 'Склад брака',
  used: 'Склад Б/У',
};

function ProductPickerModal({
  isOpen,
  onClose,
  products,
  onSelectProduct,
  warehouses,
  selectedWarehouseId,
  onSelectWarehouse,
}: ProductPickerModalProps) {
  const [search, setSearch] = useState('');
  const [activePath, setActivePath] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setActivePath([]);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Build hierarchical folder structure from path-based categories
  const { subfolders, currentProducts } = useMemo(() => {
    const prefix = activePath.length > 0 ? activePath.join('/') : '';
    const subfolderMap = new Map<string, number>();
    const prods: Product[] = [];

    for (const p of products) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];

      if (activePath.length === 0) {
        if (!cat) {
          prods.push(p);
        } else {
          const folder = catParts[0];
          subfolderMap.set(folder, (subfolderMap.get(folder) || 0) + 1);
        }
      } else {
        if (cat === prefix) {
          prods.push(p);
        } else if (cat.startsWith(prefix + '/')) {
          const rest = cat.slice(prefix.length + 1);
          const nextSegment = rest.split('/')[0];
          subfolderMap.set(nextSegment, (subfolderMap.get(nextSegment) || 0) + 1);
        }
      }
    }

    const sorted = Array.from(subfolderMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { subfolders: sorted, currentProducts: prods };
  }, [products, activePath]);

  // Global search across all products
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q)),
    );
  }, [products, search]);

  const handleSelect = (product: Product) => {
    onSelectProduct(product);
    onClose();
  };

  const goBack = () => {
    if (activePath.length > 0) {
      setActivePath((prev) => prev.slice(0, -1));
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  const breadcrumbLabel = activePath.length > 0 ? activePath[activePath.length - 1] : 'Товары';

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        <button type="button" onClick={goBack} className="p-2 -ml-2 rounded-lg hover:bg-gray-100 text-gray-600">
          {activePath.length > 0 ? <ChevronLeft className="w-5 h-5" /> : <X className="w-5 h-5" />}
        </button>
        <div className="flex-1 min-w-0">
          {activePath.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-gray-400 mb-0.5 overflow-hidden">
              <button type="button" onClick={() => setActivePath([])} className="hover:text-primary-600 flex-shrink-0">
                Товары
              </button>
              {activePath.map((seg, idx) => (
                <span key={idx} className="flex items-center gap-1 min-w-0">
                  <span className="flex-shrink-0">/</span>
                  <button
                    type="button"
                    onClick={() => setActivePath(activePath.slice(0, idx + 1))}
                    className={
                      idx === activePath.length - 1
                        ? 'text-gray-900 font-medium truncate'
                        : 'hover:text-primary-600 truncate'
                    }
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>
          )}
          <h2 className="text-lg font-semibold text-gray-900 leading-tight truncate">{breadcrumbLabel}</h2>
        </div>
      </div>

      {/* Warehouse switcher — visible if more than 1 warehouse exists */}
      {warehouses && warehouses.length > 1 && (
        <div className="px-4 pt-3 pb-1 border-b border-gray-100 bg-gray-50 flex-shrink-0">
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-2">
            {warehouses.map((w) => {
              const active = w.id === selectedWarehouseId;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => onSelectWarehouse?.(w.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
                    active
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300'
                  }`}
                >
                  <WarehouseIcon className="w-3.5 h-3.5" />
                  {w.name || WAREHOUSE_KIND_LABELS[w.kind]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск товара..."
            className="input pl-10 w-full"
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {search.trim() ? (
          /* Search results */
          <div className="p-4">
            {searchResults.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Ничего не найдено</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {searchResults.map((product) => (
                  <ProductCard key={product.id} product={product} onSelect={handleSelect} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Subfolders */}
            {subfolders.length > 0 && (
              <div className="space-y-2">
                {subfolders.map((folder) => (
                  <button
                    key={folder.name}
                    type="button"
                    onClick={() => setActivePath((prev) => [...prev, folder.name])}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    <FolderOpen className="w-5 h-5 text-amber-500 flex-shrink-0" />
                    <span className="flex-1 text-left font-medium text-gray-900 truncate">{folder.name}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{folder.count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Products at current level */}
            {currentProducts.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {currentProducts.map((product) => (
                  <ProductCard key={product.id} product={product} onSelect={handleSelect} />
                ))}
              </div>
            )}

            {/* Empty state */}
            {subfolders.length === 0 && currentProducts.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">{activePath.length > 0 ? 'В этой папке нет товаров' : 'Нет товаров'}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Product Card
// ---------------------------------------------------------------------------

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
}

function ProductCard({ product, onSelect }: ProductCardProps) {
  const inStock = product.stock > 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      className={`flex flex-col bg-white border rounded-xl overflow-hidden text-left transition-shadow hover:shadow-md ${
        inStock ? 'border-gray-200' : 'border-red-200 opacity-60'
      }`}
    >
      <div className="w-full aspect-square bg-gray-100 relative overflow-hidden">
        {product.photo ? (
          <img src={product.photo} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-10 h-10 text-gray-300" />
          </div>
        )}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          {product.isBundle && (
            <span className="text-[9px] font-bold bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full">КМП</span>
          )}
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
              inStock ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {inStock ? `${product.stock}` : '\u041D\u0435\u0442'}
          </span>
        </div>
      </div>
      <div className="p-2.5 flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-900 line-clamp-2 leading-tight">{product.name}</span>
        <span className="text-sm font-bold text-primary-600">{formatCurrency(product.sellPrice)}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function CheckCreatePage() {
  const navigate = useNavigate();
  const { id: editCheckId } = useParams<{ id: string }>();
  const isEditMode = !!editCheckId;
  const queryClient = useQueryClient();
  const { user, isRole, hasPermission } = useAuth();
  const canEditDate = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);
  // «Сменить владельца» (feature #9) — gated by clients_edit; owner-class
  // (superadmin/director/admin) bypasses. hasPermission already returns true for
  // superadmin/director; ADMIN is added explicitly to match ClientDetailPage.
  const canReassignOwner = isRole(UserRole.ADMIN) || hasPermission('clients_edit');
  const canSellInstallment = hasPermission('sell_installment');
  // Рассрочка — только на НОВОМ чеке (parity с mobile: canOfferInstallment).
  // План создаётся сервером в create(); правка чека план создать не умеет,
  // бэк смену способа на 'installment' отклоняет — иначе остаток чека навсегда
  // повис бы в корзине «Рассрочка (долг)» без возможности погашения.
  const canOfferInstallment = canSellInstallment && !isEditMode;

  // Plate number search state
  const [plateSearch, setPlateSearch] = useState('');
  const [showPlateDropdown, setShowPlateDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedCarId, setSelectedCarId] = useState('');
  const plateInputRef = useRef<HTMLInputElement>(null);

  // Ключ идемпотентности текущего логического сабмита (create-режим).
  // Живёт от первой попытки до успеха: ретрай после ошибки шлёт ТОТ ЖЕ id,
  // и сервер не создаст дубль чека. Сбрасывается в onSuccess.
  const clientRequestIdRef = useRef<string | null>(null);

  // Form fields (no top-level master — current user is the default)
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [editingDate, setEditingDate] = useState(false);
  const [mileage, setMileage] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [comment, setComment] = useState('');
  const [discount, setDiscount] = useState(0);
  const [isDeferred, setIsDeferred] = useState(false);

  // Payment calculation
  const [cashGiven, setCashGiven] = useState<number>(0);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [cardAmount, setCardAmount] = useState<number>(0);

  // Рассрочка (installment): первый взнос (нал + карта) + дата следующего платежа.
  const [installmentCash, setInstallmentCash] = useState<number>(0);
  const [installmentCard, setInstallmentCard] = useState<number>(0);
  const [installmentNextDate, setInstallmentNextDate] = useState('');
  const [installmentComment, setInstallmentComment] = useState('');

  // Service lines
  const [serviceLines, setServiceLines] = useState<ServiceLineForm[]>([]);

  // Product lines
  const [productLines, setProductLines] = useState<ProductLineForm[]>([]);

  // Product picker modal
  const [showProductPicker, setShowProductPicker] = useState(false);

  // Шаблоны чеков (parity с mobile): пикер + «Сохранить как шаблон»
  const [showTemplatesPicker, setShowTemplatesPicker] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  // Warehouse filter for product picker (defaults to main warehouse)
  const [pickerWarehouseId, setPickerWarehouseId] = useState<string>('');
  const [warrantyExpanded, setWarrantyExpanded] = useState(false);

  // «Сменить владельца» modal (feature #9) — reassign the selected car to
  // another client without leaving the Касса screen.
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<Client | null>(null);

  // Prevent accidental page leave
  useEffect(() => {
    window.history.pushState({ checkGuard: true }, '');
    const handler = () => {
      if (serviceLines.length > 0 || productLines.length > 0) {
        window.history.pushState({ checkGuard: true }, '');
      }
    };
    window.addEventListener('popstate', handler);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (serviceLines.length > 0 || productLines.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('popstate', handler);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [serviceLines.length, productLines.length]);

  // Fetch masters (cached 60s — staff rarely changes)
  const { data: masters } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters();
      return res.data;
    },
    staleTime: 60_000,
  });

  // Fetch clients by plate number search
  const { data: clientsData } = useQuery<Client[]>({
    queryKey: ['clients', plateSearch],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search: plateSearch, limit: 20 });
      return res.data?.data ?? res.data;
    },
    enabled: plateSearch.length >= 1,
  });

  // Fetch all services (cached 60s — catalog data)
  const { data: allServices } = useQuery<Service[]>({
    queryKey: ['services-all'],
    queryFn: async () => {
      const res = await servicesApi.getAll({ limit: 1000 });
      return res.data?.data ?? res.data;
    },
    staleTime: 60_000,
  });

  // Fetch all products (cached 60s — catalog data). We always pull the full
  // catalogue here; the picker is filtered client-side by selected warehouse
  // so flipping warehouses is instant.
  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['products-all'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 1000 });
      return res.data?.data ?? res.data;
    },
    staleTime: 60_000,
  });

  // Warehouses for the picker switcher. Main / defect / used.
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 5 * 60_000,
  });
  // POS «Кассовая смера + роли» (092). Mode OFF (default) → no change.
  // When shift-mode is ON and the current user is NOT a cashier, the server
  // forces this order to be deferred and rejects payment. We mirror that here:
  // hide the payment UI and force the deferred flag (server is source of truth).
  const { data: posSettings } = useQuery<PosSettings>({
    queryKey: ['checks', 'pos-settings'],
    queryFn: async () => (await checksApi.getPosSettings()).data,
    staleTime: 60_000,
  });
  const cashierLocked = !!posSettings?.shiftModeEnabled && !posSettings?.isCashier;
  useEffect(() => {
    if (cashierLocked) setIsDeferred(true);
  }, [cashierLocked]);

  // Default the picker to the main warehouse once the list arrives.
  useEffect(() => {
    if (!pickerWarehouseId && warehouses && warehouses.length > 0) {
      const main = warehouses.find((w) => w.kind === 'main') || warehouses[0];
      setPickerWarehouseId(main.id);
    }
  }, [warehouses, pickerWarehouseId]);

  // Active warranties for the currently-selected client+car combo.
  // Tap-to-expand banner — shown above the receipt body.
  const warrantyEnabled = !!(selectedClient?.id || selectedCarId);
  const { data: activeWarranties } = useQuery<WarrantyClaim[]>({
    queryKey: ['active-warranties', selectedClient?.id, selectedCarId],
    queryFn: async () => {
      const res = await warrantyApi.activeForClient({
        clientId: selectedClient?.id,
        carId: selectedCarId || undefined,
      });
      return res.data;
    },
    enabled: warrantyEnabled,
    staleTime: 30_000,
  });

  // Filter the catalogue by chosen warehouse for the picker. We also keep
  // products without a warehouseId (legacy) visible only in the main warehouse.
  const pickerProducts = useMemo<Product[]>(() => {
    const list = allProducts ?? [];
    if (!pickerWarehouseId) return list;
    const isMain = warehouses?.find((w) => w.id === pickerWarehouseId)?.kind === 'main';
    return list.filter((p) => p.warehouseId === pickerWarehouseId || (isMain && !p.warehouseId));
  }, [allProducts, warehouses, pickerWarehouseId]);

  // Load existing check for edit mode
  const { data: existingCheck } = useQuery({
    queryKey: ['check', editCheckId],
    queryFn: async () => {
      const res = await checksApi.getById(editCheckId!);
      return res.data;
    },
    enabled: isEditMode,
  });

  // Pre-fill form when editing
  const [editLoaded, setEditLoaded] = useState(false);
  useEffect(() => {
    if (!existingCheck || editLoaded) return;
    setEditLoaded(true);

    if (existingCheck.client) {
      setSelectedClient(existingCheck.client);
      setSelectedCarId(existingCheck.carId || '');
      const car = existingCheck.client.cars?.find((c: Car) => c.id === existingCheck.carId);
      if (car) setPlateSearch(car.plateNumber);
    }
    setDate(existingCheck.date ? format(new Date(existingCheck.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
    setMileage(existingCheck.mileage ? String(existingCheck.mileage) : '');
    setPaymentMethod(existingCheck.paymentMethod || 'cash');
    setComment(existingCheck.comment || '');
    setDiscount(existingCheck.discount || 0);
    setIsDeferred(existingCheck.isDeferred || false);

    if (existingCheck.services?.length) {
      setServiceLines(
        existingCheck.services.map((s: CheckServiceLine) => ({
          serviceId: s.serviceId || '',
          masterId: s.masterId || user?.id || '',
          name: s.name,
          price: s.price,
          quantity: s.quantity,
        })),
      );
    }
    if (existingCheck.products?.length) {
      setProductLines(
        existingCheck.products.map((p: CheckProductLine) => ({
          productId: p.productId || '',
          name: p.name,
          sellPrice: p.sellPrice,
          costPrice: p.costPrice,
          quantity: p.quantity,
          // 120: backend отдаёт единицу строки (LEFT JOIN products). Старый
          // backend поля не шлёт → undefined → UI покажет дефолт 'шт'.
          unit: p.unit,
        })),
      );
    }
  }, [existingCheck, editLoaded, user?.id]);

  // Mutation
  const createMutation = useMutation({
    mutationFn: (data: any) => checksApi.create(data),
    onSuccess: (res: any) => {
      // Чек создан — следующий сабмит это уже НОВЫЙ логический чек.
      clientRequestIdRef.current = null;
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
      queryClient.invalidateQueries({ queryKey: ['employee-ranking'] });
      queryClient.invalidateQueries({ queryKey: ['products-all'] });
      toast.success('Чек успешно создан');
      navigate(`/checks/${res.data.id}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      if (err?.code === 'ERR_NETWORK' || !err?.response) {
        toast.error('Сервер недоступен. Проверьте подключение.');
      } else if (err?.response?.status === 403) {
        toast.error(msg || 'Нет прав для создания чека');
      } else {
        toast.error(msg || 'Ошибка при создании чека');
      }
    },
  });

  // Update mutation (edit mode)
  const updateMutation = useMutation({
    mutationFn: (data: any) => checksApi.update(editCheckId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['check', editCheckId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
      queryClient.invalidateQueries({ queryKey: ['products-all'] });
      toast.success('Чек обновлён');
      navigate(`/checks/${editCheckId}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      if (err?.code === 'ERR_NETWORK' || !err?.response) {
        toast.error('Сервер недоступен. Проверьте подключение.');
      } else if (err?.response?.status === 403) {
        toast.error(msg || 'Нет прав для редактирования чека');
      } else {
        toast.error(msg || 'Ошибка при обновлении чека');
      }
    },
  });

  // «Сменить владельца» (feature #9): reassign the currently-selected car to
  // another client, then re-point this (unsaved) check's client to the new
  // owner in local state. Car id is stable across reassign, so selectedCarId is
  // preserved. We refetch the target client to get its full record (including
  // the freshly-attached car) for the selected-client display. Backend guards a
  // duplicate plate under the target client and answers 400 — surfaced as-is.
  const reassignMutation = useMutation({
    mutationFn: async (target: Client) => {
      await carsApi.update(selectedCarId, { clientId: target.id });
      // Fresh target record — has the newly-attached car in its cars[].
      const res = await clientsApi.getById(target.id);
      return res.data as Client;
    },
    onSuccess: (freshOwner) => {
      setSelectedClient(freshOwner);
      // selectedCarId stays the same — the car now lives under freshOwner.
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      queryClient.invalidateQueries({ queryKey: ['active-warranties'] });
      toast.success('Владелец автомобиля изменён');
      closeReassignModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Не удалось сменить владельца');
    },
  });

  const openReassignModal = () => {
    setReassignTarget(null);
    setReassignOpen(true);
  };

  const closeReassignModal = () => {
    setReassignOpen(false);
    setReassignTarget(null);
  };

  const confirmReassign = () => {
    if (!reassignTarget) return;
    reassignMutation.mutate(reassignTarget);
  };

  // Computed totals
  const serviceTotal = useMemo(() => {
    return serviceLines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  }, [serviceLines]);

  const productTotal = useMemo(() => {
    return productLines.reduce((sum, line) => sum + line.sellPrice * line.quantity, 0);
  }, [productLines]);

  const totalRevenue = useMemo(() => {
    const discountedProducts = Math.max(productTotal - discount, 0);
    return serviceTotal + discountedProducts;
  }, [serviceTotal, productTotal, discount]);

  // Change calculation for cash payment
  const changeAmount = useMemo(() => {
    if (paymentMethod === 'cash') {
      return Math.max(cashGiven - totalRevenue, 0);
    }
    return 0;
  }, [cashGiven, totalRevenue, paymentMethod]);

  // Auto-sync cash/card amounts for mixed payment
  useEffect(() => {
    if (paymentMethod === 'cash') {
      setCashAmount(totalRevenue);
      setCardAmount(0);
    } else if (paymentMethod === 'card') {
      setCashAmount(0);
      setCardAmount(totalRevenue);
    }
  }, [paymentMethod, totalRevenue]);

  // Flatten cars from found clients for plate-based dropdown
  const plateResults = useMemo(() => {
    if (!clientsData) return [];
    const results: { client: Client; car: Car }[] = [];
    for (const client of clientsData) {
      if (client.cars) {
        for (const car of client.cars) {
          if (plateSearch && car.plateNumber.toLowerCase().includes(plateSearch.toLowerCase())) {
            results.push({ client, car });
          }
        }
      }
    }
    if (results.length === 0) {
      for (const client of clientsData) {
        if (client.cars) {
          for (const car of client.cars) {
            results.push({ client, car });
          }
        }
      }
    }
    return results;
  }, [clientsData, plateSearch]);

  // Client/Car selection via plate number
  const handleSelectPlateResult = (client: Client, car: Car) => {
    setSelectedClient(client);
    setSelectedCarId(car.id);
    setPlateSearch(car.plateNumber);
    setShowPlateDropdown(false);
  };

  // Service line handlers — default masterId = current user
  const addServiceLine = () => {
    setServiceLines((prev) => [...prev, { serviceId: '', masterId: user?.id || '', name: '', price: 0, quantity: 1 }]);
  };

  const updateServiceLine = (index: number, field: keyof ServiceLineForm, value: any) => {
    setServiceLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const updated = { ...line, [field]: value };
        if (field === 'serviceId' && allServices) {
          const svc = allServices.find((s) => s.id === value);
          if (svc) {
            updated.name = svc.name;
            updated.price = svc.defaultPrice;
          }
        }
        return updated;
      }),
    );
  };

  const removeServiceLine = (index: number) => {
    setServiceLines((prev) => prev.filter((_, i) => i !== index));
  };

  // Product line handlers
  const handleProductSelected = useCallback(
    (product: Product) => {
      // If it's a bundle, add each component product
      if (product.isBundle && product.bundleItems && product.bundleItems.length > 0) {
        setProductLines((prev) => {
          let updated = [...prev];
          for (const bi of product.bundleItems!) {
            const matchProduct = (allProducts ?? []).find((p) => p.id === bi.productId);
            const existing = updated.findIndex((l) => l.productId === bi.productId);
            if (existing !== -1) {
              updated = updated.map((line, i) =>
                i === existing ? { ...line, quantity: roundQty(line.quantity + bi.quantity) } : line,
              );
            } else {
              updated.push({
                productId: bi.productId,
                name: bi.name,
                sellPrice: matchProduct?.sellPrice ?? 0,
                costPrice: matchProduct?.costPrice ?? 0,
                quantity: bi.quantity,
              });
            }
          }
          return updated;
        });
        toast.success(`Комплект "${product.name}" добавлен`);
        return;
      }

      setProductLines((prev) => {
        // 120: русские метки единиц ('шт'…) + legacy-коды ('pcs') — сравниваем
        // через unitLabel. Дробный шаг 0.5 — только у МЕРНЫХ единиц (м/кг/л);
        // уп/компл/шт дискретны и шагают по 1 (паритет с мобилкой).
        const step = METERED_UNITS.has(unitLabel(product.unit)) ? 0.5 : 1;
        const existing = prev.findIndex((l) => l.productId === product.id);
        if (existing !== -1) {
          return prev.map((line, i) => (i === existing ? { ...line, quantity: roundQty(line.quantity + step) } : line));
        }
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            sellPrice: product.sellPrice,
            costPrice: product.costPrice,
            quantity: step,
            unit: product.unit || DEFAULT_UNIT,
          },
        ];
      });
    },
    [allProducts],
  );

  const updateProductLine = (index: number, field: keyof ProductLineForm, value: any) => {
    setProductLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        return { ...line, [field]: value };
      }),
    );
  };

  const removeProductLine = (index: number) => {
    setProductLines((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Шаблоны чеков ─────────────────────────────────────────────────────
  // Применение ЗАМЕЩАЕТ строки формы (semantics mobile applyTemplate):
  // услуги получают мастером текущего пользователя, товары подтягивают
  // unit из каталога (шаг количества на web зависит от единицы измерения).
  const applyTemplate = (template: CheckTemplate) => {
    setServiceLines(
      template.services.map((s) => ({
        serviceId: s.serviceId || '',
        masterId: user?.id || '',
        name: s.name,
        price: s.price,
        quantity: s.quantity,
      })),
    );
    setProductLines(
      template.products.map((p) => {
        const catalogProduct = (allProducts ?? []).find((ap) => ap.id === p.productId);
        return {
          productId: p.productId || '',
          name: p.name,
          sellPrice: p.sellPrice,
          costPrice: p.costPrice,
          quantity: p.quantity,
          unit: catalogProduct?.unit || DEFAULT_UNIT,
        };
      }),
    );
    setShowTemplatesPicker(false);
    toast.success(`Шаблон «${template.name}» применён`);
  };

  // В шаблон уходят только строки с catalog-id (как на mobile): произвольная
  // строка без привязки к справочнику в шаблоне бесполезна.
  const templateServices = useMemo(
    () =>
      serviceLines
        .filter((l) => !!l.serviceId)
        .map((l) => ({ serviceId: l.serviceId, name: l.name, price: Number(l.price), quantity: Number(l.quantity) })),
    [serviceLines],
  );
  const templateProducts = useMemo(
    () =>
      productLines
        .filter((l) => !!l.productId)
        .map((l) => ({
          productId: l.productId,
          name: l.name,
          sellPrice: Number(l.sellPrice),
          costPrice: Number(l.costPrice),
          quantity: Number(l.quantity),
        })),
    [productLines],
  );
  const canSaveTemplate = templateServices.length + templateProducts.length > 0;

  // Submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Client and car are optional (retail buyer mode)

    const services: CheckServiceLine[] = serviceLines.map((l) => ({
      serviceId: l.serviceId || undefined,
      masterId: l.masterId || undefined,
      name: l.name,
      price: Number(l.price),
      quantity: Number(l.quantity),
      total: Number(l.price) * Number(l.quantity),
    }));

    const products: CheckProductLine[] = productLines.map((l) => ({
      productId: l.productId || undefined,
      name: l.name,
      sellPrice: Number(l.sellPrice),
      costPrice: Number(l.costPrice),
      quantity: Number(l.quantity),
      totalSell: Number(l.sellPrice) * Number(l.quantity),
      totalCost: Number(l.costPrice) * Number(l.quantity),
    }));

    let finalCash = 0;
    let finalCard = 0;
    if (paymentMethod === 'cash') {
      finalCash = totalRevenue;
    } else if (paymentMethod === 'card') {
      finalCard = totalRevenue;
    } else if (paymentMethod === 'cash_card') {
      // Кламп к «К оплате» (parity с mobile): атрибут max у input не блокирует
      // ручной ввод/вставку — без клампа «наличными 100 000» при чеке 30 000
      // дал бы ноги > оборота, и разбивка «Движения денег» превышала бы оборот.
      finalCash = Math.min(cashAmount, totalRevenue);
      finalCard = Math.max(totalRevenue - finalCash, 0);
    } else if (paymentMethod === 'installment') {
      // Первый взнос (down payment) — наличными + картой; остаток уйдёт в план.
      // Кламп: взнос не может превышать сумму чека — иначе ноги чека разойдутся
      // с down_payment плана (сервер клампит план, ноги должны совпадать).
      finalCash = Math.min(installmentCash, totalRevenue);
      finalCard = Math.min(installmentCard, Math.max(totalRevenue - finalCash, 0));
    }

    const isInstallment = paymentMethod === 'installment';

    const payload = {
      clientId: selectedClient?.id || '',
      carId: selectedCarId || '',
      masterId: user?.id || '',
      date,
      mileage: mileage ? Number(mileage) : undefined,
      services,
      products,
      discount,
      paymentMethod,
      cashAmount: finalCash,
      cardAmount: finalCard,
      comment: comment || undefined,
      // Рассрочка — всегда реальная продажа, отложить нельзя.
      isDeferred: isInstallment ? false : isDeferred,
      ...(isInstallment
        ? {
            installmentNextPaymentDate: installmentNextDate || undefined,
            installmentComment: installmentComment.trim() || undefined,
          }
        : {}),
    };

    if (isEditMode) {
      updateMutation.mutate(payload);
    } else {
      // Один id на логический сабмит: генерируется до первого POST и
      // переиспользуется при ретрае (в т.ч. при replay из SW-офлайн-очереди) —
      // бэкенд дедуплицирует по (tenant, clientRequestId), дубль не возникнет.
      if (!clientRequestIdRef.current) {
        clientRequestIdRef.current = generateClientRequestId();
      }
      createMutation.mutate({ ...payload, clientRequestId: clientRequestIdRef.current });
    }
  };

  const itemCount = serviceLines.length + productLines.length;

  return (
    <div className="max-w-3xl mx-auto pb-8">
      {/* Header */}
      <div className="page-header mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="btn-ghost btn-sm">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary-600" />
            <h1 className="page-title">{isEditMode ? 'Редактировать чек' : 'Новый чек'}</h1>
          </div>
        </div>
        {/* Шаблоны чеков — быстрое заполнение формы (parity с mobile) */}
        <button
          type="button"
          onClick={() => setShowTemplatesPicker(true)}
          className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 hover:text-primary-600 hover:border-primary-200 hover:bg-primary-50 transition-colors flex-shrink-0"
          title="Заполнить чек из шаблона"
        >
          <LayoutTemplate className="w-4 h-4" />
          <span className="hidden sm:inline">Шаблоны</span>
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ===== Receipt-style container ===== */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Receipt header with editable date */}
          <div className="bg-gray-900 text-white px-5 py-4">
            <div className="text-center">
              <h2 className="text-lg font-bold tracking-wider">
                {'\u0417\u0410\u041A\u0410\u0417-\u041D\u0410\u0420\u042F\u0414'}
              </h2>
              <div className="flex items-center justify-center gap-2 mt-1">
                {editingDate ? (
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    onBlur={() => setEditingDate(false)}
                    autoFocus
                    className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                ) : (
                  <>
                    <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
                    <span className="text-gray-400 text-xs">{format(new Date(date + 'T00:00:00'), 'dd.MM.yyyy')}</span>
                    {canEditDate && (
                      <button
                        type="button"
                        onClick={() => setEditingDate(true)}
                        className="p-0.5 rounded hover:bg-gray-700 transition-colors"
                      >
                        <Pencil className="h-3 w-3 text-gray-500 hover:text-gray-300" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Search by plate number */}
          <div className="px-5 pt-5 pb-3 border-b border-dashed border-gray-300">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">
              {'\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0433\u043E\u0441\u043D\u043E\u043C\u0435\u0440\u0443'}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={plateInputRef}
                type="text"
                value={plateSearch}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setPlateSearch(val);
                  setShowPlateDropdown(true);
                  if (!val) {
                    setSelectedClient(null);
                    setSelectedCarId('');
                  }
                }}
                onFocus={() => setShowPlateDropdown(true)}
                placeholder="A123BC77"
                className="input pl-10 text-lg font-mono tracking-widest uppercase"
                autoComplete="off"
              />
              {plateSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setPlateSearch('');
                    setSelectedClient(null);
                    setSelectedCarId('');
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Plate search dropdown */}
            {showPlateDropdown && plateSearch && !selectedClient && plateResults.length > 0 && (
              <div className="mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {plateResults.map(({ client, car }) => (
                  <button
                    key={car.id}
                    type="button"
                    onClick={() => handleSelectPlateResult(client, car)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded">
                        {car.plateNumber}
                      </span>
                      <span className="text-sm text-gray-500">{car.makeModel}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {client.fullName} {'\u2022'} {formatPhone(client.phone)}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Retail buyer default when no client selected */}
            {!selectedClient && !plateSearch && (
              <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium text-blue-700">
                    {
                      '\u0420\u043E\u0437\u043D\u0438\u0447\u043D\u044B\u0439 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C'
                    }
                  </span>
                </div>
                <p className="text-xs text-blue-500 mt-1">
                  {
                    '\u041D\u0430\u0431\u0435\u0440\u0438\u0442\u0435 \u0433\u043E\u0441\u043D\u043E\u043C\u0435\u0440 \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430'
                  }
                </p>
              </div>
            )}

            {/* Selected client/car info */}
            {selectedClient && (
              <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{selectedClient.fullName}</div>
                    <div className="text-xs text-gray-500">{formatPhone(selectedClient.phone)}</div>
                  </div>
                  <div className="text-right">
                    {selectedClient.cars?.find((c) => c.id === selectedCarId) && (
                      <>
                        <div className="font-mono font-bold text-sm">
                          {selectedClient.cars.find((c) => c.id === selectedCarId)?.plateNumber}
                        </div>
                        <div className="text-xs text-gray-500">
                          {selectedClient.cars.find((c) => c.id === selectedCarId)?.makeModel}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {selectedClient.cars && selectedClient.cars.length > 1 && (
                  <div className="mt-2">
                    <select
                      value={selectedCarId}
                      onChange={(e) => setSelectedCarId(e.target.value)}
                      className="input text-sm"
                    >
                      {selectedClient.cars.map((car) => (
                        <option key={car.id} value={car.id}>
                          {car.plateNumber} {'\u2014'} {car.makeModel}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* \u00ab\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u0432\u043b\u0430\u0434\u0435\u043b\u044c\u0446\u0430\u00bb \u2014 reassign the selected car to another
                    client without leaving \u041a\u0430\u0441\u0441\u0430 (feature #9). */}
                {canReassignOwner && selectedCarId && (
                  <button
                    type="button"
                    onClick={openReassignModal}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 transition-colors"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    \u0421\u043c\u0435\u043d\u0438\u0442\u044c \u0432\u043b\u0430\u0434\u0435\u043b\u044c\u0446\u0430
                  </button>
                )}
                <LastVisitBadge clientId={selectedClient.id} carId={selectedCarId || undefined} />
              </div>
            )}

            {/* Active warranties banner — shown when client/car has unclaimed warranties */}
            {warrantyEnabled && activeWarranties && activeWarranties.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setWarrantyExpanded((v) => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-amber-100/50 transition-colors"
                >
                  <ShieldCheck className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span className="text-sm font-semibold text-amber-900 flex-1 text-left">
                    Действующая гарантия — {activeWarranties.length}
                  </span>
                  <ChevronDownIcon
                    className={`w-4 h-4 text-amber-700 transition-transform ${warrantyExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
                {warrantyExpanded && (
                  <div className="border-t border-amber-200 divide-y divide-amber-100">
                    {activeWarranties.map((w) => (
                      <div key={w.id} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                                w.kind === 'product' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                              }`}
                            >
                              {w.kind === 'product' ? 'Товар' : 'Услуга'}
                            </span>
                            <p className="text-xs font-medium text-gray-900 truncate">{w.itemName || '—'}</p>
                          </div>
                          <p className="text-[11px] text-amber-700 mt-0.5">
                            до {format(new Date(w.expiresAt), 'd MMM yyyy', { locale: ruLocale })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mileage */}
          <div className="px-5 py-4 border-b border-dashed border-gray-300">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 flex-shrink-0">
                <Gauge className="h-5 w-5 text-orange-500" />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-[11px] font-medium text-gray-400 block mb-0.5">Пробег</label>
                <div className="relative">
                  <input
                    type="number"
                    value={mileage}
                    onChange={(e) => setMileage(e.target.value)}
                    placeholder="0"
                    className="w-full text-sm h-9 px-2.5 pr-10 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">
                    км
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ===== SERVICES SECTION ===== */}
          <div className="px-5 py-4 border-b border-dashed border-gray-300">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {'\u0423\u0441\u043B\u0443\u0433\u0438'}
              </h3>
              <button
                type="button"
                onClick={addServiceLine}
                className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C'}
              </button>
            </div>

            {serviceLines.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-3 italic">
                {'\u041D\u0435\u0442 \u0443\u0441\u043B\u0443\u0433'}
              </p>
            ) : (
              <div className="space-y-3">
                {serviceLines.map((line, index) => (
                  <div key={index} className="bg-gray-50 rounded-xl p-3 space-y-2">
                    {/* Row 1: Service select + delete */}
                    <div className="flex gap-2">
                      <select
                        value={line.serviceId}
                        onChange={(e) => updateServiceLine(index, 'serviceId', e.target.value)}
                        className="input text-sm flex-1 min-w-0"
                      >
                        <option value="">{'\u0423\u0441\u043B\u0443\u0433\u0430...'}</option>
                        {allServices?.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} {'\u2014'} {formatCurrency(s.defaultPrice)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeServiceLine(index)}
                        className="p-2 text-red-400 hover:text-red-600 rounded-lg hover:bg-red-50 flex-shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Row 2: Master selector (per service) */}
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <select
                        value={line.masterId}
                        onChange={(e) => updateServiceLine(index, 'masterId', e.target.value)}
                        className="input text-xs py-1.5 flex-1 min-w-0"
                      >
                        <option value="">{'\u041C\u0430\u0441\u0442\u0435\u0440...'}</option>
                        {masters?.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.fullName}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Row 3: Price */}
                    <div className="relative">
                      <input
                        type="number"
                        value={line.price}
                        onChange={(e) => updateServiceLine(index, 'price', Number(e.target.value))}
                        className="input text-base sm:text-sm text-right pr-8"
                        placeholder={'\u0426\u0435\u043D\u0430'}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">
                        {'\u20BD'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {serviceLines.length > 0 && (
              <div className="text-right text-sm font-semibold text-gray-600 mt-2 pr-1">
                {'\u0418\u0442\u043E\u0433\u043E: '}
                {formatCurrency(serviceTotal)}
              </div>
            )}
          </div>

          {/* ===== PRODUCTS SECTION ===== */}
          <div className="px-5 py-4 border-b border-dashed border-gray-300">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {'\u0422\u043E\u0432\u0430\u0440\u044B'}
              </h3>
              <button
                type="button"
                onClick={() => setShowProductPicker(true)}
                className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C'}
              </button>
            </div>

            {productLines.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-3 italic">
                {'\u041D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u043E\u0432'}
              </p>
            ) : (
              <div className="space-y-2">
                {productLines.map((line, index) => (
                  <div key={index} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{line.name}</div>
                      <div className="text-xs text-gray-500">
                        {formatCurrency(line.sellPrice)} / {unitLabel(line.unit)}
                      </div>
                    </div>
                    {/* 120: дробный ввод количества разрешён ВСЕГДА (0.5 м
                        шланга), степперы ±1 остаются рядом. */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (line.quantity > 1) {
                            updateProductLine(index, 'quantity', roundQty(line.quantity - 1));
                          }
                        }}
                        className="p-1 rounded hover:bg-gray-200 text-gray-400"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <QtyInput
                        value={line.quantity}
                        onCommit={(n) => updateProductLine(index, 'quantity', n)}
                        className="w-16 text-center text-sm font-medium rounded border border-gray-200 py-1 px-1"
                      />
                      <button
                        type="button"
                        onClick={() => updateProductLine(index, 'quantity', roundQty(line.quantity + 1))}
                        className="p-1 rounded hover:bg-gray-200 text-gray-400"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 flex-shrink-0 whitespace-nowrap">
                      {formatCurrency(line.sellPrice * line.quantity)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeProductLine(index)}
                      className="p-1 text-red-400 hover:text-red-600 flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {productLines.length > 0 && (
              <div className="text-right text-sm font-semibold text-gray-600 mt-2 pr-1">
                {'\u0418\u0442\u043E\u0433\u043E: '}
                {formatCurrency(productTotal)}
              </div>
            )}
          </div>

          {/* ===== RECEIPT SUMMARY ===== */}
          <div className="px-5 py-4 border-b border-dashed border-gray-300 bg-gray-50">
            <div className="space-y-1.5 font-mono text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">
                  {'\u0423\u0441\u043B\u0443\u0433\u0438'} ({serviceLines.length})
                </span>
                <span>{formatCurrency(serviceTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">
                  {'\u0422\u043E\u0432\u0430\u0440\u044B'} ({productLines.length})
                </span>
                <span>{formatCurrency(productTotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-red-500">
                  <span>
                    {'\u0421\u043A\u0438\u0434\u043A\u0430 \u043D\u0430 \u0442\u043E\u0432\u0430\u0440\u044B'}
                  </span>
                  <span>-{formatCurrency(discount)}</span>
                </div>
              )}
              <div className="border-t border-gray-300 pt-1.5 mt-1.5">
                <div className="flex justify-between text-lg font-bold text-gray-900">
                  <span>{'\u0418\u0422\u041E\u0413\u041E'}</span>
                  <span>{formatCurrency(totalRevenue)}</span>
                </div>
              </div>
            </div>

            {/* Discount input */}
            <div className="mt-3 flex items-center gap-2">
              <label className="text-xs text-gray-500 whitespace-nowrap">
                {'\u0421\u043A\u0438\u0434\u043A\u0430 \u043D\u0430 \u0442\u043E\u0432\u0430\u0440\u044B:'}
              </label>
              <input
                type="number"
                value={discount || ''}
                min={0}
                onChange={(e) => setDiscount(Number(e.target.value))}
                className="input text-sm w-28 text-right"
                placeholder="0"
              />
              <span className="text-xs text-gray-400">{'\u20BD'}</span>
            </div>
          </div>

          {/* ===== PAYMENT SECTION ===== */}
          {cashierLocked ? (
            <div className="px-5 py-4 border-b border-dashed border-gray-300">
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
                <Banknote className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">
                    \u0420\u0435\u0436\u0438\u043C \u043A\u0430\u0441\u0441\u043E\u0432\u043E\u0439
                    \u0441\u043C\u0435\u043D\u044B
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    \u041E\u043F\u043B\u0430\u0442\u0443 \u043F\u0440\u043E\u0432\u043E\u0434\u0438\u0442
                    \u043A\u0430\u0441\u0441\u0438\u0440. \u0417\u0430\u043A\u0430\u0437-\u043D\u0430\u0440\u044F\u0434
                    \u0431\u0443\u0434\u0435\u0442 \u0441\u043E\u0437\u0434\u0430\u043D \u043A\u0430\u043A
                    \u043E\u0442\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u0439 \u2014
                    \u043E\u043F\u043B\u0430\u0442\u0443 \u0437\u0430\u043A\u0440\u043E\u0435\u0442
                    \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A \u0441 \u043F\u0440\u0430\u0432\u043E\u043C
                    \u00AB\u041F\u0440\u0438\u0451\u043C \u043E\u043F\u043B\u0430\u0442\u044B\u00BB.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-5 py-4 border-b border-dashed border-gray-300">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                {'\u041E\u043F\u043B\u0430\u0442\u0430'}
              </h3>

              <div className={`grid ${canOfferInstallment ? 'grid-cols-5' : 'grid-cols-4'} gap-2 mb-4`}>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                    paymentMethod === 'cash'
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Banknote className="w-5 h-5" />
                  <span className="text-[10px] font-semibold">{'\u041D\u0430\u043B'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                    paymentMethod === 'card'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <CreditCard className="w-5 h-5" />
                  <span className="text-[10px] font-semibold">{'\u041A\u0430\u0440\u0442\u0430'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash_card')}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                    paymentMethod === 'cash_card'
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Calculator className="w-5 h-5" />
                  <span className="text-[10px] font-semibold">{'\u0421\u043F\u043B\u0438\u0442'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('warranty')}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                    paymentMethod === 'warranty'
                      ? 'border-yellow-500 bg-yellow-50 text-yellow-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Receipt className="w-5 h-5" />
                  <span className="text-[10px] font-semibold">{'\u0413\u0430\u0440.'}</span>
                </button>
                {canOfferInstallment && (
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('installment')}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                      paymentMethod === 'installment'
                        ? 'border-violet-500 bg-violet-50 text-violet-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <CalendarDays className="w-5 h-5" />
                    <span className="text-[10px] font-semibold">
                      {'\u0420\u0430\u0441\u0441\u0440\u043e\u0447\u043a\u0430'}
                    </span>
                  </button>
                )}
              </div>

              {paymentMethod === 'cash' && (
                <div className="bg-green-50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">
                      {'\u041A\u043B\u0438\u0435\u043D\u0442 \u0434\u0430\u043B:'}
                    </label>
                    <input
                      type="number"
                      value={cashGiven || ''}
                      onChange={(e) => setCashGiven(Number(e.target.value))}
                      className="input w-36 text-right text-lg font-bold"
                      placeholder="0"
                    />
                  </div>
                  {cashGiven > 0 && (
                    <div className="flex items-center justify-between border-t border-green-200 pt-2">
                      <span className="text-sm font-medium text-gray-700">{'\u0421\u0434\u0430\u0447\u0430:'}</span>
                      <span className={`text-xl font-bold ${changeAmount > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                        {formatCurrency(changeAmount)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {paymentMethod === 'cash_card' && (
                <div className="bg-purple-50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Banknote className="w-4 h-4 text-green-600" />
                      <label className="text-sm font-medium text-gray-700">
                        {'\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435:'}
                      </label>
                    </div>
                    <input
                      type="number"
                      value={cashAmount || ''}
                      onChange={(e) => setCashAmount(Number(e.target.value))}
                      className="input w-36 text-right text-lg font-bold"
                      placeholder="0"
                      max={totalRevenue}
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-purple-200 pt-2">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-blue-600" />
                      <label className="text-sm font-medium text-gray-700">{'\u041A\u0430\u0440\u0442\u0430:'}</label>
                    </div>
                    <span className="text-lg font-bold text-blue-600">
                      {formatCurrency(Math.max(totalRevenue - cashAmount, 0))}
                    </span>
                  </div>
                </div>
              )}

              {paymentMethod === 'installment' && (
                <div className="bg-violet-50 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">{'Первый взнос'}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Banknote className="w-4 h-4 text-green-600" />
                      <label className="text-sm font-medium text-gray-700">{'Наличными:'}</label>
                    </div>
                    <input
                      type="number"
                      value={installmentCash || ''}
                      onChange={(e) => setInstallmentCash(Number(e.target.value))}
                      className="input w-36 text-right text-lg font-bold"
                      placeholder="0"
                      max={totalRevenue}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-blue-600" />
                      <label className="text-sm font-medium text-gray-700">{'Картой:'}</label>
                    </div>
                    <input
                      type="number"
                      value={installmentCard || ''}
                      onChange={(e) => setInstallmentCard(Number(e.target.value))}
                      className="input w-36 text-right text-lg font-bold"
                      placeholder="0"
                      max={totalRevenue}
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-violet-200 pt-2">
                    <span className="text-sm font-medium text-gray-700">{'Остаток в рассрочку:'}</span>
                    <span className="text-lg font-bold text-violet-700">
                      {formatCurrency(Math.max(totalRevenue - installmentCash - installmentCard, 0))}
                    </span>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{'Дата следующего платежа'}</label>
                    <input
                      type="date"
                      value={installmentNextDate}
                      onChange={(e) => setInstallmentNextDate(e.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{'Комментарий'}</label>
                    <input
                      type="text"
                      value={installmentComment}
                      onChange={(e) => setInstallmentComment(e.target.value)}
                      className="input"
                      placeholder={'Условия рассрочки (необязательно)'}
                    />
                  </div>
                </div>
              )}

              {paymentMethod !== 'installment' && (
                <label
                  className={`flex items-center gap-2 cursor-pointer mt-3 rounded-lg px-3 py-2.5 border transition-colors ${
                    isDeferred ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isDeferred}
                    onChange={(e) => setIsDeferred(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <div>
                    <span className={`text-sm font-medium ${isDeferred ? 'text-red-700' : 'text-gray-700'}`}>
                      Отложить чек
                    </span>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Сохранить как черновик. Можно продолжить позже. Нельзя закрыть смену с отложенными чеками.
                    </p>
                  </div>
                </label>
              )}
            </div>
          )}

          {/* Comment */}
          <div className="px-5 py-4 border-b border-gray-200">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder={
                '\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u043A \u0447\u0435\u043A\u0443...'
              }
              className="input text-sm w-full"
            />
          </div>

          {/* Submit button */}
          <div className="px-5 py-4 bg-gray-50">
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending || (!isDeferred && itemCount === 0)}
              className={`w-full py-3.5 text-base font-bold rounded-xl disabled:opacity-50 transition-colors ${
                isDeferred ? 'bg-red-600 hover:bg-red-700 text-white' : 'btn-primary'
              }`}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {isEditMode ? 'Сохранение...' : 'Создание...'}
                </span>
              ) : isEditMode ? (
                <span className="flex items-center justify-center gap-2">
                  <Receipt className="w-5 h-5" />
                  {isDeferred ? 'Сохранить чек' : `Сохранить — ${formatCurrency(totalRevenue)}`}
                </span>
              ) : isDeferred ? (
                <span className="flex items-center justify-center gap-2">
                  <Receipt className="w-5 h-5" />
                  Отложить чек
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Receipt className="w-5 h-5" />
                  Пробить чек — {formatCurrency(totalRevenue)}
                </span>
              )}
            </button>
            {/* \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u0430\u0432 \u0447\u0435\u043A\u0430 \u043A\u0430\u043A \u0448\u0430\u0431\u043B\u043E\u043D (\u0442\u043E\u043B\u044C\u043A\u043E \u0441\u0442\u0440\u043E\u043A\u0438 \u0441\u043E \u0441\u0432\u044F\u0437\u044C\u044E \u0441 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u043E\u043C) */}
            {canSaveTemplate && (
              <button
                type="button"
                onClick={() => setShowSaveTemplate(true)}
                className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-400 hover:text-primary-600 transition-colors"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                {
                  '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043A\u0430\u043A \u0448\u0430\u0431\u043B\u043E\u043D'
                }
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-full mt-2 btn-ghost py-2.5 text-sm text-gray-500"
            >
              {'\u041E\u0442\u043C\u0435\u043D\u0430'}
            </button>
          </div>
        </div>
      </form>

      {/* Product Picker Modal */}
      <ProductPickerModal
        isOpen={showProductPicker}
        onClose={() => setShowProductPicker(false)}
        products={pickerProducts}
        onSelectProduct={handleProductSelected}
        warehouses={warehouses}
        selectedWarehouseId={pickerWarehouseId}
        onSelectWarehouse={setPickerWarehouseId}
      />

      {/* Шаблоны чеков: выбор + управление и «Сохранить как шаблон» */}
      <TemplatePickerModal
        isOpen={showTemplatesPicker}
        onClose={() => setShowTemplatesPicker(false)}
        onApply={applyTemplate}
      />
      <SaveTemplateModal
        isOpen={showSaveTemplate}
        onClose={() => setShowSaveTemplate(false)}
        services={templateServices}
        products={templateProducts}
      />

      {/* «Сменить владельца» modal (feature #9) — reassign the selected car */}
      <Modal isOpen={reassignOpen} onClose={closeReassignModal} title="Сменить владельца">
        <div className="space-y-4">
          {(() => {
            const car = selectedClient?.cars?.find((c) => c.id === selectedCarId);
            return car ? (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="font-mono font-bold text-sm bg-white border border-gray-200 px-2 py-1 rounded">
                  {car.plateNumber}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{car.makeModel}</p>
                  {selectedClient && <p className="text-xs text-gray-500">Владелец: {selectedClient.fullName}</p>}
                </div>
              </div>
            ) : null;
          })()}

          <div>
            <label className="label">Новый владелец</label>
            <ClientSearchAutocomplete
              selectedClient={reassignTarget}
              onSelect={setReassignTarget}
              excludeClientId={selectedClient?.id}
            />
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs text-amber-800 flex items-start gap-1.5">
              <UserCheck className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Автомобиль и вся история обслуживания перейдут к новому владельцу. Прошлые чеки остаются за прежним
                владельцем. Текущий (несохранённый) чек будет переоформлен на нового владельца.
              </span>
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeReassignModal} className="btn-secondary">
              Отмена
            </button>
            <button
              type="button"
              onClick={confirmReassign}
              disabled={!reassignTarget || reassignMutation.isPending}
              className="btn-primary disabled:opacity-50"
            >
              {reassignMutation.isPending ? 'Переносим…' : 'Сменить владельца'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
