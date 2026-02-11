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
import { PaymentMethod as PM } from '../types';
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
// Main Page
// ---------------------------------------------------------------------------

export default function CheckCreatePage() {
  const navigate = useNavigate();

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
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Дата
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
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

        {/* Products section */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <Package className="h-5 w-5 text-gray-400" />
              Товары
            </h2>
            <button
              type="button"
              onClick={addProductLine}
              className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Добавить товар
            </button>
          </div>

          {productLines.length > 0 && (
            <div className="space-y-3">
              {productLines.map((line) => (
                <div
                  key={line.key}
                  className="rounded-lg border border-gray-200 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <select
                      value={line.productId}
                      onChange={(e) => selectProduct(line.key, e.target.value)}
                      className="flex-1 min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                    >
                      <option value="">Выберите товар</option>
                      {allProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (остаток: {p.stock})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeProductLine(line.key)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={line.sellPrice}
                      onChange={(e) =>
                        updateProductLine(line.key, {
                          sellPrice: parseFloat(e.target.value) || 0,
                        })
                      }
                      min="0"
                      step="0.01"
                      placeholder="Цена продажи"
                      className="flex-1 min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                    />
                    <input
                      type="number"
                      value={line.quantity}
                      onChange={(e) =>
                        updateProductLine(line.key, {
                          quantity: parseInt(e.target.value) || 1,
                        })
                      }
                      min="1"
                      placeholder="Кол-во"
                      className="w-20 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                    />
                    <span className="w-24 text-right text-sm font-medium text-gray-900 flex-shrink-0">
                      {formatMoney(line.sellPrice * line.quantity)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
