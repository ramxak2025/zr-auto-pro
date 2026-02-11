import { useState, useEffect, useMemo, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Search,
  Wrench,
  Package,
  FolderOpen,
  ChevronLeft,
  Minus,
  X,
  User as UserIcon,
  Calendar,
  Gauge,
  CreditCard,
  Banknote,
  ArrowRightLeft,
  Shuffle,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';
import {
  clientsApi,
  checksApi,
  servicesApi,
  productsApi,
} from '../api/services';
import type {
  Client,
  Car,
  Service,
  Product,
  CheckServiceLine,
  CheckProductLine,
  PaymentMethod,
  PaginatedResponse,
} from '../types';
import { PaymentMethod as PM, UserRole } from '../types';
import { useAuth } from '../contexts/AuthContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' ₽';
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: PM.CASH, label: 'Наличные', icon: Banknote },
  { value: PM.CARD, label: 'Карта', icon: CreditCard },
  { value: PM.TRANSFER, label: 'Перевод', icon: ArrowRightLeft },
  { value: PM.MIXED, label: 'Смешанная', icon: Shuffle },
];

// ---------------------------------------------------------------------------
// Section Wrapper — consistent card style with colored accent
// ---------------------------------------------------------------------------

function Section({
  children,
  accent = 'gray',
}: {
  children: React.ReactNode;
  accent?: 'blue' | 'emerald' | 'amber' | 'violet' | 'gray';
}) {
  const accentBorder: Record<string, string> = {
    blue: 'border-l-blue-500',
    emerald: 'border-l-emerald-500',
    amber: 'border-l-amber-500',
    violet: 'border-l-violet-500',
    gray: 'border-l-gray-300',
  };

  return (
    <div
      className={`rounded-2xl border border-gray-100 bg-white shadow-sm border-l-[3px] ${accentBorder[accent]} overflow-hidden`}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  badge,
  action,
  accentColor = 'text-gray-500',
  accentBg = 'bg-gray-50',
}: {
  icon: typeof Wrench;
  title: string;
  badge?: number;
  action?: React.ReactNode;
  accentColor?: string;
  accentBg?: string;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-50">
      <div className="flex items-center gap-2.5">
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${accentBg}`}>
          <Icon className={`h-4 w-4 ${accentColor}`} />
        </div>
        <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
        {badge !== undefined && badge > 0 && (
          <span className="flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-gray-900 text-white text-[10px] font-bold">
            {badge}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client Search Component
// ---------------------------------------------------------------------------

interface ClientSearchProps {
  onSelect: (client: Client) => void;
  selectedClient: Client | null;
  onClear: () => void;
}

function ClientSearch({ onSelect, selectedClient, onClear }: ClientSearchProps) {
  const [searchText, setSearchText] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const { data: clientsData } = useQuery<PaginatedResponse<Client>>({
    queryKey: ['clients-search', searchText],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search: searchText, limit: 10 });
      return res.data;
    },
    enabled: searchText.length >= 2,
    staleTime: 30_000,
  });

  const clients = clientsData?.data || [];

  if (selectedClient) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-blue-50/60 px-4 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 flex-shrink-0">
          <UserIcon className="h-4.5 w-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {selectedClient.fullName}
          </p>
          <p className="text-xs text-gray-500">{selectedClient.phone}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors px-2 py-1 rounded-lg hover:bg-blue-100/60"
        >
          Изменить
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="ФИО, телефон или госномер авто..."
          className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/10"
        />
      </div>

      {isOpen && searchText.length >= 2 && clients.length > 0 && (
        <div className="absolute z-10 mt-1.5 w-full rounded-xl border border-gray-100 bg-white shadow-xl shadow-gray-200/50 max-h-60 overflow-y-auto">
          {clients.map((client) => (
            <button
              key={client.id}
              type="button"
              onClick={() => {
                onSelect(client);
                setSearchText('');
                setIsOpen(false);
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 flex-shrink-0">
                <UserIcon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {client.fullName}
                </p>
                <p className="text-xs text-gray-500">{client.phone}</p>
                {client.cars && client.cars.length > 0 && (
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {client.cars.map((c) => c.plateNumber).join(', ')}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && searchText.length >= 2 && clients.length === 0 && (
        <div className="absolute z-10 mt-1.5 w-full rounded-xl border border-gray-100 bg-white shadow-xl shadow-gray-200/50 p-4">
          <p className="text-sm text-gray-400 text-center">Клиенты не найдены</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Service Line
// ---------------------------------------------------------------------------

interface ServiceLineData {
  key: string;
  serviceId: string;
  name: string;
  price: number;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Product Line
// ---------------------------------------------------------------------------

interface ProductLineData {
  key: string;
  productId: string;
  name: string;
  sellPrice: number;
  costPrice: number;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Product Catalog — folders (categories) + image cards
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<string, string> = {
  'Масла': '🛢️',
  'Фильтры': '🔧',
  'Тормозная система': '🛞',
  'Жидкости': '💧',
  'Электрика': '⚡',
  'ГРМ': '⛓️',
  'Подвеска': '🔩',
};

interface ProductCatalogProps {
  allProducts: Product[];
  productLines: ProductLineData[];
  onAdd: (product: Product) => void;
  onUpdateQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
}

function ProductCatalog({
  allProducts,
  productLines,
  onAdd,
  onUpdateQty,
  onRemove,
}: ProductCatalogProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');

  const categories = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of allProducts) {
      const cat = p.category || 'Без категории';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allProducts]);

  const searchResults = useMemo(() => {
    if (!productSearch) return [];
    const q = productSearch.toLowerCase();
    return allProducts.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [productSearch, allProducts]);

  const productsInCategory = activeCategory
    ? (categories.find(([cat]) => cat === activeCategory)?.[1] || [])
    : [];

  function getCartQty(productId: string): number {
    const line = productLines.find((l) => l.productId === productId);
    return line?.quantity || 0;
  }

  function getCartLine(productId: string) {
    return productLines.find((l) => l.productId === productId);
  }

  function ProductCard({ product }: { product: Product }) {
    const qty = getCartQty(product.id);
    const line = getCartLine(product.id);

    return (
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col hover:shadow-md transition-shadow">
        {/* Image */}
        <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center relative">
          {product.photo ? (
            <img src={product.photo} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <Package className="h-8 w-8 text-gray-300" />
          )}
          {product.stock <= 0 && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex items-center justify-center">
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Нет в наличии</span>
            </div>
          )}
          {qty > 0 && (
            <div className="absolute top-1.5 right-1.5 flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold shadow-sm">
              {qty}
            </div>
          )}
        </div>
        {/* Info */}
        <div className="flex-1 p-2.5 flex flex-col gap-1">
          <p className="text-xs font-medium text-gray-800 line-clamp-2 leading-tight">{product.name}</p>
          <div className="mt-auto flex items-center justify-between">
            <span className="text-[13px] font-bold text-gray-900">{formatMoney(product.sellPrice)}</span>
            <span className="text-[10px] text-gray-400">{product.stock} шт</span>
          </div>
        </div>
        {/* Actions */}
        <div className="px-2.5 pb-2.5">
          {qty === 0 ? (
            <button
              type="button"
              onClick={() => onAdd(product)}
              disabled={product.stock <= 0}
              className="w-full flex items-center justify-center gap-1 rounded-xl bg-amber-50 text-amber-700 py-2 text-xs font-semibold
                hover:bg-amber-100 active:bg-amber-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              В чек
            </button>
          ) : (
            <div className="flex items-center justify-between bg-amber-50 rounded-xl p-1">
              <button
                type="button"
                onClick={() => line && onUpdateQty(line.key, qty - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-amber-700 hover:bg-amber-100 transition-colors"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="text-sm font-bold text-gray-900">{qty}</span>
              <button
                type="button"
                onClick={() => onAdd(product)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-amber-700 hover:bg-amber-100 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Search */}
      <div className="px-5 py-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Поиск товара..."
            className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder-gray-400
              focus:border-amber-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/10 transition-all"
          />
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pb-5">
        {productSearch ? (
          searchResults.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Товары не найдены</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5">
              {searchResults.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )
        ) : activeCategory ? (
          <div>
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-3"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Все категории</span>
            </button>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5">
              {productsInCategory.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {categories.map(([cat, products]) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-50/50 to-gray-50 p-3.5
                  hover:border-amber-200 hover:from-amber-50/30 hover:to-amber-50/10 active:scale-[0.98] transition-all"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm text-lg flex-shrink-0">
                  {CATEGORY_ICONS[cat] || <FolderOpen className="h-5 w-5 text-gray-400" />}
                </div>
                <div className="text-left min-w-0">
                  <p className="text-sm font-medium text-gray-900 leading-tight truncate">{cat}</p>
                  <p className="text-[11px] text-gray-400">{products.length} шт</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cart summary */}
      {productLines.length > 0 && (
        <div className="border-t border-gray-100 bg-amber-50/40 px-5 py-3.5 space-y-2">
          <p className="text-[11px] font-semibold text-amber-700/70 uppercase tracking-wider">Товары в чеке</p>
          {productLines.map((line) => (
            <div key={line.key} className="flex items-center gap-2.5 bg-white rounded-xl p-2.5 border border-amber-100/60">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{line.name}</p>
                <p className="text-xs text-gray-400">{line.quantity} × {formatMoney(line.sellPrice)}</p>
              </div>
              <span className="text-sm font-bold text-gray-900 flex-shrink-0">
                {formatMoney(line.sellPrice * line.quantity)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(line.key)}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CheckCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMaster = user?.role === UserRole.MASTER;

  // Form state
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedCarId, setSelectedCarId] = useState('');
  const [mileage, setMileage] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PM.CASH);
  const [comment, setComment] = useState('');

  // Service lines
  const [serviceLines, setServiceLines] = useState<ServiceLineData[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');

  // Product lines
  const [productLines, setProductLines] = useState<ProductLineData[]>([]);

  // ---- Queries ----

  const { data: servicesData } = useQuery<PaginatedResponse<Service>>({
    queryKey: ['services-all'],
    queryFn: async () => {
      const res = await servicesApi.getAll({ limit: 1000 });
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  const { data: productsData } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products-all'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 1000 });
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  const allServices = servicesData?.data || [];
  const allProducts = productsData?.data || [];
  const cars: Car[] = selectedClient?.cars || [];

  useEffect(() => {
    if (cars.length === 1) {
      setSelectedCarId(cars[0].id);
    } else {
      setSelectedCarId('');
    }
  }, [selectedClient]);

  const filteredServices = useMemo(() => {
    if (!serviceSearch) return [];
    const lower = serviceSearch.toLowerCase();
    return allServices
      .filter((s) => s.name.toLowerCase().includes(lower))
      .slice(0, 8);
  }, [serviceSearch, allServices]);

  // ---- Service line handlers ----

  function addServiceLine(service?: Service) {
    const newLine: ServiceLineData = {
      key: crypto.randomUUID(),
      serviceId: service?.id || '',
      name: service?.name || '',
      price: service?.defaultPrice || 0,
      quantity: 1,
    };
    setServiceLines((prev) => [...prev, newLine]);
    setServiceSearch('');
  }

  function updateServiceLine(key: string, field: Partial<ServiceLineData>) {
    setServiceLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...field } : l)),
    );
  }

  function removeServiceLine(key: string) {
    setServiceLines((prev) => prev.filter((l) => l.key !== key));
  }

  // ---- Product line handlers ----

  function updateProductLine(key: string, field: Partial<ProductLineData>) {
    setProductLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...field } : l)),
    );
  }

  function removeProductLine(key: string) {
    setProductLines((prev) => prev.filter((l) => l.key !== key));
  }

  // ---- Calculations ----

  const servicesTotal = serviceLines.reduce(
    (sum, l) => sum + l.price * l.quantity,
    0,
  );
  const productsTotal = productLines.reduce(
    (sum, l) => sum + l.sellPrice * l.quantity,
    0,
  );
  const grandTotal = servicesTotal + productsTotal;

  // ---- Submit ----

  const createMutation = useMutation({
    mutationFn: (data: any) => checksApi.create(data),
    onSuccess: (res) => {
      toast.success('Чек создан');
      navigate(`/checks/${res.data.id}`);
    },
    onError: () => {
      toast.error('Не удалось создать чек');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!selectedClient) {
      toast.error('Выберите клиента');
      return;
    }
    if (!selectedCarId) {
      toast.error('Выберите автомобиль');
      return;
    }
    if (serviceLines.length === 0 && productLines.length === 0) {
      toast.error('Добавьте хотя бы одну услугу или товар');
      return;
    }

    for (const line of serviceLines) {
      if (!line.name.trim()) {
        toast.error('Заполните название всех услуг');
        return;
      }
    }

    for (const line of productLines) {
      if (!line.productId) {
        toast.error('Выберите товар для всех строк');
        return;
      }
    }

    const services: Omit<CheckServiceLine, 'id'>[] = serviceLines.map((l) => ({
      serviceId: l.serviceId || undefined,
      name: l.name,
      price: l.price,
      quantity: l.quantity,
      total: l.price * l.quantity,
    }));

    const products: Omit<CheckProductLine, 'id'>[] = productLines.map((l) => ({
      productId: l.productId,
      name: l.name,
      sellPrice: l.sellPrice,
      costPrice: l.costPrice,
      quantity: l.quantity,
      totalSell: l.sellPrice * l.quantity,
      totalCost: l.costPrice * l.quantity,
    }));

    createMutation.mutate({
      clientId: selectedClient.id,
      carId: selectedCarId,
      date,
      mileage: mileage ? parseInt(mileage) : undefined,
      services,
      products,
      paymentMethod,
      comment: comment.trim() || undefined,
    });
  }

  const itemCount = serviceLines.length + productLines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="pb-28 md:pb-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/checks')}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-500 transition-all hover:bg-gray-50 hover:text-gray-700 active:scale-95"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Новый чек</h1>
          <p className="text-xs text-gray-400 mt-0.5">Заполните данные для создания чека</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* ── Section 1: Client & Car ── */}
        <Section accent="blue">
          <SectionHeader
            icon={UserIcon}
            title="Клиент и автомобиль"
            accentColor="text-blue-600"
            accentBg="bg-blue-50"
          />
          <div className="p-5 space-y-4">
            <ClientSearch
              onSelect={(client) => setSelectedClient(client)}
              selectedClient={selectedClient}
              onClear={() => {
                setSelectedClient(null);
                setSelectedCarId('');
              }}
            />

            {selectedClient && (
              <div className="grid gap-3 sm:grid-cols-3">
                {/* Car */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
                    <span>Автомобиль</span>
                    <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={selectedCarId}
                    onChange={(e) => setSelectedCarId(e.target.value)}
                    disabled={cars.length === 0}
                    className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm text-gray-900 transition-all focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    <option value="">
                      {cars.length === 0 ? 'Нет авто' : 'Выберите авто'}
                    </option>
                    {cars.map((car) => (
                      <option key={car.id} value={car.id}>
                        {car.plateNumber} — {car.makeModel}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Mileage */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
                    <span>Пробег (км)</span>
                  </label>
                  <div className="relative">
                    <Gauge className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                      type="number"
                      value={mileage}
                      onChange={(e) => setMileage(e.target.value)}
                      min="0"
                      placeholder="0"
                      className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-9 pr-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/10"
                    />
                  </div>
                </div>

                {/* Date */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
                    <span>Дата</span>
                  </label>
                  {isMaster ? (
                    <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      {new Date(date).toLocaleDateString('ru-RU')}
                    </div>
                  ) : (
                    <div className="relative">
                      <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-9 pr-3 py-2.5 text-sm text-gray-900 transition-all focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/10"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* ── Section 2: Services ── */}
        <Section accent="emerald">
          <SectionHeader
            icon={Wrench}
            title="Услуги"
            badge={serviceLines.length}
            accentColor="text-emerald-600"
            accentBg="bg-emerald-50"
          />
          <div className="p-5 space-y-3">
            {/* Service autocomplete */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                placeholder="Найти услугу..."
                className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
              />
              {serviceSearch && filteredServices.length > 0 && (
                <div className="absolute z-10 mt-1.5 w-full rounded-xl border border-gray-100 bg-white shadow-xl shadow-gray-200/50 max-h-48 overflow-y-auto">
                  {filteredServices.map((service) => (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => addServiceLine(service)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-emerald-50/50 transition-colors text-sm border-b border-gray-50 last:border-0"
                    >
                      <span className="text-gray-900">{service.name}</span>
                      <span className="text-emerald-600 font-medium text-xs">
                        {formatMoney(service.defaultPrice)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => addServiceLine()}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors px-1"
            >
              <Plus className="h-3.5 w-3.5" />
              Произвольная услуга
            </button>

            {/* Service lines */}
            {serviceLines.length > 0 && (
              <div className="space-y-2 pt-1">
                {serviceLines.map((line, idx) => (
                  <div
                    key={line.key}
                    className="group rounded-xl bg-gray-50/70 p-3 space-y-2 hover:bg-gray-50 transition-colors"
                  >
                    {/* Row 1: Name + delete */}
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 text-[11px] font-bold flex-shrink-0">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={line.name}
                        onChange={(e) =>
                          updateServiceLine(line.key, { name: e.target.value })
                        }
                        placeholder="Название услуги"
                        className="flex-1 min-w-0 rounded-lg border-0 bg-transparent px-2 py-1 text-sm font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
                      />
                      <button
                        type="button"
                        onClick={() => removeServiceLine(line.key)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 opacity-0 group-hover:opacity-100 flex-shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Row 2: Price × Qty = Total */}
                    <div className="flex items-center gap-2 pl-8">
                      <div className="relative flex-1 min-w-0">
                        <input
                          type="number"
                          value={line.price}
                          onChange={(e) =>
                            updateServiceLine(line.key, {
                              price: parseFloat(e.target.value) || 0,
                            })
                          }
                          min="0"
                          step="0.01"
                          placeholder="Цена"
                          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500/10"
                        />
                      </div>
                      <span className="text-gray-300 text-xs">×</span>
                      <input
                        type="number"
                        value={line.quantity}
                        onChange={(e) =>
                          updateServiceLine(line.key, {
                            quantity: parseInt(e.target.value) || 1,
                          })
                        }
                        min="1"
                        className="w-16 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 text-center focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500/10"
                      />
                      <span className="text-gray-300 text-xs">=</span>
                      <span className="text-sm font-bold text-gray-900 min-w-[80px] text-right">
                        {formatMoney(line.price * line.quantity)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* ── Section 3: Products ── */}
        <Section accent="amber">
          <SectionHeader
            icon={Package}
            title="Товары"
            badge={productLines.reduce((s, l) => s + l.quantity, 0)}
            accentColor="text-amber-600"
            accentBg="bg-amber-50"
          />
          <ProductCatalog
            allProducts={allProducts}
            productLines={productLines}
            onAdd={(product) => {
              const existing = productLines.find((l) => l.productId === product.id);
              if (existing) {
                updateProductLine(existing.key, { quantity: existing.quantity + 1 });
              } else {
                setProductLines((prev) => [
                  ...prev,
                  {
                    key: crypto.randomUUID(),
                    productId: product.id,
                    name: product.name,
                    sellPrice: product.sellPrice,
                    costPrice: product.costPrice,
                    quantity: 1,
                  },
                ]);
              }
            }}
            onUpdateQty={(key, qty) => {
              if (qty <= 0) {
                removeProductLine(key);
              } else {
                updateProductLine(key, { quantity: qty });
              }
            }}
            onRemove={removeProductLine}
          />
        </Section>

        {/* ── Section 4: Payment & Comment ── */}
        <Section accent="violet">
          <SectionHeader
            icon={CreditCard}
            title="Оплата"
            accentColor="text-violet-600"
            accentBg="bg-violet-50"
          />
          <div className="p-5 space-y-5">
            {/* Payment method pills */}
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((pm) => {
                const Icon = pm.icon;
                const active = paymentMethod === pm.value;
                return (
                  <button
                    key={pm.value}
                    type="button"
                    onClick={() => setPaymentMethod(pm.value)}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                      active
                        ? 'bg-violet-100 text-violet-700 ring-1 ring-violet-200 shadow-sm'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {pm.label}
                  </button>
                );
              })}
            </div>

            {/* Comment */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                Комментарий
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="Доп. информация..."
                className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/10 resize-none"
              />
            </div>
          </div>
        </Section>

        {/* ── Sticky Total Bar (mobile) + Desktop summary ── */}
        <div className="hidden md:block">
          <div className="rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 p-5 text-white">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-white/80">Итого по чеку</h2>
              <span className="text-xs text-white/50">{itemCount} позиций</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-white/60">Услуги</span>
                <span className="font-medium">{formatMoney(servicesTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">Товары</span>
                <span className="font-medium">{formatMoney(productsTotal)}</span>
              </div>
              <div className="border-t border-white/10 pt-3 mt-3 flex items-center justify-between">
                <span className="text-lg font-bold">Итого</span>
                <span className="text-2xl font-bold">{formatMoney(grandTotal)}</span>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => navigate('/checks')}
                className="flex-1 rounded-xl border border-white/20 px-4 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-[2] flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-gray-900 transition-all hover:bg-gray-100 disabled:opacity-50 active:scale-[0.98]"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Создать чек
              </button>
            </div>
          </div>
        </div>

        {/* Mobile sticky bottom bar */}
        <div className="md:hidden fixed bottom-[68px] inset-x-0 z-30 bg-white/95 backdrop-blur-lg border-t border-gray-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-gray-400 uppercase tracking-wider">Итого</p>
              <p className="text-xl font-bold text-gray-900">{formatMoney(grandTotal)}</p>
              <p className="text-[11px] text-gray-400">{itemCount} позиций</p>
            </div>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-primary-600/20 transition-all hover:shadow-xl active:scale-[0.97] disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Создать
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
