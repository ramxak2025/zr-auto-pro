import { useState, useEffect, useRef, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Edit2,
  Plus,
  Trash2,
  User,
  Phone,
  MessageSquare,
  Car,
  Calendar,
  FileText,
  ChevronDown,
  ChevronUp,
  Search,
  UserCheck,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { clientsApi, carsApi, checksApi } from '../api/services';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import PhoneInput from '../components/PhoneInput';
import { Client, Car as CarType, Check } from '../types';

// ---- Car Checks Expandable Panel ----
function CarChecksPanel({ carId }: { carId: string }) {
  const navigate = useNavigate();

  const { data: checksData, isLoading } = useQuery<{ data: Check[] }>({
    queryKey: ['checks', { carId }],
    queryFn: async () => {
      const res = await checksApi.getAll({ carId });
      return res.data;
    },
    enabled: !!carId,
  });

  const checks: Check[] = checksData?.data || [];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('ru-RU') + ' \u20BD';
  };

  const paymentLabel = (method: string) => {
    switch (method) {
      case 'cash':
        return 'Наличные';
      case 'card':
        return 'Карта';
      case 'warranty':
        return 'Гарантия';
      case 'cash_card':
        return 'Нал + Карта';
      default:
        return method;
    }
  };

  const paymentBadge = (method: string) => {
    switch (method) {
      case 'cash':
        return 'badge-success';
      case 'card':
        return 'badge-info';
      case 'warranty':
        return 'badge-warning';
      default:
        return 'badge-default';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        <span className="ml-2 text-sm text-gray-500">Загрузка чеков...</span>
      </div>
    );
  }

  if (checks.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-gray-400">
        Нет чеков для этого автомобиля
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {checks.map((check) => (
        <div
          key={check.id}
          onClick={() => navigate(`/checks/${check.id}`)}
          className="flex items-center justify-between py-3 px-2 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 bg-white rounded-lg border border-gray-200">
              <FileText className="w-4 h-4 text-gray-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                #{check.number}
              </p>
              <p className="text-xs text-gray-500">
                {formatDate(check.date || check.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-sm font-semibold text-gray-900">
              {formatCurrency(check.totalRevenue)}
            </span>
            <span className={paymentBadge(check.paymentMethod)}>
              {paymentLabel(check.paymentMethod)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Client Search Autocomplete for owner change ----
function ClientSearchAutocomplete({
  selectedClient,
  onSelect,
  excludeClientId,
}: {
  selectedClient: Client | null;
  onSelect: (client: Client | null) => void;
  excludeClientId?: string;
}) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: clientsData, isLoading } = useQuery<{ data: Client[] }>({
    queryKey: ['clients', { search, limit: 10 }],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search, limit: 10 });
      return res.data;
    },
    enabled: search.length >= 1,
  });

  const clients: Client[] = (clientsData?.data || []).filter(
    (c) => c.id !== excludeClientId
  );

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (client: Client) => {
    onSelect(client);
    setSearch('');
    setIsOpen(false);
  };

  const handleClear = () => {
    onSelect(null);
    setSearch('');
  };

  if (selectedClient) {
    return (
      <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-xl border border-primary-200">
        <div className="p-1.5 bg-white rounded-lg">
          <UserCheck className="w-4 h-4 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{selectedClient.fullName}</p>
          <p className="text-xs text-gray-500">{selectedClient.phone}</p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
        >
          Сбросить
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (search.length >= 1) setIsOpen(true);
          }}
          className="input pl-9"
          placeholder="Поиск клиента по имени или телефону..."
        />
      </div>

      {isOpen && search.length >= 1 && (
        <div className="absolute z-50 w-full mt-1 bg-white rounded-xl shadow-lg border border-gray-200 max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
              <span className="ml-2 text-sm text-gray-500">Поиск...</span>
            </div>
          ) : clients.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-400">
              Клиенты не найдены
            </div>
          ) : (
            clients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => handleSelect(client)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors first:rounded-t-xl last:rounded-b-xl"
              >
                <div className="p-1.5 bg-gray-100 rounded-lg">
                  <User className="w-4 h-4 text-gray-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {client.fullName}
                  </p>
                  <p className="text-xs text-gray-500">{client.phone}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---- Main Page Component ----
export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Client edit modal
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [clientComment, setClientComment] = useState('');

  // Car modal
  const [carModalOpen, setCarModalOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<CarType | null>(null);
  const [plateNumber, setPlateNumber] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [carComment, setCarComment] = useState('');
  const [newOwner, setNewOwner] = useState<Client | null>(null);

  // Delete car confirm
  const [deleteCarId, setDeleteCarId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Expanded car (to show checks)
  const [expandedCarId, setExpandedCarId] = useState<string | null>(null);

  // Fetch client
  const {
    data: client,
    isLoading,
    isError,
  } = useQuery<Client>({
    queryKey: ['clients', id],
    queryFn: async () => {
      const res = await clientsApi.getById(id!);
      return res.data;
    },
    enabled: !!id,
  });

  // Fetch recent checks for this client
  const { data: checksData } = useQuery<{ data: Check[] }>({
    queryKey: ['checks', { clientId: id, limit: 5 }],
    queryFn: async () => {
      const res = await checksApi.getAll({ clientId: id, limit: 5 });
      return res.data;
    },
    enabled: !!id,
  });

  // Client update mutation
  const updateClientMutation = useMutation({
    mutationFn: (data: { fullName: string; phone: string; comment?: string }) =>
      clientsApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Клиент обновлён');
      setClientModalOpen(false);
    },
    onError: () => {
      toast.error('Ошибка при обновлении клиента');
    },
  });

  // Car mutations
  const createCarMutation = useMutation({
    mutationFn: (data: { plateNumber: string; makeModel: string; comment?: string; clientId: string }) =>
      carsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      toast.success('Автомобиль добавлен');
      closeCarModal();
    },
    onError: () => {
      toast.error('Ошибка при добавлении автомобиля');
    },
  });

  const updateCarMutation = useMutation({
    mutationFn: ({ carId, data }: { carId: string; data: { plateNumber: string; makeModel: string; comment?: string; clientId?: string } }) =>
      carsApi.update(carId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      toast.success('Автомобиль обновлён');
      closeCarModal();
    },
    onError: () => {
      toast.error('Ошибка при обновлении автомобиля');
    },
  });

  const deleteCarMutation = useMutation({
    mutationFn: (carId: string) => carsApi.remove(carId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      toast.success('Автомобиль удалён');
    },
    onError: () => {
      toast.error('Ошибка при удалении автомобиля');
    },
  });

  // Client edit handlers
  const openClientEditModal = () => {
    if (!client) return;
    setFullName(client.fullName);
    setPhone(client.phone);
    setClientComment(client.comment || '');
    setClientModalOpen(true);
  };

  const handleClientSubmit = (e: FormEvent) => {
    e.preventDefault();
    updateClientMutation.mutate({
      fullName,
      phone,
      comment: clientComment || undefined,
    });
  };

  // Car handlers
  const openAddCarModal = () => {
    setEditingCar(null);
    setPlateNumber('');
    setMakeModel('');
    setCarComment('');
    setNewOwner(null);
    setCarModalOpen(true);
  };

  const openEditCarModal = (car: CarType) => {
    setEditingCar(car);
    setPlateNumber(car.plateNumber);
    setMakeModel(car.makeModel);
    setCarComment(car.comment || '');
    setNewOwner(null);
    setCarModalOpen(true);
  };

  const closeCarModal = () => {
    setCarModalOpen(false);
    setEditingCar(null);
    setNewOwner(null);
  };

  const handleCarSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload: { plateNumber: string; makeModel: string; comment?: string; clientId?: string } = {
      plateNumber,
      makeModel,
      comment: carComment || undefined,
    };
    if (editingCar) {
      // Include clientId only if owner was changed
      if (newOwner) {
        payload.clientId = newOwner.id;
      }
      updateCarMutation.mutate({ carId: editingCar.id, data: payload });
    } else {
      createCarMutation.mutate({ ...payload, clientId: id! });
    }
  };

  const handleDeleteCar = (carId: string) => {
    setDeleteCarId(carId);
    setConfirmOpen(true);
  };

  const confirmDeleteCar = () => {
    if (deleteCarId) {
      deleteCarMutation.mutate(deleteCarId);
      setDeleteCarId(null);
    }
  };

  const toggleCarExpand = (carId: string) => {
    setExpandedCarId((prev) => (prev === carId ? null : carId));
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('ru-RU') + ' \u20BD';
  };

  if (isLoading) return <LoadingSpinner />;

  if (isError || !client) {
    return (
      <EmptyState
        icon={User}
        title="Клиент не найден"
        description="Запрашиваемый клиент не существует или был удалён"
        action={{ label: 'К списку клиентов', onClick: () => navigate('/clients') }}
      />
    );
  }

  const recentChecks: Check[] = checksData?.data || [];

  return (
    <div>
      {/* Back button */}
      <button
        onClick={() => navigate('/clients')}
        className="btn-secondary mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Назад к клиентам
      </button>

      {/* Client Info Card */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Информация о клиенте
          </h2>
          <button onClick={openClientEditModal} className="btn-secondary">
            <Edit2 className="w-4 h-4" />
            Редактировать
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-50 rounded-lg">
              <User className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">ФИО</p>
              <p className="font-medium text-gray-900">{client.fullName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <Phone className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Телефон</p>
              <p className="font-medium text-gray-900">{client.phone}</p>
            </div>
          </div>

          {client.comment && (
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-50 rounded-lg">
                <MessageSquare className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Комментарий</p>
                <p className="font-medium text-gray-900">{client.comment}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <Calendar className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Дата регистрации</p>
              <p className="font-medium text-gray-900">{formatDate(client.createdAt)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Cars Section */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Автомобили ({client.cars?.length || 0})
          </h2>
          <button onClick={openAddCarModal} className="btn-primary">
            <Plus className="w-4 h-4" />
            Добавить авто
          </button>
        </div>

        {(!client.cars || client.cars.length === 0) ? (
          <EmptyState
            icon={Car}
            title="Нет автомобилей"
            description="Добавьте автомобиль клиента"
            action={{ label: 'Добавить авто', onClick: openAddCarModal }}
          />
        ) : (
          <div className="space-y-3">
            {client.cars.map((car) => (
              <div
                key={car.id}
                className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden transition-shadow hover:shadow-sm"
              >
                {/* Car header row */}
                <div className="flex items-center justify-between p-4">
                  <button
                    type="button"
                    onClick={() => toggleCarExpand(car.id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <div className="p-2 bg-white rounded-xl border border-gray-200">
                      <Car className="w-5 h-5 text-gray-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">
                        {car.plateNumber}
                      </p>
                      <p className="text-sm text-gray-500">{car.makeModel}</p>
                      {car.comment && (
                        <p className="text-xs text-gray-400 mt-0.5">{car.comment}</p>
                      )}
                    </div>
                    <div className="ml-auto mr-2">
                      {expandedCarId === car.id ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditCarModal(car);
                      }}
                      className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-white transition-colors"
                      title="Редактировать"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCar(car.id);
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded checks panel */}
                {expandedCarId === car.id && (
                  <div className="border-t border-gray-200 bg-white px-4 py-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 pt-2">
                      Чеки по автомобилю
                    </p>
                    <CarChecksPanel carId={car.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Checks Section */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Последние чеки
        </h2>

        {recentChecks.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Нет чеков"
            description="У клиента пока нет чеков"
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Дата</th>
                  <th>Автомобиль</th>
                  <th>Сумма</th>
                  <th>Оплата</th>
                </tr>
              </thead>
              <tbody>
                {recentChecks.map((check) => (
                  <tr
                    key={check.id}
                    onClick={() => navigate(`/checks/${check.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td>
                      <span className="font-medium text-gray-900">
                        #{check.number}
                      </span>
                    </td>
                    <td className="text-gray-600">
                      {formatDate(check.date || check.createdAt)}
                    </td>
                    <td className="text-gray-600">
                      {check.car?.plateNumber || '—'}
                    </td>
                    <td className="font-medium text-gray-900">
                      {formatCurrency(check.totalRevenue)}
                    </td>
                    <td>
                      <span
                        className={
                          check.paymentMethod === 'cash'
                            ? 'badge-success'
                            : check.paymentMethod === 'card'
                            ? 'badge-info'
                            : check.paymentMethod === 'warranty'
                            ? 'badge-warning'
                            : 'badge-default'
                        }
                      >
                        {check.paymentMethod === 'cash'
                          ? 'Наличные'
                          : check.paymentMethod === 'card'
                          ? 'Карта'
                          : check.paymentMethod === 'warranty'
                          ? 'Гарантия'
                          : 'Нал + Карта'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Client Edit Modal */}
      <Modal
        isOpen={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        title="Редактировать клиента"
      >
        <form onSubmit={handleClientSubmit} className="space-y-4">
          <div>
            <label className="label">ФИО</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input"
              placeholder="Введите ФИО клиента"
              required
            />
          </div>

          <div>
            <label className="label">Телефон</label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              placeholder="+7 (___) ___-__-__"
              required
            />
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              value={clientComment}
              onChange={(e) => setClientComment(e.target.value)}
              className="input"
              rows={3}
              placeholder="Комментарий (необязательно)"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => setClientModalOpen(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={updateClientMutation.isPending}
              className="btn-primary"
            >
              Сохранить
            </button>
          </div>
        </form>
      </Modal>

      {/* Car Modal */}
      <Modal
        isOpen={carModalOpen}
        onClose={closeCarModal}
        title={editingCar ? 'Редактировать автомобиль' : 'Добавить автомобиль'}
      >
        <form onSubmit={handleCarSubmit} className="space-y-4">
          <div>
            <label className="label">Гос номер</label>
            <input
              type="text"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
              className="input"
              placeholder="01 A 123 AA"
              required
            />
          </div>

          <div>
            <label className="label">Марка / Модель</label>
            <input
              type="text"
              value={makeModel}
              onChange={(e) => setMakeModel(e.target.value)}
              className="input"
              placeholder="Например: Chevrolet Malibu"
              required
            />
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              value={carComment}
              onChange={(e) => setCarComment(e.target.value)}
              className="input"
              rows={3}
              placeholder="Комментарий (необязательно)"
            />
          </div>

          {/* Owner change - only shown when editing */}
          {editingCar && (
            <div>
              <label className="label">Сменить владельца</label>
              <p className="text-xs text-gray-500 mb-2">
                Текущий владелец: <span className="font-medium text-gray-700">{client.fullName}</span>
              </p>
              <ClientSearchAutocomplete
                selectedClient={newOwner}
                onSelect={setNewOwner}
                excludeClientId={id}
              />
              {newOwner && (
                <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                  <UserCheck className="w-3 h-3" />
                  Автомобиль будет перенесён к клиенту: {newOwner.fullName}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeCarModal} className="btn-secondary">
              Отмена
            </button>
            <button
              type="submit"
              disabled={createCarMutation.isPending || updateCarMutation.isPending}
              className="btn-primary"
            >
              {editingCar ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Car Confirm */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmDeleteCar}
        title="Удалить автомобиль"
        message="Вы уверены, что хотите удалить этот автомобиль? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
