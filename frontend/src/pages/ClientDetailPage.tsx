import { useState, FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Pencil,
  Plus,
  Trash2,
  Loader2,
  Car,
  FileText,
  BarChart3,
  Phone,
  MessageSquare,
  CalendarDays,
} from 'lucide-react';
import { clientsApi, carsApi } from '../api/services';
import type { Client, Car as CarType, Check } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

// ---------------------------------------------------------------------------
// Car Form Modal
// ---------------------------------------------------------------------------

interface CarFormData {
  plateNumber: string;
  makeModel: string;
  comment: string;
}

interface CarFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  car?: CarType | null;
  onSubmit: (data: CarFormData) => void;
  isLoading: boolean;
}

function CarFormModal({
  isOpen,
  onClose,
  car,
  onSubmit,
  isLoading,
}: CarFormModalProps) {
  const [plateNumber, setPlateNumber] = useState(car?.plateNumber || '');
  const [makeModel, setMakeModel] = useState(car?.makeModel || '');
  const [comment, setComment] = useState(car?.comment || '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!plateNumber.trim()) {
      toast.error('Введите госномер');
      return;
    }
    if (!makeModel.trim()) {
      toast.error('Введите марку и модель');
      return;
    }
    onSubmit({
      plateNumber: plateNumber.trim(),
      makeModel: makeModel.trim(),
      comment: comment.trim(),
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={car ? 'Редактировать автомобиль' : 'Добавить автомобиль'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Госномер <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={plateNumber}
            onChange={(e) => setPlateNumber(e.target.value)}
            placeholder="А123БВ777"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Марка / Модель <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={makeModel}
            onChange={(e) => setMakeModel(e.target.value)}
            placeholder="Toyota Camry"
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
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

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {car ? 'Сохранить' : 'Добавить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Client Edit Modal
// ---------------------------------------------------------------------------

interface ClientEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: Client;
  onSubmit: (data: { fullName: string; phone: string; comment: string }) => void;
  isLoading: boolean;
}

function ClientEditModal({
  isOpen,
  onClose,
  client,
  onSubmit,
  isLoading,
}: ClientEditModalProps) {
  const [fullName, setFullName] = useState(client.fullName);
  const [phone, setPhone] = useState(client.phone);
  const [comment, setComment] = useState(client.comment || '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error('Введите ФИО клиента');
      return;
    }
    onSubmit({
      fullName: fullName.trim(),
      phone: phone.trim(),
      comment: comment.trim(),
    });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Редактировать клиента">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            ФИО <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Телефон
          </label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Комментарий
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabKey = 'cars' | 'checks' | 'stats';

const TABS: { key: TabKey; label: string; icon: typeof Car }[] = [
  { key: 'cars', label: 'Автомобили', icon: Car },
  { key: 'checks', label: 'Чеки', icon: FileText },
  { key: 'stats', label: 'Статистика', icon: BarChart3 },
];

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>('cars');
  const [editClientOpen, setEditClientOpen] = useState(false);

  // Car modals
  const [carFormOpen, setCarFormOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<CarType | null>(null);
  const [deleteCarTarget, setDeleteCarTarget] = useState<CarType | null>(null);

  // ---- Queries ----

  const {
    data: client,
    isLoading,
    isError,
  } = useQuery<Client>({
    queryKey: ['client', id],
    queryFn: async () => {
      const res = await clientsApi.getById(id!);
      return res.data;
    },
    enabled: !!id,
  });

  const { data: stats } = useQuery<{ totalPayments: number }>({
    queryKey: ['client-stats', id],
    queryFn: async () => {
      const res = await clientsApi.getStats(id!);
      return res.data;
    },
    enabled: !!id && activeTab === 'stats',
  });

  // ---- Mutations ----

  const updateClientMutation = useMutation({
    mutationFn: (data: { fullName: string; phone: string; comment: string }) =>
      clientsApi.update(id!, data),
    onSuccess: () => {
      toast.success('Клиент обновлён');
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      setEditClientOpen(false);
    },
    onError: () => {
      toast.error('Не удалось обновить клиента');
    },
  });

  const createCarMutation = useMutation({
    mutationFn: (data: CarFormData) =>
      carsApi.create({ ...data, clientId: id }),
    onSuccess: () => {
      toast.success('Автомобиль добавлен');
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      closeCarForm();
    },
    onError: () => {
      toast.error('Не удалось добавить автомобиль');
    },
  });

  const updateCarMutation = useMutation({
    mutationFn: ({ carId, data }: { carId: string; data: CarFormData }) =>
      carsApi.update(carId, data),
    onSuccess: () => {
      toast.success('Автомобиль обновлён');
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      closeCarForm();
    },
    onError: () => {
      toast.error('Не удалось обновить автомобиль');
    },
  });

  const deleteCarMutation = useMutation({
    mutationFn: (carId: string) => carsApi.delete(carId),
    onSuccess: () => {
      toast.success('Автомобиль удалён');
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      setDeleteCarTarget(null);
    },
    onError: () => {
      toast.error('Не удалось удалить автомобиль');
    },
  });

  // ---- Handlers ----

  function closeCarForm() {
    setCarFormOpen(false);
    setEditingCar(null);
  }

  function handleCarSubmit(data: CarFormData) {
    if (editingCar) {
      updateCarMutation.mutate({ carId: editingCar.id, data });
    } else {
      createCarMutation.mutate(data);
    }
  }

  // ---- Render ----

  if (isLoading) return <LoadingSpinner />;

  if (isError || !client) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/clients')}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад к клиентам
        </button>
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Клиент не найден</p>
        </div>
      </div>
    );
  }

  const cars = client.cars || [];
  const checks = client.checks || [];
  const isCarMutating = createCarMutation.isPending || updateCarMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Back button + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/clients')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors hover:bg-gray-50 flex-shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{client.fullName}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Клиент с {formatDate(client.createdAt)}
          </p>
        </div>
      </div>

      {/* Client info card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span className="text-gray-700">{client.phone}</span>
          </div>
          {client.comment && (
            <div className="flex items-start gap-2 text-sm">
              <MessageSquare className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <span className="text-gray-600 break-words">{client.comment}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span className="text-gray-500">
              Зарегистрирован: {formatDate(client.createdAt)}
            </span>
          </div>
          <button
            onClick={() => setEditClientOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Pencil className="h-4 w-4" />
            Редактировать
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'cars' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Автомобили ({cars.length})
            </h2>
            <button
              onClick={() => {
                setEditingCar(null);
                setCarFormOpen(true);
              }}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Добавить
            </button>
          </div>

          {cars.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white">
              <EmptyState
                icon={Car}
                title="Нет автомобилей"
                description="Добавьте автомобиль клиента"
              />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {cars.map((car) => (
                <div
                  key={car.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900 text-lg">
                        {car.plateNumber}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">{car.makeModel}</p>
                      {car.comment && (
                        <p className="text-sm text-gray-400 mt-2">{car.comment}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingCar(car);
                          setCarFormOpen(true);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteCarTarget(car)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'checks' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Чеки ({checks.length})
          </h2>

          {checks.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white">
              <EmptyState
                icon={FileText}
                title="Нет чеков"
                description="Чеки этого клиента будут отображаться здесь"
              />
            </div>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="md:hidden space-y-2">
                {checks.map((check: Check) => (
                  <button
                    key={check.id}
                    type="button"
                    onClick={() => navigate(`/checks/${check.id}`)}
                    className="flex items-center gap-3 w-full max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm hover:shadow-md active:bg-gray-50 transition-all box-border"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 flex-shrink-0">
                      <FileText className="h-5 w-5 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">#{check.number}</span>
                        <span className="text-xs text-gray-400">{formatDate(check.date)}</span>
                      </div>
                      {check.car && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {check.car.plateNumber} {check.car.makeModel}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-bold text-gray-900 flex-shrink-0 whitespace-nowrap">
                      {formatMoney(check.totalRevenue)}
                    </span>
                  </button>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50/50">
                        <th className="px-4 py-3 font-semibold text-gray-600">Номер</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Дата</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Автомобиль</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">
                          Сумма
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {checks.map((check: Check) => (
                        <tr
                          key={check.id}
                          onClick={() => navigate(`/checks/${check.id}`)}
                          className="cursor-pointer transition-colors hover:bg-gray-50"
                        >
                          <td className="px-4 py-3 font-medium text-gray-900">
                            #{check.number}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {formatDate(check.date)}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {check.car
                              ? `${check.car.plateNumber} ${check.car.makeModel}`
                              : '\u2014'}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                            {formatMoney(check.totalRevenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'stats' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Статистика</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Всего оплат</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {formatMoney(stats?.totalPayments || 0)}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Автомобилей</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{cars.length}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500">Визитов</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{checks.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* Client edit modal */}
      {editClientOpen && client && (
        <ClientEditModal
          key={client.id}
          isOpen={editClientOpen}
          onClose={() => setEditClientOpen(false)}
          client={client}
          onSubmit={(data) => updateClientMutation.mutate(data)}
          isLoading={updateClientMutation.isPending}
        />
      )}

      {/* Car form modal */}
      {carFormOpen && (
        <CarFormModal
          key={editingCar?.id || 'new-car'}
          isOpen={carFormOpen}
          onClose={closeCarForm}
          car={editingCar}
          onSubmit={handleCarSubmit}
          isLoading={isCarMutating}
        />
      )}

      {/* Delete car confirm */}
      <ConfirmDialog
        isOpen={!!deleteCarTarget}
        onClose={() => setDeleteCarTarget(null)}
        onConfirm={() =>
          deleteCarTarget && deleteCarMutation.mutate(deleteCarTarget.id)
        }
        title="Удалить автомобиль"
        message={`Вы уверены, что хотите удалить автомобиль "${deleteCarTarget?.plateNumber} ${deleteCarTarget?.makeModel}"?`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
