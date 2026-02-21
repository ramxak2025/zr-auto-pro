import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  CalendarDays,
  Gauge,
  Pencil,
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
import { useAuth } from '../contexts/AuthContext';
import type {
  Client,
  Car,
  User,
  Service,
  Product,
  CheckServiceLine,
  CheckProductLine,
} from '../types';
import { UserRole } from '../types';

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
  unit?: string;
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

  const breadcrumbLabel = activePath.length > 0
    ? activePath[activePath.length - 1]
    : 'Товары';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
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
                    className={idx === activePath.length - 1 ? 'text-gray-900 font-medium truncate' : 'hover:text-primary-600 truncate'}
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
            <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
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
    </div>
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
  const { id: editCheckId } = useParams<{ id: string }>();
  const isEditMode = !!editCheckId;
  const queryClient = useQueryClient();
  const { user, isRole } = useAuth();
  const canEditDate = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  // Plate number search state
  const [plateSearch, setPlateSearch] = useState('');
  const [showPlateDropdown, setShowPlateDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedCarId, setSelectedCarId] = useState('');
  const plateInputRef = useRef<HTMLInputElement>(null);

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

  // Service lines
  const [serviceLines, setServiceLines] = useState<ServiceLineForm[]>([]);

  // Product lines
  const [productLines, setProductLines] = useState<ProductLineForm[]>([]);

  // Product picker modal
  const [showProductPicker, setShowProductPicker] = useState(false);

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

  // Fetch all products (cached 60s — catalog data)
  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['products-all'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 1000 });
      return res.data?.data ?? res.data;
    },
    staleTime: 60_000,
  });

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
      setServiceLines(existingCheck.services.map((s: CheckServiceLine) => ({
        serviceId: s.serviceId || '',
        masterId: s.masterId || user?.id || '',
        name: s.name,
        price: s.price,
        quantity: s.quantity,
      })));
    }
    if (existingCheck.products?.length) {
      setProductLines(existingCheck.products.map((p: CheckProductLine) => ({
        productId: p.productId || '',
        name: p.name,
        sellPrice: p.sellPrice,
        costPrice: p.costPrice,
        quantity: p.quantity,
        unit: 'pcs',
      })));
    }
  }, [existingCheck, editLoaded, user?.id]);

  // Mutation
  const createMutation = useMutation({
    mutationFn: (data: any) => checksApi.create(data),
    onSuccess: (res) => {
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
    setServiceLines((prev) => [
      ...prev,
      { serviceId: '', masterId: user?.id || '', name: '', price: 0, quantity: 1 },
    ]);
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
      })
    );
  };

  const removeServiceLine = (index: number) => {
    setServiceLines((prev) => prev.filter((_, i) => i !== index));
  };

  // Product line handlers
  const handleProductSelected = useCallback((product: Product) => {
    // If it's a bundle, add each component product
    if (product.isBundle && product.bundleItems && product.bundleItems.length > 0) {
      setProductLines((prev) => {
        let updated = [...prev];
        for (const bi of product.bundleItems!) {
          const matchProduct = (allProducts ?? []).find((p) => p.id === bi.productId);
          const existing = updated.findIndex((l) => l.productId === bi.productId);
          if (existing !== -1) {
            updated = updated.map((line, i) =>
              i === existing ? { ...line, quantity: line.quantity + bi.quantity } : line,
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
      const step = (product.unit && product.unit !== 'pcs') ? 0.5 : 1;
      const existing = prev.findIndex((l) => l.productId === product.id);
      if (existing !== -1) {
        return prev.map((line, i) =>
          i === existing ? { ...line, quantity: line.quantity + step } : line,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sellPrice: product.sellPrice,
          costPrice: product.costPrice,
          quantity: step,
          unit: product.unit || 'pcs',
        },
      ];
    });
  }, [allProducts]);

  const updateProductLine = (index: number, field: keyof ProductLineForm, value: any) => {
    setProductLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        return { ...line, [field]: value };
      })
    );
  };

  const removeProductLine = (index: number) => {
    setProductLines((prev) => prev.filter((_, i) => i !== index));
  };

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
      finalCash = cashAmount;
      finalCard = Math.max(totalRevenue - cashAmount, 0);
    }

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
      isDeferred,
    };

    if (isEditMode) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
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
      </div>

      <form onSubmit={handleSubmit}>
        {/* ===== Receipt-style container ===== */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">

          {/* Receipt header with editable date */}
          <div className="bg-gray-900 text-white px-5 py-4">
            <div className="text-center">
              <h2 className="text-lg font-bold tracking-wider">{'\u0417\u0410\u041A\u0410\u0417-\u041D\u0410\u0420\u042F\u0414'}</h2>
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
                    <span className="text-gray-400 text-xs">
                      {format(new Date(date + 'T00:00:00'), 'dd.MM.yyyy')}
                    </span>
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
                      {client.fullName} {'\u2022'} {client.phone}
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
                  <span className="text-sm font-medium text-blue-700">{'\u0420\u043E\u0437\u043D\u0438\u0447\u043D\u044B\u0439 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C'}</span>
                </div>
                <p className="text-xs text-blue-500 mt-1">{'\u041D\u0430\u0431\u0435\u0440\u0438\u0442\u0435 \u0433\u043E\u0441\u043D\u043E\u043C\u0435\u0440 \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430'}</p>
              </div>
            )}

            {/* Selected client/car info */}
            {selectedClient && (
              <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{selectedClient.fullName}</div>
                    <div className="text-xs text-gray-500">{selectedClient.phone}</div>
                  </div>
                  <div className="text-right">
                    {selectedClient.cars?.find(c => c.id === selectedCarId) && (
                      <>
                        <div className="font-mono font-bold text-sm">
                          {selectedClient.cars.find(c => c.id === selectedCarId)?.plateNumber}
                        </div>
                        <div className="text-xs text-gray-500">
                          {selectedClient.cars.find(c => c.id === selectedCarId)?.makeModel}
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
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">км</span>
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
              <button type="button" onClick={addServiceLine} className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center gap-1">
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
                          <option key={m.id} value={m.id}>{m.fullName}</option>
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
                {'\u0418\u0442\u043E\u0433\u043E: '}{formatCurrency(serviceTotal)}
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
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {line.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatCurrency(line.sellPrice)} / {line.unit === 'm' ? 'м' : line.unit === 'l' ? 'л' : line.unit === 'kg' ? 'кг' : 'шт'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {line.unit && line.unit !== 'pcs' ? (
                        <input
                          type="number"
                          value={line.quantity}
                          onChange={(e) => updateProductLine(index, 'quantity', Math.max(0.01, parseFloat(e.target.value) || 0))}
                          step="0.1"
                          min="0.01"
                          className="w-16 text-center text-sm font-medium rounded border border-gray-200 py-1 px-1"
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              if (line.quantity > 1) {
                                updateProductLine(index, 'quantity', line.quantity - 1);
                              }
                            }}
                            className="p-1 rounded hover:bg-gray-200 text-gray-400"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-medium">{line.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateProductLine(index, 'quantity', line.quantity + 1)}
                            className="p-1 rounded hover:bg-gray-200 text-gray-400"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
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
                {'\u0418\u0442\u043E\u0433\u043E: '}{formatCurrency(productTotal)}
              </div>
            )}
          </div>

          {/* ===== RECEIPT SUMMARY ===== */}
          <div className="px-5 py-4 border-b border-dashed border-gray-300 bg-gray-50">
            <div className="space-y-1.5 font-mono text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{'\u0423\u0441\u043B\u0443\u0433\u0438'} ({serviceLines.length})</span>
                <span>{formatCurrency(serviceTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{'\u0422\u043E\u0432\u0430\u0440\u044B'} ({productLines.length})</span>
                <span>{formatCurrency(productTotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-red-500">
                  <span>{'\u0421\u043A\u0438\u0434\u043A\u0430 \u043D\u0430 \u0442\u043E\u0432\u0430\u0440\u044B'}</span>
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
              <label className="text-xs text-gray-500 whitespace-nowrap">{'\u0421\u043A\u0438\u0434\u043A\u0430 \u043D\u0430 \u0442\u043E\u0432\u0430\u0440\u044B:'}</label>
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
          <div className="px-5 py-4 border-b border-dashed border-gray-300">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              {'\u041E\u043F\u043B\u0430\u0442\u0430'}
            </h3>

            <div className="grid grid-cols-4 gap-2 mb-4">
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
            </div>

            {paymentMethod === 'cash' && (
              <div className="bg-green-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">{'\u041A\u043B\u0438\u0435\u043D\u0442 \u0434\u0430\u043B:'}</label>
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
                    <label className="text-sm font-medium text-gray-700">{'\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435:'}</label>
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

            <label className={`flex items-center gap-2 cursor-pointer mt-3 rounded-lg px-3 py-2.5 border transition-colors ${
              isDeferred ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200'
            }`}>
              <input
                type="checkbox"
                checked={isDeferred}
                onChange={(e) => setIsDeferred(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <div>
                <span className={`text-sm font-medium ${isDeferred ? 'text-red-700' : 'text-gray-700'}`}>Отложить чек</span>
                <p className="text-[10px] text-gray-400 mt-0.5">Сохранить как черновик. Можно продолжить позже. Нельзя закрыть смену с отложенными чеками.</p>
              </div>
            </label>
          </div>

          {/* Comment */}
          <div className="px-5 py-4 border-b border-gray-200">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder={'\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439 \u043A \u0447\u0435\u043A\u0443...'}
              className="input text-sm w-full"
            />
          </div>

          {/* Submit button */}
          <div className="px-5 py-4 bg-gray-50">
            <button
              type="submit"
              disabled={(createMutation.isPending || updateMutation.isPending) || (!isDeferred && itemCount === 0)}
              className={`w-full py-3.5 text-base font-bold rounded-xl disabled:opacity-50 transition-colors ${
                isDeferred
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'btn-primary'
              }`}
            >
              {(createMutation.isPending || updateMutation.isPending) ? (
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
        products={allProducts ?? []}
        onSelectProduct={handleProductSelected}
      />
    </div>
  );
}
