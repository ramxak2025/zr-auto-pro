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
// Feature toggles bucketed by `group` (core / section / integration) so the editor
// and plan cards render the 23 keys under section headings. FEATURE_GROUPS wraps
// the shared single-source-of-truth registry (web + mobile), so it never drifts.
import { FEATURE_GROUPS } from '../../utils/featureGroups';

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
    // Scalar fields go through PATCH /plans/:id; the ENABLED feature set is written
    // through the dedicated, catalog-validated PUT /plans/:id/features (setFeatures).
    mutationFn: async ({ id, data, features }: { id: string; data: any; features: string[] }) => {
      await plansApi.update(id, data);
      await plansApi.setFeatures(id, features);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      // Feature changes alter what tenants on this plan can open (FeatureGate reads
      // the resolved sub.features), so refresh the subscription cache too.
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
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
        features: has ? prev.features.filter((f) => f !== key) : [...prev.features, key],
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Введите название тарифа');
      return;
    }

    // Scalar plan fields. Features are persisted separately via setFeatures on
    // edit; on create they ride along in the initial POST (no plan id yet).
    const scalar = {
      name: form.name,
      monthlyPrice: Number(form.monthlyPrice),
      description: form.description || undefined,
      maxUsers: Number(form.maxUsers),
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder),
    };

    if (editingPlan) {
      updateMutation.mutate({ id: editingPlan.id, data: scalar, features: form.features });
    } else {
      createMutation.mutate({ ...scalar, features: form.features });
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
                  <span className="text-2xl font-bold text-gray-900">{plan.monthlyPrice.toLocaleString('ru-RU')}</span>
                  <span className="text-gray-500 ml-1">₽/мес</span>
                </div>

                {plan.description && <p className="text-sm text-gray-500">{plan.description}</p>}

                <div className="text-sm text-gray-600">До {plan.maxUsers} сотрудников</div>

                {/* Feature availability — grouped by section */}
                <div className="space-y-2.5">
                  {FEATURE_GROUPS.map((grp) => (
                    <div key={grp.group}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                        {grp.label}
                      </p>
                      <ul className="text-sm space-y-1">
                        {grp.items.map((feat) => {
                          const included = features.includes(feat.key);
                          return (
                            <li key={feat.key} className="flex items-center gap-2">
                              {included ? (
                                <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                              ) : (
                                <X className="w-4 h-4 text-gray-300 flex-shrink-0" />
                              )}
                              <span className={included ? 'text-gray-700' : 'text-gray-400'}>{feat.label}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>

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

          {/* Feature checkboxes — grouped by section (core / section / integration) */}
          <div>
            <label className="label">Доступные функции</label>
            <div className="border border-gray-200 rounded-lg p-3 space-y-3 max-h-72 overflow-y-auto">
              {FEATURE_GROUPS.map((grp) => (
                <div key={grp.group}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1 px-1">{grp.label}</p>
                  <div className="space-y-0.5">
                    {grp.items.map((feat) => (
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
            <span className="text-sm font-medium text-gray-700">{form.isActive ? 'Активен' : 'Неактивен'}</span>
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
