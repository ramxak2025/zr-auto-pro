import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  checksApi,
  clientsApi,
  usersApi,
  servicesApi,
  productsApi,
} from '../api/services';
import type {
  Client,
  Car,
  User,
  Service,
  Product,
  CheckServiceLine,
  CheckProductLine,
  PaymentMethod,
} from '../types';

const formatCurrency = (value: number): string => {
  return value.toLocaleString('ru-RU') + ' \u20BD';
};

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
}

// ---------------------------------------------------------------------------
// Product Picker Modal
// ---------------------------------------------------------------------------

interface ProductPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onSelectProduct: (product: Product) => void;
}

function ProductPickerModal({
  isOpen,
  onClose,
  products,
  onSelectProduct,
}: ProductPickerModalProps) {
  const [search, setSearch] = useState('');
  const [currentCategory, setCurrentCategory] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setCurrentCategory(null);
      // Focus search input after a short delay for animation
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Gather unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats).sort();
  }, [products]);

  // Products without a category go into "Без категории"
  const uncategorizedCount = useMemo(
    () => products.filter((p) => !p.category).length,
    [products],
  );

  // Filtered products based on search & current category
  const filteredProducts = useMemo(() => {
    let list = products;

    if (currentCategory !== null) {
      if (currentCategory === '__uncategorized__') {
        list = list.filter((p) => !p.category);
      } else {
        list = list.filter((p) => p.category === currentCategory);
      }
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.category && p.category.toLowerCase().includes(q)),
      );
    }

    return list;
  }, [products, currentCategory, search]);

  // Count products per category for badge
  const categoryProductCount = useCallback(
    (cat: string) => products.filter((p) => p.category === cat).length,
    [products],
  );

  const handleSelect = (product: Product) => {
    onSelectProduct(product);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-10">
        <button
          type="button"
          onClick={() => {
            if (currentCategory !== null && !search.trim()) {
              setCurrentCategory(null);
            } else {
              onClose();
            }
          }}
          className="p-2 -ml-2 rounded-lg hover:bg-gray-100 text-gray-600"
        >
          {currentCategory !== null && !search.trim() ? (
            <ChevronLeft className="w-5 h-5" />
          ) : (
            <X className="w-5 h-5" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 text-sm text-gray-500 mb-0.5">
            <button
              type="button"
              onClick={() => {
                setCurrentCategory(null);
                setSearch('');
              }}
              className="hover:text-primary-600 truncate"
            >
              {'\u0422\u043E\u0432\u0430\u0440\u044B'}
            </button>
            {currentCategory !== null && (
              <>
                <span>/</span>
                <span className="text-gray-900 font-medium truncate">
                  {currentCategory === '__uncategorized__'
                    ? '\u0411\u0435\u0437 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438'
                    : currentCategory}
                </span>
              </>
            )}
          </div>
          <h2 className="text-lg font-semibold text-gray-900 leading-tight">
            {'\u0412\u044B\u0431\u043E\u0440 \u0442\u043E\u0432\u0430\u0440\u0430'}
          </h2>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={'\u041F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430...'}
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
        {/* If searching, skip folder view and show flat product results */}
        {search.trim() ? (
          <div className="p-4">
            {filteredProducts.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">{'\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        ) : currentCategory === null ? (
          /* Folder view */
          <div className="p-4 space-y-2">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCurrentCategory(cat)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                <FolderOpen className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <span className="flex-1 text-left font-medium text-gray-900 truncate">
                  {cat}
                </span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {categoryProductCount(cat)}
                </span>
              </button>
            ))}

            {uncategorizedCount > 0 && (
              <button
                type="button"
                onClick={() => setCurrentCategory('__uncategorized__')}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                <Package className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <span className="flex-1 text-left font-medium text-gray-500 truncate">
                  {'\u0411\u0435\u0437 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438'}
                </span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {uncategorizedCount}
                </span>
              </button>
            )}

            {categories.length === 0 && uncategorizedCount === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">{'\u041D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u043E\u0432'}</p>
              </div>
            )}
          </div>
        ) : (
          /* Product grid inside a category */
          <div className="p-4">
            {filteredProducts.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">{'\u0412 \u044D\u0442\u043E\u0439 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438 \u043D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u043E\u0432'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product Card (used inside the picker modal)
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
      {/* Photo area */}
      <div className="w-full aspect-square bg-gray-100 relative overflow-hidden">
        {product.photo ? (
          <img
            src={product.photo}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-10 h-10 text-gray-300" />
          </div>
        )}
        {/* Stock badge */}
        <div
          className={`absolute top-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
            inStock
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {inStock ? `${product.stock} \u0448\u0442` : '\u041D\u0435\u0442'}
        </div>
      </div>

      {/* Info */}
      <div className="p-2.5 flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-900 line-clamp-2 leading-tight">
          {product.name}
        </span>
        <span className="text-sm font-bold text-primary-600">
          {formatCurrency(product.sellPrice)}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function CheckCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Client search state
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedCarId, setSelectedCarId] = useState('');

  // Form fields
  const [masterId, setMasterId] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [mileage, setMileage] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [comment, setComment] = useState('');
  const [discount, setDiscount] = useState(0);
  const [isDeferred, setIsDeferred] = useState(false);

  // Service lines
  const [serviceLines, setServiceLines] = useState<ServiceLineForm[]>([]);

  // Product lines
  const [productLines, setProductLines] = useState<ProductLineForm[]>([]);

  // Product picker modal
  const [showProductPicker, setShowProductPicker] = useState(false);

  // -----------------------------------------------------------------------
  // Prevent accidental swipe-back / page leave
  // -----------------------------------------------------------------------
  useEffect(() => {
    window.history.pushState({ checkGuard: true }, '');
    const handler = (e: PopStateEvent) => {
      if (serviceLines.length > 0 || productLines.length > 0) {
        window.history.pushState({ checkGuard: true }, '');
        // Could show a toast warning
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

  // Fetch masters
  const { data: masters } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters();
      return res.data;
    },
  });

  // Fetch clients for autocomplete
  const { data: clientsData } = useQuery<Client[]>({
    queryKey: ['clients', clientSearch],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search: clientSearch, limit: 20 });
      return res.data?.data ?? res.data;
    },
    enabled: clientSearch.length >= 1,
  });

  // Fetch all services
  const { data: allServices } = useQuery<Service[]>({
    queryKey: ['services-all'],
    queryFn: async () => {
      const res = await servicesApi.getAll({ limit: 1000 });
      return res.data?.data ?? res.data;
    },
  });

  // Fetch all products
  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['products-all'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 1000 });
      return res.data?.data ?? res.data;
    },
  });

  // Mutation
  const createMutation = useMutation({
    mutationFn: (data: any) => checksApi.create(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('\u0427\u0435\u043A \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u0441\u043E\u0437\u0434\u0430\u043D');
      navigate(`/checks/${res.data.id}`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u0438 \u0447\u0435\u043A\u0430');
    },
  });

  // Computed totals
  const serviceTotal = useMemo(() => {
    return serviceLines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  }, [serviceLines]);

  const productTotal = useMemo(() => {
    return productLines.reduce((sum, line) => sum + line.sellPrice * line.quantity, 0);
  }, [productLines]);

  const totalRevenue = useMemo(() => {
    return serviceTotal + productTotal - discount;
  }, [serviceTotal, productTotal, discount]);

  // Client selection
  const handleSelectClient = (client: Client) => {
    setSelectedClient(client);
    setClientSearch(client.fullName);
    setShowClientDropdown(false);
    setSelectedCarId('');
  };

  // Service line handlers
  const addServiceLine = () => {
    setServiceLines((prev) => [
      ...prev,
      { serviceId: '', masterId: masterId, name: '', price: 0, quantity: 1 },
    ]);
  };

  const updateServiceLine = (index: number, field: keyof ServiceLineForm, value: any) => {
    setServiceLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const updated = { ...line, [field]: value };
        // Auto-fill from service selection
        if (field === 'serviceId' && allServices) {
          const svc = allServices.find((s) => s.id === value);
          if (svc) {
            updated.name = svc.name;
            updated.price = svc.defaultPrice;
          }
        }
        return updated;
      })
    );
  };

  const removeServiceLine = (index: number) => {
    setServiceLines((prev) => prev.filter((_, i) => i !== index));
  };

  // Product line handlers -- now driven by the picker modal
  const handleProductSelected = useCallback((product: Product) => {
    setProductLines((prev) => {
      // If product already in the list, just bump quantity
      const existing = prev.findIndex((l) => l.productId === product.id);
      if (existing !== -1) {
        return prev.map((line, i) =>
          i === existing ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sellPrice: product.sellPrice,
          costPrice: product.costPrice,
          quantity: 1,
        },
      ];
    });
  }, []);

  const updateProductLine = (index: number, field: keyof ProductLineForm, value: any) => {
    setProductLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const updated = { ...line, [field]: value };
        // Auto-fill from product selection (kept for manual edits if any)
        if (field === 'productId' && allProducts) {
          const prod = allProducts.find((p) => p.id === value);
          if (prod) {
            updated.name = prod.name;
            updated.sellPrice = prod.sellPrice;
            updated.costPrice = prod.costPrice;
          }
        }
        return updated;
      })
    );
  };

  const removeProductLine = (index: number) => {
    setProductLines((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedClient) {
      toast.error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430');
      return;
    }
    if (!selectedCarId) {
      toast.error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u0432\u0442\u043E\u043C\u043E\u0431\u0438\u043B\u044C');
      return;
    }
    if (!masterId) {
      toast.error('\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043C\u0430\u0441\u0442\u0435\u0440\u0430');
      return;
    }

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

    createMutation.mutate({
      clientId: selectedClient.id,
      carId: selectedCarId,
      masterId,
      date,
      mileage: mileage ? Number(mileage) : undefined,
      services,
      products,
      discount,
      paymentMethod,
      comment: comment || undefined,
      isDeferred,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="btn-ghost btn-sm">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="page-title">{'\u041D\u043E\u0432\u044B\u0439 \u0447\u0435\u043A'}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client & Car */}
        <div className="card card-body space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {'\u041A\u043B\u0438\u0435\u043D\u0442 \u0438 \u0430\u0432\u0442\u043E\u043C\u043E\u0431\u0438\u043B\u044C'}
          </h2>

          {/* Client search */}
          <div className="relative">
            <label className="label">{'\u041A\u043B\u0438\u0435\u043D\u0442'}</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setShowClientDropdown(true);
                  if (!e.target.value) {
                    setSelectedClient(null);
                  }
                }}
                onFocus={() => setShowClientDropdown(true)}
                placeholder={'\u041F\u043E\u0438\u0441\u043A \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043F\u043E \u0438\u043C\u0435\u043D\u0438 \u0438\u043B\u0438 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0443...'}
                className="input pl-10"
              />
            </div>
            {showClientDropdown && clientsData && clientsData.length > 0 && !selectedClient && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {clientsData.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => handleSelectClient(client)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="text-sm font-medium text-gray-900">{client.fullName}</div>
                    <div className="text-xs text-gray-500">{client.phone}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Car select */}
          {selectedClient && (
            <div>
              <label className="label">{'\u0410\u0432\u0442\u043E\u043C\u043E\u0431\u0438\u043B\u044C'}</label>
              <select
                value={selectedCarId}
                onChange={(e) => setSelectedCarId(e.target.value)}
                className="input"
              >
                <option value="">{'\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u0432\u0442\u043E\u043C\u043E\u0431\u0438\u043B\u044C'}</option>
                {selectedClient.cars?.map((car) => (
                  <option key={car.id} value={car.id}>
                    {car.makeModel} {'\u2014'} {car.plateNumber}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Master, Date, Mileage */}
        <div className="card card-body space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {'\u041E\u0441\u043D\u043E\u0432\u043D\u0430\u044F \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">{'\u041C\u0430\u0441\u0442\u0435\u0440'}</label>
              <select
                value={masterId}
                onChange={(e) => setMasterId(e.target.value)}
                className="input"
              >
                <option value="">{'\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043C\u0430\u0441\u0442\u0435\u0440\u0430'}</option>
                {masters?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{'\u0414\u0430\u0442\u0430'}</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">{'\u041F\u0440\u043E\u0431\u0435\u0433 (\u043A\u043C)'}</label>
              <input
                type="number"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="0"
                className="input"
              />
            </div>
          </div>
        </div>

        {/* Services */}
        <div className="card card-body space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{'\u0423\u0441\u043B\u0443\u0433\u0438'}</h2>
            <button type="button" onClick={addServiceLine} className="btn-secondary btn-sm">
              <Plus className="w-4 h-4" />
              {'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0443'}
            </button>
          </div>

          {serviceLines.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {'\u041D\u0435\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0445 \u0443\u0441\u043B\u0443\u0433'}
            </p>
          ) : (
            <div className="space-y-3">
              {serviceLines.map((line, index) => (
                <div key={index} className="flex flex-col sm:flex-row gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <label className="label">{'\u0423\u0441\u043B\u0443\u0433\u0430'}</label>
                    <select
                      value={line.serviceId}
                      onChange={(e) => updateServiceLine(index, 'serviceId', e.target.value)}
                      className="input"
                    >
                      <option value="">{'\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0443\u0441\u043B\u0443\u0433\u0443'}</option>
                      {allServices?.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {'\u2014'} {formatCurrency(s.defaultPrice)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-full sm:w-40">
                    <label className="label">{'\u041C\u0430\u0441\u0442\u0435\u0440'}</label>
                    <select
                      value={line.masterId}
                      onChange={(e) => updateServiceLine(index, 'masterId', e.target.value)}
                      className="input"
                    >
                      <option value="">{'\u041C\u0430\u0441\u0442\u0435\u0440'}</option>
                      {masters?.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-full sm:w-28">
                    <label className="label">{'\u0426\u0435\u043D\u0430'}</label>
                    <input
                      type="number"
                      value={line.price}
                      onChange={(e) => updateServiceLine(index, 'price', Number(e.target.value))}
                      className="input"
                    />
                  </div>
                  <div className="w-full sm:w-20">
                    <label className="label">{'\u041A\u043E\u043B-\u0432\u043E'}</label>
                    <input
                      type="number"
                      value={line.quantity}
                      min={1}
                      onChange={(e) => updateServiceLine(index, 'quantity', Number(e.target.value))}
                      className="input"
                    />
                  </div>
                  <div className="w-full sm:w-28 flex flex-col">
                    <label className="label">{'\u0418\u0442\u043E\u0433\u043E'}</label>
                    <div className="input bg-gray-100 flex items-center font-semibold">
                      {formatCurrency(line.price * line.quantity)}
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removeServiceLine(index)}
                      className="btn-ghost btn-sm text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {serviceLines.length > 0 && (
            <div className="text-right text-sm font-semibold text-gray-700">
              {'\u0418\u0442\u043E\u0433\u043E \u0443\u0441\u043B\u0443\u0433\u0438: '}{formatCurrency(serviceTotal)}
            </div>
          )}
        </div>

        {/* Products */}
        <div className="card card-body space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{'\u0422\u043E\u0432\u0430\u0440\u044B'}</h2>
            <button
              type="button"
              onClick={() => setShowProductPicker(true)}
              className="btn-secondary btn-sm"
            >
              <Plus className="w-4 h-4" />
              {'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440'}
            </button>
          </div>

          {productLines.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {'\u041D\u0435\u0442 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0445 \u0442\u043E\u0432\u0430\u0440\u043E\u0432'}
            </p>
          ) : (
            <div className="space-y-3">
              {productLines.map((line, index) => (
                <div key={index} className="flex flex-col sm:flex-row gap-3 p-3 bg-gray-50 rounded-lg items-center">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {line.name || '\u0422\u043E\u0432\u0430\u0440'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatCurrency(line.sellPrice)} {'\u0437\u0430 \u0448\u0442'}
                    </div>
                  </div>
                  <div className="w-full sm:w-20">
                    <label className="label">{'\u041A\u043E\u043B-\u0432\u043E'}</label>
                    <input
                      type="number"
                      value={line.quantity}
                      min={1}
                      onChange={(e) => updateProductLine(index, 'quantity', Number(e.target.value))}
                      className="input"
                    />
                  </div>
                  <div className="w-full sm:w-28 flex flex-col">
                    <label className="label">{'\u0418\u0442\u043E\u0433\u043E'}</label>
                    <div className="input bg-gray-100 flex items-center font-semibold">
                      {formatCurrency(line.sellPrice * line.quantity)}
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removeProductLine(index)}
                      className="btn-ghost btn-sm text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {productLines.length > 0 && (
            <div className="text-right text-sm font-semibold text-gray-700">
              {'\u0418\u0442\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u044B: '}{formatCurrency(productTotal)}
            </div>
          )}
        </div>

        {/* Summary, Payment, Comment */}
        <div className="card card-body space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{'\u0418\u0442\u043E\u0433\u043E'}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{'\u0423\u0441\u043B\u0443\u0433\u0438:'}</span>
                <span className="font-medium">{formatCurrency(serviceTotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{'\u0422\u043E\u0432\u0430\u0440\u044B:'}</span>
                <span className="font-medium">{formatCurrency(productTotal)}</span>
              </div>
              <div className="flex justify-between text-sm items-center gap-2">
                <span className="text-gray-500">{'\u0421\u043A\u0438\u0434\u043A\u0430:'}</span>
                <input
                  type="number"
                  value={discount}
                  min={0}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                  className="input w-32 text-right"
                />
              </div>
              <div className="flex justify-between text-base font-bold border-t pt-2">
                <span>{'\u0418\u0442\u043E\u0433\u043E \u043A \u043E\u043F\u043B\u0430\u0442\u0435:'}</span>
                <span className="text-primary-600">{formatCurrency(totalRevenue)}</span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">{'\u041C\u0435\u0442\u043E\u0434 \u043E\u043F\u043B\u0430\u0442\u044B'}</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="input"
                >
                  <option value="cash">{'\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435'}</option>
                  <option value="card">{'\u041A\u0430\u0440\u0442\u0430'}</option>
                  <option value="warranty">{'\u0413\u0430\u0440\u0430\u043D\u0442\u0438\u044F'}</option>
                  <option value="cash_card">{'\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435 + \u041A\u0430\u0440\u0442\u0430'}</option>
                </select>
              </div>

              <div>
                <label className="label">{'\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439'}</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder={'\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u043A \u0447\u0435\u043A\u0443...'}
                  className="input"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDeferred}
                  onChange={(e) => setIsDeferred(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">{'\u041E\u0442\u043B\u043E\u0436\u0435\u043D\u043D\u0430\u044F \u043E\u043F\u043B\u0430\u0442\u0430'}</span>
              </label>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            {'\u041E\u0442\u043C\u0435\u043D\u0430'}
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="btn-primary"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {'\u0421\u043E\u0437\u0434\u0430\u043D\u0438\u0435...'}
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                {'\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0447\u0435\u043A'}
              </>
            )}
          </button>
        </div>
      </form>

      {/* Product Picker Modal */}
      <ProductPickerModal
        isOpen={showProductPicker}
        onClose={() => setShowProductPicker(false)}
        products={allProducts ?? []}
        onSelectProduct={handleProductSelected}
      />
    </div>
  );
}
