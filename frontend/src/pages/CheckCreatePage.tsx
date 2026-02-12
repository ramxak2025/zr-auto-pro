import { useState, useEffect, useCallback, useRef, useMemo, FormEvent } from 'react';
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
  ShieldCheck,
  CheckCircle2,
  MessageSquare,
  Pause,
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
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: PM.CASH, label: 'Наличные', icon: Banknote },
  { value: PM.CARD, label: 'Карта', icon: CreditCard },
  { value: PM.WARRANTY, label: 'Гарантия', icon: ShieldCheck },
  { value: PM.CASH_CARD, label: 'Нал + Карта', icon: CreditCard },
];

const CATEGORY_ICONS: Record<string, string> = {
  'Масла': '🛢️', 'Фильтры': '🔧', 'Тормозная система': '🛞', 'Жидкости': '💧',
  'Электрика': '⚡', 'ГРМ': '⛓️', 'Подвеска': '🔩', 'ТО': '🔧', 'Тормоза': '🛞',
  'Диагностика': '🔍', 'Двигатель': '⚙️', 'Колёса': '🛞', 'Работа мастера': '👨‍🔧',
};

// ---------------------------------------------------------------------------
// Client Search
// ---------------------------------------------------------------------------

function ClientSearch({ onSelect, selectedClient, onClear }: {
  onSelect: (client: Client) => void; selectedClient: Client | null; onClear: () => void;
}) {
  const [searchText, setSearchText] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const { data: clientsData } = useQuery<PaginatedResponse<Client>>({
    queryKey: ['clients-search', searchText],
    queryFn: async () => { const res = await clientsApi.getAll({ search: searchText, limit: 10 }); return res.data; },
    enabled: searchText.length >= 2,
    staleTime: 30_000,
  });
  const clients = clientsData?.data || [];

  if (selectedClient) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-blue-50/60 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-600 flex-shrink-0">
          <UserIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{selectedClient.fullName}</p>
          <p className="text-xs text-gray-500">{selectedClient.phone}</p>
        </div>
        <button type="button" onClick={onClear} className="text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-100/60">
          Изменить
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input type="text" value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          placeholder="ФИО, телефон или госномер..."
          className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2.5 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/10"
        />
      </div>
      {isOpen && searchText.length >= 2 && clients.length > 0 && (
        <div className="absolute z-10 mt-1.5 w-full rounded-xl border border-gray-100 bg-white shadow-xl max-h-60 overflow-y-auto">
          {clients.map((client) => (
            <button key={client.id} type="button"
              onClick={() => { onSelect(client); setSearchText(''); setIsOpen(false); }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 border-b border-gray-50 last:border-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-500 flex-shrink-0">
                <UserIcon className="h-3 w-3" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{client.fullName}</p>
                <p className="text-xs text-gray-500">{client.phone}</p>
                {client.cars && client.cars.length > 0 && (
                  <p className="text-[11px] text-gray-400">{client.cars.map((c) => c.plateNumber).join(', ')}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      {isOpen && searchText.length >= 2 && clients.length === 0 && (
        <div className="absolute z-10 mt-1.5 w-full rounded-xl border border-gray-100 bg-white shadow-xl p-4">
          <p className="text-sm text-gray-400 text-center">Не найдено</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data interfaces
// ---------------------------------------------------------------------------

interface ServiceLineData { key: string; serviceId: string; name: string; price: number; quantity: number; }
interface ProductLineData { key: string; productId: string; name: string; sellPrice: number; costPrice: number; quantity: number; }

// ---------------------------------------------------------------------------
// Fullscreen Service Catalog — with back navigation inside categories
// ---------------------------------------------------------------------------

function ServiceCatalog({ services, onSelect, onClose }: {
  services: Service[]; onSelect: (service: Service) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const activeCategoryRef = useRef<string | null>(null);
  const shouldCloseRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const categories = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const s of services) {
      const cat = s.category || 'Прочее';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [services]);

  const searchResults = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return services.filter((s) => s.name.toLowerCase().includes(q));
  }, [search, services]);

  const categoryServices = activeCategory
    ? (categories.find(([cat]) => cat === activeCategory)?.[1] || [])
    : [];

  // History management
  useEffect(() => {
    window.history.pushState({ catalog: true }, '');
    const handler = () => {
      if (shouldCloseRef.current) {
        shouldCloseRef.current = false;
        onCloseRef.current();
        return;
      }
      if (activeCategoryRef.current) {
        activeCategoryRef.current = null;
        setActiveCategory(null);
      } else {
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  function handleCategoryClick(cat: string) {
    activeCategoryRef.current = cat;
    setActiveCategory(cat);
    window.history.pushState({ catalogCategory: true }, '');
  }

  function handleClose() {
    if (activeCategoryRef.current) {
      shouldCloseRef.current = true;
      window.history.go(-2);
    } else {
      window.history.back();
    }
  }

  function handleSelect(svc: Service) {
    onSelect(svc);
    handleClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
        <button type="button" onClick={handleClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
          <X className="h-4 w-4" />
        </button>
        <h2 className="text-base font-bold text-gray-900">Выбор услуги</h2>
      </div>

      <div className="px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Найти услугу..."
            className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2.5 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/10" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {search ? (
          searchResults.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">Не найдено</p>
          ) : (
            <div className="space-y-1.5">
              {searchResults.map((svc) => (
                <button key={svc.id} type="button" onClick={() => handleSelect(svc)}
                  className="flex w-full items-center justify-between rounded-xl bg-gray-50 px-4 py-3 text-left hover:bg-emerald-50 transition-colors">
                  <span className="text-sm font-medium text-gray-900">{svc.name}</span>
                  <span className="text-sm font-bold text-emerald-600">{formatMoney(svc.defaultPrice)}</span>
                </button>
              ))}
            </div>
          )
        ) : activeCategory ? (
          <div>
            <button type="button" onClick={() => window.history.back()}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3">
              <ChevronLeft className="h-4 w-4" />Все категории
            </button>
            <div className="space-y-1.5">
              {categoryServices.map((svc) => (
                <button key={svc.id} type="button" onClick={() => handleSelect(svc)}
                  className="flex w-full items-center justify-between rounded-xl bg-gray-50 px-4 py-3 text-left hover:bg-emerald-50 transition-colors">
                  <span className="text-sm font-medium text-gray-900">{svc.name}</span>
                  <span className="text-sm font-bold text-emerald-600">{formatMoney(svc.defaultPrice)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {categories.map(([cat, svcs]) => (
              <button key={cat} type="button" onClick={() => handleCategoryClick(cat)}
                className="flex items-center gap-3 w-full rounded-xl border border-gray-100 bg-white px-4 py-3 hover:shadow-sm hover:border-emerald-200 active:bg-gray-50 transition-all text-left">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 flex-shrink-0 text-lg">
                  {CATEGORY_ICONS[cat] || <Wrench className="h-5 w-5 text-emerald-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{cat}</p>
                  <p className="text-[11px] text-gray-400">{svcs.length} услуг</p>
                </div>
                <ChevronLeft className="h-4 w-4 text-gray-300 flex-shrink-0 rotate-180" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fullscreen Product Catalog — with back navigation inside categories
// ---------------------------------------------------------------------------

function ProductCatalogFullscreen({ products, productLines, onAdd, onUpdateQty, onClose }: {
  products: Product[]; productLines: ProductLineData[];
  onAdd: (product: Product) => void; onUpdateQty: (key: string, qty: number) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const activeCategoryRef = useRef<string | null>(null);
  const shouldCloseRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const categories = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const cat = p.category || 'Без категории';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [products]);

  const searchResults = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [search, products]);

  const categoryProducts = activeCategory
    ? (categories.find(([cat]) => cat === activeCategory)?.[1] || [])
    : [];

  function getQty(productId: string) {
    return productLines.find((l) => l.productId === productId)?.quantity || 0;
  }
  function getLine(productId: string) {
    return productLines.find((l) => l.productId === productId);
  }

  const cartCount = productLines.reduce((s, l) => s + l.quantity, 0);

  // History management — push entry on mount, push again on category enter
  useEffect(() => {
    window.history.pushState({ catalog: true }, '');
    const handler = () => {
      if (shouldCloseRef.current) {
        shouldCloseRef.current = false;
        onCloseRef.current();
        return;
      }
      if (activeCategoryRef.current) {
        activeCategoryRef.current = null;
        setActiveCategory(null);
      } else {
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  function handleCategoryClick(cat: string) {
    activeCategoryRef.current = cat;
    setActiveCategory(cat);
    window.history.pushState({ catalogCategory: true }, '');
  }

  function handleClose() {
    if (activeCategoryRef.current) {
      shouldCloseRef.current = true;
      window.history.go(-2);
    } else {
      window.history.back();
    }
  }

  function renderProductCard(product: Product) {
    const qty = getQty(product.id);
    const line = getLine(product.id);
    return (
      <div key={product.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
        <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center relative">
          {product.photo ? (
            <img src={product.photo} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <Package className="h-8 w-8 text-gray-300" />
          )}
          {product.stock <= 0 && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Нет</span>
            </div>
          )}
          {qty > 0 && (
            <div className="absolute top-1.5 right-1.5 h-5 min-w-[20px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">{qty}</div>
          )}
        </div>
        <div className="flex-1 p-2.5 space-y-1">
          <p className="text-xs font-medium text-gray-800 line-clamp-2 leading-tight">{product.name}</p>
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-gray-900">{formatMoney(product.sellPrice)}</span>
            <span className="text-[10px] text-gray-400">{product.stock} шт</span>
          </div>
        </div>
        <div className="px-2.5 pb-2.5">
          {qty === 0 ? (
            <button type="button" onClick={() => onAdd(product)} disabled={product.stock <= 0}
              className="w-full flex items-center justify-center gap-1 rounded-xl bg-amber-50 text-amber-700 py-2 text-xs font-semibold hover:bg-amber-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <Plus className="h-3.5 w-3.5" />В чек
            </button>
          ) : (
            <div className="flex items-center justify-between bg-amber-50 rounded-xl p-1">
              <button type="button" onClick={() => line && onUpdateQty(line.key, qty - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-amber-700 hover:bg-amber-100"><Minus className="h-3.5 w-3.5" /></button>
              <span className="text-sm font-bold text-gray-900">{qty}</span>
              <button type="button" onClick={() => onAdd(product)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-amber-700 hover:bg-amber-100"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const displayProducts = search ? searchResults : categoryProducts;

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
            <X className="h-4 w-4" />
          </button>
          <h2 className="text-base font-bold text-gray-900">Выбор товара</h2>
        </div>
        {cartCount > 0 && (
          <div className="flex items-center gap-1.5 bg-amber-100 text-amber-700 px-3 py-1.5 rounded-full text-xs font-bold">
            <Package className="h-3.5 w-3.5" />{cartCount}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск товара..."
            className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 py-2.5 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-amber-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/10" />
        </div>
      </div>

      {/* Content — always show scrollbar to prevent layout shift */}
      <div className="flex-1 overflow-y-scroll overscroll-contain px-4 pb-6">
        {search || activeCategory ? (
          <>
            {activeCategory && !search && (
              <button type="button" onClick={() => window.history.back()}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3">
                <ChevronLeft className="h-4 w-4" />Все категории
              </button>
            )}
            {displayProducts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">Не найдено</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                {displayProducts.map(renderProductCard)}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-1.5">
            {categories.map(([cat, prods]) => (
              <button key={cat} type="button" onClick={() => handleCategoryClick(cat)}
                className="flex items-center gap-3 w-full rounded-xl border border-gray-100 bg-white px-4 py-3 hover:shadow-sm hover:border-amber-200 active:bg-gray-50 transition-all text-left">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 flex-shrink-0 text-lg">
                  {CATEGORY_ICONS[cat] || <FolderOpen className="h-5 w-5 text-amber-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{cat}</p>
                  <p className="text-[11px] text-gray-400">{prods.length} шт</p>
                </div>
                <ChevronLeft className="h-4 w-4 text-gray-300 flex-shrink-0 rotate-180" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Done button */}
      {cartCount > 0 && (
        <div className="border-t border-gray-100 px-4 py-3 bg-white">
          <button type="button" onClick={handleClose}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 py-3 text-sm font-bold text-white shadow-sm active:scale-[0.98]">
            <CheckCircle2 className="h-4 w-4" />
            Готово ({cartCount} товаров)
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CheckCreatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMaster = user?.role === UserRole.MASTER;

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedCarId, setSelectedCarId] = useState('');
  const [mileage, setMileage] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PM.CASH);
  const [comment, setComment] = useState('');
  const [discount, setDiscount] = useState('');
  const [isDeferred, setIsDeferred] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');

  const [serviceLines, setServiceLines] = useState<ServiceLineData[]>([]);
  const [productLines, setProductLines] = useState<ProductLineData[]>([]);

  // Fullscreen catalog state
  const [showServiceCatalog, setShowServiceCatalog] = useState(false);
  const [showProductCatalog, setShowProductCatalog] = useState(false);

  // ---- Queries ----

  const { data: servicesData } = useQuery<PaginatedResponse<Service>>({
    queryKey: ['services-all'],
    queryFn: async () => { const res = await servicesApi.getAll({ limit: 1000 }); return res.data; },
    staleTime: 5 * 60_000,
  });

  const { data: productsData } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products-all'],
    queryFn: async () => { const res = await productsApi.getAll({ limit: 1000 }); return res.data; },
    staleTime: 5 * 60_000,
  });

  const allServices = servicesData?.data || [];
  const allProducts = productsData?.data || [];
  const cars: Car[] = selectedClient?.cars || [];

  useEffect(() => {
    if (cars.length === 1) setSelectedCarId(cars[0].id);
    else setSelectedCarId('');
  }, [selectedClient]);

  // ---- Service handlers ----

  function addServiceLine(service: Service) {
    setServiceLines((prev) => [...prev, {
      key: crypto.randomUUID(), serviceId: service.id, name: service.name, price: service.defaultPrice, quantity: 1,
    }]);
  }

  function updateServiceLine(key: string, field: Partial<ServiceLineData>) {
    setServiceLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...field } : l)));
  }

  function removeServiceLine(key: string) {
    setServiceLines((prev) => prev.filter((l) => l.key !== key));
  }

  // ---- Product handlers ----

  function addProduct(product: Product) {
    const existing = productLines.find((l) => l.productId === product.id);
    if (existing) {
      setProductLines((prev) => prev.map((l) => l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
    } else {
      setProductLines((prev) => [...prev, {
        key: crypto.randomUUID(), productId: product.id, name: product.name, sellPrice: product.sellPrice, costPrice: product.costPrice, quantity: 1,
      }]);
    }
  }

  function updateProductQty(key: string, qty: number) {
    if (qty <= 0) setProductLines((prev) => prev.filter((l) => l.key !== key));
    else setProductLines((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: qty } : l)));
  }

  function removeProductLine(key: string) {
    setProductLines((prev) => prev.filter((l) => l.key !== key));
  }

  // ---- Calculations ----

  const servicesTotal = serviceLines.reduce((s, l) => s + l.price * l.quantity, 0);
  const productsTotal = productLines.reduce((s, l) => s + l.sellPrice * l.quantity, 0);
  const discountValue = parseFloat(discount) || 0;
  const grandTotal = Math.max(0, servicesTotal + productsTotal - discountValue);
  const itemCount = serviceLines.length + productLines.length;

  // ---- Submit ----

  const createMutation = useMutation({
    mutationFn: (data: any) => checksApi.create(data),
    onSuccess: (res) => { toast.success('Чек создан'); navigate(`/checks/${res.data.id}`); },
    onError: () => { toast.error('Не удалось создать чек'); },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedClient) { toast.error('Выберите клиента'); return; }
    if (!selectedCarId) { toast.error('Выберите автомобиль'); return; }
    if (serviceLines.length === 0 && productLines.length === 0) { toast.error('Добавьте услугу или товар'); return; }

    const services: Omit<CheckServiceLine, 'id'>[] = serviceLines.map((l) => ({
      serviceId: l.serviceId || undefined, name: l.name, price: l.price, quantity: l.quantity, total: l.price * l.quantity,
    }));

    const products: Omit<CheckProductLine, 'id'>[] = productLines.map((l) => ({
      productId: l.productId, name: l.name, sellPrice: l.sellPrice, costPrice: l.costPrice,
      quantity: l.quantity, totalSell: l.sellPrice * l.quantity, totalCost: l.costPrice * l.quantity,
    }));

    createMutation.mutate({
      clientId: selectedClient.id, carId: selectedCarId, date,
      mileage: mileage ? parseInt(mileage) : undefined,
      services, products, paymentMethod,
      discount: discountValue || undefined,
      comment: comment.trim() || undefined,
      isDeferred,
    });
  }

  // ---- Running item index for receipt ----
  let receiptIdx = 0;

  return (
    <>
      {/* Fullscreen catalogs */}
      {showServiceCatalog && (
        <ServiceCatalog services={allServices} onSelect={addServiceLine}
          onClose={() => setShowServiceCatalog(false)} />
      )}
      {showProductCatalog && (
        <ProductCatalogFullscreen
          products={allProducts} productLines={productLines}
          onAdd={addProduct} onUpdateQty={updateProductQty}
          onClose={() => setShowProductCatalog(false)}
        />
      )}

      <div className="pb-44 md:pb-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => navigate('/checks')}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 active:scale-95">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Новый чек</h1>
            <p className="text-[11px] text-gray-400">Заполните данные</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ── Client section (compact) ── */}
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Клиент</p>
            </div>
            <div className="p-4 space-y-3">
              <ClientSearch onSelect={setSelectedClient} selectedClient={selectedClient}
                onClear={() => { setSelectedClient(null); setSelectedCarId(''); }} />
              {selectedClient && (
                <div className="grid gap-2.5 grid-cols-3">
                  <div>
                    <label className="text-[11px] font-medium text-gray-500 mb-1 block">Авто *</label>
                    <select value={selectedCarId} onChange={(e) => setSelectedCarId(e.target.value)} disabled={cars.length === 0}
                      className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 px-2.5 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:bg-gray-100">
                      <option value="">{cars.length === 0 ? 'Нет' : 'Выбрать'}</option>
                      {cars.map((car) => <option key={car.id} value={car.id}>{car.plateNumber}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-gray-500 mb-1 block">Пробег</label>
                    <div className="relative">
                      <Gauge className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                      <input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} min="0" placeholder="0"
                        className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-8 pr-2 py-2 text-sm placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/10" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-gray-500 mb-1 block">Дата</label>
                    {isMaster ? (
                      <div className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 text-sm text-gray-500">
                        <Calendar className="h-3.5 w-3.5" />{new Date(date).toLocaleDateString('ru-RU')}
                      </div>
                    ) : (
                      <div className="relative">
                        <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                          className="block w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-8 pr-2 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/10" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Receipt — unified services + products ── */}
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            {/* Add buttons */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex-1">Позиции</p>
              <button type="button" onClick={() => setShowServiceCatalog(true)}
                className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors">
                <Wrench className="h-3 w-3" />Услуга
              </button>
              <button type="button" onClick={() => setShowProductCatalog(true)}
                className="flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 transition-colors">
                <Package className="h-3 w-3" />Товар
              </button>
            </div>

            {/* Items list */}
            {itemCount === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-gray-400">Добавьте услуги или товары</p>
              </div>
            ) : (
              <div className="divide-y divide-dashed divide-gray-100">
                {/* Service lines */}
                {serviceLines.map((line) => {
                  receiptIdx++;
                  return (
                    <div key={line.key} className="flex items-start gap-2 px-4 py-2.5">
                      <span className="text-[11px] text-gray-300 font-mono mt-0.5 w-4 text-right flex-shrink-0">{receiptIdx}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-gray-900 leading-tight">{line.name}</p>
                          <button type="button" onClick={() => removeServiceLine(line.key)}
                            className="flex-shrink-0 text-gray-300 hover:text-red-500 mt-0.5"><Trash2 className="h-3 w-3" /></button>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <input type="number" value={line.price}
                            onChange={(e) => updateServiceLine(line.key, { price: parseFloat(e.target.value) || 0 })}
                            className="w-20 rounded-lg border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700 focus:border-emerald-400 focus:outline-none" />
                          <span className="text-gray-300 text-[10px]">&times;</span>
                          <input type="number" value={line.quantity} min="1"
                            onChange={(e) => updateServiceLine(line.key, { quantity: parseInt(e.target.value) || 1 })}
                            className="w-10 rounded-lg border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-center text-gray-700 focus:border-emerald-400 focus:outline-none" />
                          <span className="ml-auto text-sm font-semibold text-gray-900">{formatMoney(line.price * line.quantity)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* Product lines */}
                {productLines.map((line) => {
                  receiptIdx++;
                  return (
                    <div key={line.key} className="flex items-start gap-2 px-4 py-2.5">
                      <span className="text-[11px] text-gray-300 font-mono mt-0.5 w-4 text-right flex-shrink-0">{receiptIdx}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-gray-900 leading-tight">{line.name}</p>
                          <button type="button" onClick={() => removeProductLine(line.key)}
                            className="flex-shrink-0 text-gray-300 hover:text-red-500 mt-0.5"><Trash2 className="h-3 w-3" /></button>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-400">{line.quantity} &times; {formatMoney(line.sellPrice)}</span>
                          <span className="text-sm font-semibold text-gray-900">{formatMoney(line.sellPrice * line.quantity)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Totals — receipt style */}
            {itemCount > 0 && (
              <div className="border-t border-gray-200 px-4 py-3 space-y-1.5 bg-gray-50/50">
                {servicesTotal > 0 && (
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Услуги</span><span>{formatMoney(servicesTotal)}</span>
                  </div>
                )}
                {productsTotal > 0 && (
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Товары</span><span>{formatMoney(productsTotal)}</span>
                  </div>
                )}
                <div>
                  <label className="text-[11px] text-gray-400">Скидка, ₽</label>
                  <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} min="0" placeholder="0"
                    className="block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 mt-0.5 focus:border-violet-400 focus:outline-none" />
                </div>
                {discountValue > 0 && (
                  <div className="flex justify-between text-xs text-red-500">
                    <span>Скидка</span><span>-{formatMoney(discountValue)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-dashed border-gray-300">
                  <span className="text-sm font-bold text-gray-900">ИТОГО</span>
                  <span className="text-lg font-bold text-gray-900">{formatMoney(grandTotal)}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Comment — prominent, before payment ── */}
          <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-4">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 mb-2">
              <MessageSquare className="h-3.5 w-3.5" />Комментарий к заказу
            </label>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder="Опишите работу, пожелания клиента, особенности..."
              rows={2}
              className="block w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm placeholder-gray-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/10 resize-none" />
          </div>

          {/* ── Defer check ── */}
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setIsDeferred((v) => !v)}
              className={`flex items-center gap-3 w-full px-4 py-3.5 transition-colors ${
                isDeferred ? 'bg-amber-50' : ''
              }`}
            >
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${isDeferred ? 'bg-amber-100' : 'bg-gray-100'}`}>
                <Pause className={`h-4 w-4 ${isDeferred ? 'text-amber-600' : 'text-gray-400'}`} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-gray-900">Отложить чек</p>
                <p className="text-[11px] text-gray-400">Чек будет помечен как отложенный</p>
              </div>
              <div className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${isDeferred ? 'bg-amber-500' : 'bg-gray-200'}`}>
                <div className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${isDeferred ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </button>
          </div>

          {/* ── Payment ── */}
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Оплата</p>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PAYMENT_METHODS.map((pm) => {
                  const Icon = pm.icon;
                  const active = paymentMethod === pm.value;
                  return (
                    <button key={pm.value} type="button" onClick={() => setPaymentMethod(pm.value)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all ${
                        active
                          ? 'bg-violet-100 text-violet-700 ring-1 ring-violet-200 shadow-sm'
                          : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                      }`}>
                      <Icon className="h-3.5 w-3.5" />{pm.label}
                    </button>
                  );
                })}
              </div>

              {/* Split payment */}
              {paymentMethod === PM.CASH_CARD && (
                <div className="rounded-xl bg-purple-50/50 border border-purple-100 p-3 space-y-2.5">
                  <p className="text-[11px] font-semibold text-purple-700 uppercase tracking-wider">Разделение оплаты</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
                        <Banknote className="h-3 w-3" />Наличные
                      </label>
                      <input type="number" value={cashAmount}
                        onChange={(e) => {
                          setCashAmount(e.target.value);
                          const cash = parseFloat(e.target.value) || 0;
                          const remaining = Math.max(0, grandTotal - cash);
                          setCardAmount(remaining > 0 ? remaining.toString() : '');
                        }}
                        min="0" placeholder="0 ₽"
                        className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500/10" />
                    </div>
                    <div>
                      <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
                        <CreditCard className="h-3 w-3" />Карта
                      </label>
                      <input type="number" value={cardAmount}
                        onChange={(e) => {
                          setCardAmount(e.target.value);
                          const card = parseFloat(e.target.value) || 0;
                          const remaining = Math.max(0, grandTotal - card);
                          setCashAmount(remaining > 0 ? remaining.toString() : '');
                        }}
                        min="0" placeholder="0 ₽"
                        className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500/10" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Desktop summary */}
          <div className="hidden md:block">
            <div className="rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 p-5 text-white">
              <div className="flex justify-between items-center">
                <span className="text-lg font-bold">Итого</span>
                <span className="text-2xl font-bold">{formatMoney(grandTotal)}</span>
              </div>
              <div className="flex gap-3 mt-4">
                <button type="button" onClick={() => navigate('/checks')}
                  className="flex-1 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10">Отмена</button>
                <button type="submit" disabled={createMutation.isPending}
                  className="flex-[2] flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-gray-900 hover:bg-gray-100 disabled:opacity-50 active:scale-[0.98]">
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Создать чек
                </button>
              </div>
            </div>
          </div>

          {/* Mobile sticky bar */}
          <div className="md:hidden fixed bottom-[68px] inset-x-0 z-30 bg-white/95 backdrop-blur-lg border-t border-gray-100 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Итого</p>
                <p className="text-lg font-bold text-gray-900">{formatMoney(grandTotal)}</p>
              </div>
              <button type="submit" disabled={createMutation.isPending}
                className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-primary-600 to-primary-700 px-5 py-3 text-sm font-bold text-white shadow-lg active:scale-[0.97] disabled:opacity-50">
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Создать
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
