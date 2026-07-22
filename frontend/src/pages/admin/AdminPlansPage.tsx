import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Trash2,
  CreditCard,
  Loader2,
  Check,
  X,
  Mic,
  Archive,
  ArchiveRestore,
  Users,
  Building2,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { plansApi, adminApi, tenantsApi } from '../../api/services';
import { Plan, PlatformSettings, Tenant } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import QueryState from '../../components/QueryState';
import Switch from '../../components/Switch';
import { AdminPageHeader } from '../../components/admin/adminUi';
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
  voiceMinutes: number;
  isActive: boolean;
  sortOrder: number;
}

const emptyForm: PlanFormData = {
  name: '',
  monthlyPrice: 0,
  description: '',
  features: [],
  maxUsers: 5,
  voiceMinutes: 0,
  isActive: true,
  sortOrder: 0,
};

export default function AdminPlansPage() {
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanFormData>({ ...emptyForm });
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);
  const [freeMinutes, setFreeMinutes] = useState('');

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['plans'],
    queryFn: () => plansApi.getAll(),
    select: (res) => res.data as Plan[],
  });

  const plans = data ?? [];

  // Число подключённых автосервисов на каждом тарифе — тот же кэш ['tenants'],
  // что и у списка клиентов. Показывает цену ошибки перед удалением тарифа.
  const { data: tenantsData } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.getAll(),
    select: (res) => res.data as Tenant[],
    staleTime: 60_000,
  });

  const subscribersByPlan = useMemo(() => {
    const map = new Map<string, number>();
    (tenantsData ?? []).forEach((t) => {
      if (t.planId) map.set(t.planId, (map.get(t.planId) ?? 0) + 1);
    });
    return map;
  }, [tenantsData]);

  // Платформенная настройка (superadmin): бесплатные минуты голосового ввода,
  // которые получает КАЖДЫЙ автосервис ежемесячно. Держим здесь же, чтобы весь
  // расчёт минут голоса (пакет тарифа + бесплатный тир платформы) настраивался
  // на одном экране.
  const { data: settings } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => adminApi.getSettings(),
    select: (res) => res.data as PlatformSettings,
  });

  useEffect(() => {
    if (settings) setFreeMinutes(String(settings.globalFreeVoiceMinutes ?? 0));
  }, [settings?.globalFreeVoiceMinutes]);

  const createMutation = useMutation({
    mutationFn: (payload: any) => plansApi.create(payload),
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

  // Архивация (isActive=false) — безопасная альтернатива удалению: тариф
  // исчезает из выбора, подключённые автосервисы продолжают работать.
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => plansApi.update(id, { isActive }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success(vars.isActive ? 'Тариф активирован' : 'Тариф в архиве');
    },
    onError: () => toast.error('Не удалось изменить статус тарифа'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => plansApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Тариф удалён');
    },
    onError: () => toast.error('Ошибка удаления'),
  });

  const settingsMutation = useMutation({
    mutationFn: (globalFreeVoiceMinutes: number) => adminApi.updateSettings({ globalFreeVoiceMinutes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      toast.success('Настройки платформы сохранены');
    },
    onError: () => toast.error('Не удалось сохранить настройки'),
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
      voiceMinutes: plan.voiceMinutes ?? 0,
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
      voiceMinutes: Number(form.voiceMinutes),
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

  const freeMinutesNum = Number(freeMinutes);
  const freeMinutesValid = freeMinutes.trim() !== '' && Number.isFinite(freeMinutesNum) && freeMinutesNum >= 0;
  const freeMinutesDirty =
    !!settings && freeMinutesValid && Math.round(freeMinutesNum) !== (settings.globalFreeVoiceMinutes ?? 0);

  const saveFreeMinutes = () => {
    if (!freeMinutesValid) {
      toast.error('Введите число не меньше 0');
      return;
    }
    settingsMutation.mutate(Math.round(freeMinutesNum));
  };

  const deleteSubscribers = deleteTarget ? (subscribersByPlan.get(deleteTarget.id) ?? 0) : 0;

  return (
    <div>
      <AdminPageHeader
        title="Тарифы"
        subtitle="Планы подписки и платформенные лимиты"
        actions={
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" />
            Новый тариф
          </button>
        }
      />

      {/* Платформенная настройка: бесплатные минуты голосового ввода всем автосервисам */}
      <div className="card card-body mb-6">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-primary-50 rounded-lg flex-shrink-0">
            <Mic className="w-5 h-5 text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900">Голосовой ввод — лимит платформы</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Бесплатные минуты голоса, которые ежемесячно получает каждый автосервис. Итоговый лимит автосервиса —
              максимум из пакета его тарифа и этого значения, плюс индивидуальная надбавка.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Бесплатных минут голоса всем автосервисам / мес</label>
                <input
                  type="number"
                  className="input w-64"
                  value={freeMinutes}
                  onChange={(e) => setFreeMinutes(e.target.value)}
                  min={0}
                  step={1}
                  disabled={!settings}
                />
              </div>
              <button
                type="button"
                onClick={saveFreeMinutes}
                disabled={settingsMutation.isPending || !freeMinutesDirty}
                className="btn-primary"
              >
                {settingsMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  'Сохранить'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить тарифы"
        isEmpty={plans.length === 0}
        empty={{
          icon: CreditCard,
          title: 'Нет тарифов',
          description: 'Создайте первый тариф',
          action: { label: 'Создать', onClick: openCreate },
        }}
        minHeight="min-h-[40vh]"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const features: string[] = Array.isArray(plan.features) ? plan.features : [];
            const subscribers = subscribersByPlan.get(plan.id) ?? 0;
            return (
              <div key={plan.id} className={`card flex flex-col p-5 ${plan.isActive ? '' : 'opacity-75'}`}>
                {/* Header: имя + статус */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-gray-900">{plan.name}</h3>
                    <div className="mt-1">
                      <span className="text-2xl font-bold tabular-nums text-gray-900">
                        {plan.monthlyPrice.toLocaleString('ru-RU')}
                      </span>
                      <span className="ml-1 text-gray-500">₽/мес</span>
                    </div>
                  </div>
                  {plan.isActive ? (
                    <span className="badge-green flex-shrink-0">Активен</span>
                  ) : (
                    <span className="badge-gray flex-shrink-0">В архиве</span>
                  )}
                </div>

                {plan.description && <p className="mt-1.5 text-sm text-gray-500">{plan.description}</p>}

                {/* Meta */}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-gray-400" />
                    до <span className="tabular-nums">{plan.maxUsers}</span> сотр.
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Mic className="h-3.5 w-3.5 text-gray-400" />
                    <span className="tabular-nums">{plan.voiceMinutes ?? 0}</span> мин/мес
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-gray-400" />
                    <span className="tabular-nums">{subscribers}</span> подключено
                  </span>
                </div>

                {/* Feature availability — grouped by section */}
                <div className="mt-4 flex-1 space-y-2.5 border-t border-gray-100 pt-3">
                  {FEATURE_GROUPS.map((grp) => (
                    <div key={grp.group}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                        {grp.label}
                      </p>
                      <ul className="space-y-0.5 text-[13px]">
                        {grp.items.map((feat) => {
                          const included = features.includes(feat.key);
                          return (
                            <li key={feat.key} className="flex items-center gap-2">
                              {included ? (
                                <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                              ) : (
                                <X className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                              )}
                              <span className={included ? 'text-gray-700' : 'text-gray-400'}>{feat.label}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
                  <button onClick={() => openEdit(plan)} className="btn-secondary btn-sm flex-1 justify-center">
                    <Pencil className="w-3.5 h-3.5" />
                    Редактировать
                  </button>
                  <button
                    onClick={() => toggleActiveMutation.mutate({ id: plan.id, isActive: !plan.isActive })}
                    disabled={toggleActiveMutation.isPending}
                    className="btn-ghost btn-sm"
                    title={plan.isActive ? 'В архив (скрыть из выбора)' : 'Вернуть из архива'}
                  >
                    {plan.isActive ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
                    {plan.isActive ? 'В архив' : 'Активировать'}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(plan)}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                    aria-label="Удалить тариф"
                    title="Удалить безвозвратно"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </QueryState>

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

          <div className="grid grid-cols-2 gap-4">
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
              <label className="label">Макс. сотрудников</label>
              <input
                type="number"
                className="input"
                value={form.maxUsers}
                onChange={(e) => setForm({ ...form, maxUsers: Number(e.target.value) })}
                min={1}
              />
            </div>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Минуты голоса / мес</label>
              <input
                type="number"
                className="input"
                value={form.voiceMinutes}
                onChange={(e) => setForm({ ...form, voiceMinutes: Number(e.target.value) })}
                min={0}
                step={1}
              />
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
          </div>
          <p className="text-xs text-gray-500">
            0 минут = только бесплатный лимит платформы. Работает при включённой функции «Голосовой ввод (пакет минут)».
          </p>

          <div className="flex items-center gap-3">
            <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Тариф активен" />
            <span className="text-sm font-medium text-gray-700">{form.isActive ? 'Активен' : 'В архиве'}</span>
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

      {/* Delete Confirmation — предупреждаем о подключённых автосервисах */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        title="Удалить тариф безвозвратно"
        message={
          deleteSubscribers > 0
            ? `На тарифе «${deleteTarget?.name}» сейчас ${deleteSubscribers} автосервис(ов). После удаления они останутся без тарифа и ПОТЕРЯЮТ доступ ко всем функциям до назначения нового. Обычно достаточно «В архив». Точно удалить?`
            : `Тариф «${deleteTarget?.name}» будет удалён безвозвратно. Если нужно просто скрыть его из выбора — используйте «В архив». Продолжить?`
        }
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
