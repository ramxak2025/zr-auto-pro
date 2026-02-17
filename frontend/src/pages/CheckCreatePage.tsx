import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Search,
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
  return value.toLocaleString('ru-RU') + ' \u20B8';
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

  // Product line handlers
  const addProductLine = () => {
    setProductLines((prev) => [
      ...prev,
      { productId: '', name: '', sellPrice: 0, costPrice: 0, quantity: 1 },
    ]);
  };

  const updateProductLine = (index: number, field: keyof ProductLineForm, value: any) => {
    setProductLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const updated = { ...line, [field]: value };
        // Auto-fill from product selection
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
                    {car.makeModel} \u2014 {car.plateNumber}
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
                          {s.name} \u2014 {formatCurrency(s.defaultPrice)}
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
            <button type="button" onClick={addProductLine} className="btn-secondary btn-sm">
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
                <div key={index} className="flex flex-col sm:flex-row gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <label className="label">{'\u0422\u043E\u0432\u0430\u0440'}</label>
                    <select
                      value={line.productId}
                      onChange={(e) => updateProductLine(index, 'productId', e.target.value)}
                      className="input"
                    >
                      <option value="">{'\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u043E\u0432\u0430\u0440'}</option>
                      {allProducts?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} \u2014 {formatCurrency(p.sellPrice)} (\u0441\u043A\u043B\u0430\u0434: {p.stock})
                        </option>
                      ))}
                    </select>
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
    </div>
  );
}
