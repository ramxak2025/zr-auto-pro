import { useState, FormEvent } from 'react';
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { clientsApi, carsApi, checksApi } from '../api/services';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import PhoneInput from '../components/PhoneInput';
import { Client, Car as CarType, Check } from '../types';

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

  // Delete car confirm
  const [deleteCarId, setDeleteCarId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
    mutationFn: ({ carId, data }: { carId: string; data: { plateNumber: string; makeModel: string; comment?: string } }) =>
      carsApi.update(carId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
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
    setCarModalOpen(true);
  };

  const openEditCarModal = (car: CarType) => {
    setEditingCar(car);
    setPlateNumber(car.plateNumber);
    setMakeModel(car.makeModel);
    setCarComment(car.comment || '');
    setCarModalOpen(true);
  };

  const closeCarModal = () => {
    setCarModalOpen(false);
    setEditingCar(null);
  };

  const handleCarSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      plateNumber,
      makeModel,
      comment: carComment || undefined,
    };
    if (editingCar) {
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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-RU').format(amount);
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
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white rounded-lg border border-gray-200">
                    <Car className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {car.plateNumber}
                    </p>
                    <p className="text-sm text-gray-500">{car.makeModel}</p>
                    {car.comment && (
                      <p className="text-xs text-gray-400 mt-0.5">{car.comment}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditCarModal(car)}
                    className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-white transition-colors"
                    title="Редактировать"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteCar(car.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                    title="Удалить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
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
                      {formatCurrency(check.totalRevenue)} сум
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
