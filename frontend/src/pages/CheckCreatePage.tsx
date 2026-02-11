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
  ShoppingCart,
  Minus,
  X,
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
import LoadingSpinner from '../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: PM.CASH, label: 'Наличные' },
  { value: PM.CARD, label: 'Карта' },
  { value: PM.TRANSFER, label: 'Перевод' },
  { value: PM.MIXED, label: 'Смешанная' },
];

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
      <div className="flex items-center justify-between rounded-lg border border-gray-300 bg-gray-50 px-4 py-2.5">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {selectedClient.fullName}
          </p>
          <p className="text-xs text-gray-500">{selectedClient.phone}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Изменить
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="ФИО, телефон или госномер авто..."
          className="block w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        />
      </div>

      {isOpen && searchText.length >= 2 && clients.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-60 overflow-y-auto">
          {clients.map((client) => (
            <button
              key={client.id}
              type="button"
              onClick={() => {
                onSelect(client);
                setSearchText('');
                setIsOpen(false);
              }}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {client.fullName}
                </p>
                <p className="text-xs text-gray-500">{client.phone}</p>
                {client.cars && client.cars.length > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {client.cars.map((c) => c.plateNumber).join(', ')}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && searchText.length >= 2 && clients.length === 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg p-4">
          <p className="text-sm text-gray-500 text-center">Клиенты не найдены</p>
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
  formatMoney: (v: number) => string;
}

function ProductCatalog({
  allProducts,
  productLines,
  onAdd,
  onUpdateQty,
  onRemove,
  formatMoney,
}: ProductCatalogProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');

  // Group products by category
  const categories = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of allProducts) {
      const cat = p.category || 'Без категории';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allProducts]);

  // Filtered products when searching
  const searchResults = useMemo(() => {
    if (!productSearch) return [];
    const q = productSearch.toLowerCase();
    return allProducts.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [productSearch, allProducts]);

  const productsInCategory = activeCategory
    ? (categories.find(([cat]) => cat === activeCategory)?.[1] || [])
    : [];

  // Helper: get quantity of a product in cart
  function getCartQty(productId: string): number {
    const line = productLines.find((l) => l.productId === productId);
    return line?.quantity || 0;
  }

  function getCartLine(productId: string) {
    return productLines.find((l) => l.productId === productId);
  }

  // Product card component
  function ProductCard({ product }: { product: Product }) {
    const qty = getCartQty(product.id);
    const line = getCartLine(product.id);

    return (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
        {/* Image */}
        <div className="aspect-square bg-gray-50 flex items-center justify-center relative">
          {product.photo ? (
            <img src={product.photo} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <Package className="h-10 w-10 text-gray-300" />
          )}
          {product.stock <= 0 && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
              <span className="text-xs font-medium text-red-500">Нет в наличии</span>
            </div>
          )}
          {qty > 0 && (
            <div className="absolute top-1.5 right-1.5 flex items-center justify-center h-6 min-w-[24px] px-1 rounded-full bg-primary-600 text-white text-xs font-bold">
              {qty}
            </div>
          )}
        </div>
        {/* Info */}
        <div className="flex-1 p-2.5 flex flex-col">
          <p className="text-xs font-medium text-gray-900 line-clamp-2 leading-tight mb-1">{product.name}</p>
          <div className="mt-auto flex items-center justify-between">
            <span className="text-sm font-bold text-gray-900">{formatMoney(product.sellPrice)}</span>
            <span className="text-[10px] text-gray-400">{product.stock} шт</span>
          </div>
        </div>
        {/* Add/qty buttons */}
        <div className="px-2.5 pb-2.5">
          {qty === 0 ? (
            <button
              type="button"
              onClick={() => onAdd(product)}
              disabled={product.stock <= 0}
              className="w-full flex items-center justify-center gap-1 rounded-lg bg-primary-50 text-primary-700 px-3 py-1.5 text-xs font-semibold
                hover:bg-primary-100 active:bg-primary-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => line && onUpdateQty(line.key, qty - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="text-sm font-bold text-gray-900 min-w-[24px] text-center">{qty}</span>
              <button
                type="button"
                onClick={() => onAdd(product)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-100 text-primary-700 hover:bg-primary-200 transition-colors"
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
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header + search */}
      <div className="p-4 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <Package className="h-5 w-5 text-gray-400" />
            Товары
            {productLines.length > 0 && (
              <span className="flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-primary-100 text-primary-700 text-[11px] font-bold">
                {productLines.reduce((sum, l) => sum + l.quantity, 0)}
              </span>
            )}
          </h2>
          {activeCategory && (
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Назад
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Поиск товара..."
            className="block w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400
              focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-500/20 transition-colors"
          />
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-4">
        {/* Search results */}
        {productSearch ? (
          searchResults.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Товары не найдены</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5">
              {searchResults.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )
        ) : activeCategory ? (
          /* Products in category */
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5">
            {productsInCategory.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          /* Category folders */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {categories.map(([cat, products]) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className="flex flex-col items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 p-4 hover:bg-gray-100 hover:border-gray-200 active:bg-gray-200 transition-all"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm text-2xl">
                  {CATEGORY_ICONS[cat] || <FolderOpen className="h-6 w-6 text-gray-400" />}
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-900 leading-tight">{cat}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{products.length} шт</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cart summary — added products */}
      {productLines.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">В чеке:</p>
          {productLines.map((line) => (
            <div key={line.key} className="flex items-center gap-2 bg-white rounded-lg p-2 border border-gray-100">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{line.name}</p>
                <p className="text-xs text-gray-500">{line.quantity} × {formatMoney(line.sellPrice)}</p>
              </div>
              <span className="text-sm font-bold text-gray-900 flex-shrink-0">
                {formatMoney(line.sellPrice * line.quantity)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(line.key)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors flex-shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
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

  // Auto-select first car when client changes
  useEffect(() => {
    if (cars.length === 1) {
      setSelectedCarId(cars[0].id);
    } else {
      setSelectedCarId('');
    }
  }, [selectedClient]);

  // Filtered services for autocomplete
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

  function addProductLine() {
    setProductLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId: '',
        name: '',
        sellPrice: 0,
        costPrice: 0,
        quantity: 1,
      },
    ]);
  }

  function selectProduct(key: string, productId: string) {
    const product = allProducts.find((p) => p.id === productId);
    if (product) {
      updateProductLine(key, {
        productId: product.id,
        name: product.name,
        sellPrice: product.sellPrice,
        costPrice: product.costPrice,
      });
    }
  }

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

    // Validate service lines
    for (const line of serviceLines) {
      if (!line.name.trim()) {
        toast.error('Заполните название всех услуг');
        return;
      }
    }

    // Validate product lines
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/checks')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">Новый чек</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client & Car & Master section */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Основная информация</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Client search */}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Клиент <span className="text-red-500">*</span>
              </label>
              <ClientSearch
                onSelect={(client) => setSelectedClient(client)}
                selectedClient={selectedClient}
                onClear={() => {
                  setSelectedClient(null);
                  setSelectedCarId('');
                }}
              />
            </div>

            {/* Car dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Автомобиль <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedCarId}
                onChange={(e) => setSelectedCarId(e.target.value)}
                disabled={!selectedClient || cars.length === 0}
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">
                  {!selectedClient
                    ? 'Сначала выберите клиента'
                    : cars.length === 0
                    ? 'У клиента нет автомобилей'
                    : 'Выберите автомобиль'}
                </option>
                {cars.map((car) => (
                  <option key={car.id} value={car.id}>
                    {car.plateNumber} - {car.makeModel}
                  </option>
                ))}
              </select>
            </div>

            {/* Mileage */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Пробег (км)
              </label>
              <input
                type="number"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                min="0"
                placeholder="0"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>

            {/* Date — masters see read-only current date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Дата
              </label>
              {isMaster ? (
                <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  {new Date(date).toLocaleDateString('ru-RU')}
                </div>
              ) : (
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
              )}
            </div>
          </div>
        </div>

        {/* Services section */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <Wrench className="h-5 w-5 text-gray-400" />
              Услуги
            </h2>
          </div>

          {/* Service autocomplete */}
          <div className="relative">
            <input
              type="text"
              value={serviceSearch}
              onChange={(e) => setServiceSearch(e.target.value)}
              placeholder="Начните вводить название услуги..."
              className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
            {serviceSearch && filteredServices.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                {filteredServices.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => addServiceLine(service)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 transition-colors text-sm border-b border-gray-100 last:border-0"
                  >
                    <span className="text-gray-900">{service.name}</span>
                    <span className="text-gray-500">
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
            className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Добавить произвольную услугу
          </button>

          {/* Service lines */}
          {serviceLines.length > 0 && (
            <div className="space-y-3">
              {serviceLines.map((line) => (
                <div
                  key={line.key}
                  className="rounded-lg border border-gray-200 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={line.name}
                      onChange={(e) =>
                        updateServiceLine(line.key, { name: e.target.value })
                      }
                      placeholder="Название услуги"
                      className="flex-1 min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => removeServiceLine(line.key)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
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
                      className="flex-1 min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                    />
                    <input
                      type="number"
                      value={line.quantity}
                      onChange={(e) =>
                        updateServiceLine(line.key, {
                          quantity: parseInt(e.target.value) || 1,
                        })
                      }
                      min="1"
                      placeholder="Кол-во"
                      className="w-20 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                    />
                    <span className="w-24 text-right text-sm font-medium text-gray-900 flex-shrink-0">
                      {formatMoney(line.price * line.quantity)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Products section — catalog style */}
        <ProductCatalog
          allProducts={allProducts}
          productLines={productLines}
          onAdd={(product) => {
            // If already in cart, increment quantity
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
          formatMoney={formatMoney}
        />

        {/* Summary + Payment + Comment */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Summary card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Итого</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Услуги:</span>
                <span className="font-medium text-gray-900">
                  {formatMoney(servicesTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Товары:</span>
                <span className="font-medium text-gray-900">
                  {formatMoney(productsTotal)}
                </span>
              </div>
              <div className="border-t border-gray-200 pt-2 flex items-center justify-between">
                <span className="text-base font-semibold text-gray-900">Итого:</span>
                <span className="text-lg font-bold text-primary-600">
                  {formatMoney(grandTotal)}
                </span>
              </div>
            </div>
          </div>

          {/* Payment + Comment */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Способ оплаты
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map((pm) => (
                  <button
                    key={pm.value}
                    type="button"
                    onClick={() => setPaymentMethod(pm.value)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      paymentMethod === pm.value
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {pm.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Комментарий
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Дополнительная информация..."
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/checks')}
            className="rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {createMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Создать чек
          </button>
        </div>
      </form>
    </div>
  );
}
