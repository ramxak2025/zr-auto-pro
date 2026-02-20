import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, CreditCard, Loader2, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { plansApi } from '../../api/services';
import { Plan } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

// Feature keys and their human-readable labels
const ALL_FEATURES: { key: string; label: string }[] = [
  { key: 'checks_view', label: 'Заказ-наряды' },
  { key: 'clients_view', label: 'Клиенты и авто' },
  { key: 'warehouse_view', label: 'Склад' },
  { key: 'services_view', label: 'Услуги' },
  { key: 'suppliers_view', label: 'Поставщики' },
  { key: 'cashflow_view', label: 'Движение денег' },
  { key: 'salary_view', label: 'Зарплата' },
  { key: 'schedule_view', label: 'Расписание' },
  { key: 'reports_view', label: 'Отчёты' },
  { key: 'users_manage', label: 'Управление пользователями' },
  { key: 'export_data', label: 'Экспорт данных' },
];

// Helper to get label by feature key
function getFeatureLabel(key: string): string {
  const found = ALL_FEATURES.find((f) => f.key === key);
  return found ? found.label : key;
}

interface PlanFormData {
  name: string;
  monthlyPrice: number;
  description: string;
  features: string[];
  maxUsers: number;
  isActive: boolean;
  sortOrder: number;
}

const emptyForm: PlanFormData = {
  name: '',
  monthlyPrice: 0,
  description: '',
  features: [],
  maxUsers: 5,
  isActive: true,
  sortOrder: 0,
};

export default function AdminPlansPage() {
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanFormData>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => plansApi.getAll(),
    select: (res) => res.data as Plan[],
  });

  const plans = data ?? [];

  const createMutation = useMutation({
    mutationFn: (data: any) => plansApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Тариф создан');
      closeModal();
    },
    onError: () => toast.error('Ошибка создания'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => plansApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Тариф обновлён');
      closeModal();
    },
    onError: () => toast.error('Ошибка обновления'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => plansApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Тариф удалён');
    },
    onError: () => toast.error('Ошибка удаления'),
  });

  const openCreate = () => {
    setEditingPlan(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    const features: string[] = Array.isArray(plan.features) ? plan.features : [];
    setForm({
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      description: plan.description || '',
      features: [...features],
      maxUsers: plan.maxUsers,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingPlan(null);
    setForm({ ...emptyForm });
  };

  const toggleFeature = (key: string) => {
    setForm((prev) => {
      const has = prev.features.includes(key);
      return {
        ...prev,
        features: has
          ? prev.features.filter((f) => f !== key)
          : [...prev.features, key],
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Введите название тарифа');
      return;
    }

    const payload = {
      name: form.name,
      monthlyPrice: Number(form.monthlyPrice),
      description: form.description || undefined,
      features: form.features,
      maxUsers: Number(form.maxUsers),
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder),
    };

    if (editingPlan) {
      updateMutation.mutate({ id: editingPlan.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Тарифы</h1>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" />
          Новый тариф
        </button>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="Нет тарифов"
          description="Создайте первый тариф"
          action={{ label: 'Создать', onClick: openCreate }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const features: string[] = Array.isArray(plan.features) ? plan.features : [];
            return (
              <div key={plan.id} className="card card-body space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">{plan.name}</h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(plan)}
                      className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteId(plan.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-2xl font-bold text-gray-900">
                    {plan.monthlyPrice.toLocaleString('ru-RU')}
                  </span>
                  <span className="text-gray-500 ml-1">₽/мес</span>
                </div>

                {plan.description && (
                  <p className="text-sm text-gray-500">{plan.description}</p>
                )}

                <div className="text-sm text-gray-600">
                  До {plan.maxUsers} сотрудников
                </div>

                {/* Feature availability list */}
                <ul className="text-sm space-y-1">
                  {ALL_FEATURES.map((feat) => {
                    const included = features.includes(feat.key);
                    return (
                      <li key={feat.key} className="flex items-center gap-2">
                        {included ? (
                          <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <X className="w-4 h-4 text-red-400 flex-shrink-0" />
                        )}
                        <span className={included ? 'text-gray-700' : 'text-gray-400'}>
                          {feat.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <div className="pt-2 border-t border-gray-100">
                  {plan.isActive ? (
                    <span className="badge-green">Активен</span>
                  ) : (
                    <span className="badge-red">Неактивен</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingPlan ? 'Редактировать тариф' : 'Новый тариф'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Название</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Например: Бизнес"
              required
            />
          </div>

          <div>
            <label className="label">Цена (₽/мес)</label>
            <input
              type="number"
              className="input"
              value={form.monthlyPrice}
              onChange={(e) => setForm({ ...form, monthlyPrice: Number(e.target.value) })}
              min={0}
              step={100}
            />
          </div>

          <div>
            <label className="label">Описание</label>
            <input
              type="text"
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Краткое описание тарифа"
            />
          </div>

          <div>
            <label className="label">Макс. сотрудников</label>
            <input
              type="number"
              className="input"
              value={form.maxUsers}
              onChange={(e) => setForm({ ...form, maxUsers: Number(e.target.value) })}
              min={1}
            />
          </div>

          {/* Feature checkboxes */}
          <div>
            <label className="label">Доступные функции</label>
            <div className="border border-gray-200 rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
              {ALL_FEATURES.map((feat) => (
                <label
                  key={feat.key}
                  className="flex items-center gap-3 cursor-pointer py-1 px-2 rounded-md hover:bg-gray-50 transition-colors"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    checked={form.features.includes(feat.key)}
                    onChange={() => toggleFeature(feat.key)}
                  />
                  <span className="text-sm text-gray-700">{feat.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Порядок сортировки</label>
            <input
              type="number"
              className="input"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
              min={0}
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
            </label>
            <span className="text-sm font-medium text-gray-700">
              {form.isActive ? 'Активен' : 'Неактивен'}
            </span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeModal} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={isSaving} className="btn-primary">
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Сохранение...
                </>
              ) : editingPlan ? (
                'Сохранить'
              ) : (
                'Создать'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Удалить тариф"
        message="Вы уверены, что хотите удалить этот тариф?"
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
