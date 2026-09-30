import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Building2,
  Check,
  CreditCard,
  Mic,
  Pencil,
  Plus,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { plansApi, adminApi, tenantsApi } from '../../api/services';
import { Plan, PlatformSettings, Tenant } from '../../types';
import { formatMoney } from '../../../../shared/utils/formatters';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import QueryState from '../../components/QueryState';
import Switch from '../../components/Switch';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { Checkbox } from '../../ui/Checkbox';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { SkeletonCard } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
// Feature toggles bucketed by `group` (core / section / integration) so the editor
// and plan cards render the 23 keys under section headings. FEATURE_GROUPS wraps
// the shared single-source-of-truth registry (web + mobile), so it never drifts.
import { FEATURE_GROUPS } from '../../utils/featureGroups';
import { pluralRu } from '../../components/knowledge/utils';

// Числовые поля держим строками: инпуты текстовые (inputMode), Number() — на отправке.
interface PlanFormData {
  name: string;
  monthlyPrice: string;
  description: string;
  features: string[];
  maxUsers: string;
  voiceMinutes: string;
  isActive: boolean;
  sortOrder: string;
}

const emptyForm: PlanFormData = {
  name: '',
  monthlyPrice: '0',
  description: '',
  features: [],
  maxUsers: '5',
  voiceMinutes: '0',
  isActive: true,
  sortOrder: '0',
};

const digitsOnly = (v: string) => v.replace(/[^\d]/g, '');

export default function AdminPlansPage() {
  const queryClient = useQueryClient();
  const uid = useId();
  const formId = `${uid}-plan-form`;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanFormData>({ ...emptyForm });
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);
  const [freeMinutes, setFreeMinutes] = useState('');
  const [managerFreeDays, setManagerFreeDays] = useState('');

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
  const {
    data: settings,
    isError: settingsError,
    refetch: refetchSettings,
    isFetching: settingsFetching,
  } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => adminApi.getSettings(),
    select: (res) => res.data as PlatformSettings,
  });

  useEffect(() => {
    if (settings) setFreeMinutes(String(settings.globalFreeVoiceMinutes ?? 0));
  }, [settings?.globalFreeVoiceMinutes]);

  const savedManagerFreeDays = settings?.managerMaxFreeDays;
  useEffect(() => {
    if (savedManagerFreeDays != null) setManagerFreeDays(String(savedManagerFreeDays));
  }, [savedManagerFreeDays]);

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

  // Лимит бесплатных (пробных) дней менеджера читает сервер при каждом его бесплатном продлении.
  const managerFreeDaysMutation = useMutation({
    mutationFn: (managerMaxFreeDays: number) => adminApi.updateSettings({ managerMaxFreeDays }),
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
      monthlyPrice: String(plan.monthlyPrice),
      description: plan.description || '',
      features: [...features],
      maxUsers: String(plan.maxUsers),
      voiceMinutes: String(plan.voiceMinutes ?? 0),
      isActive: plan.isActive,
      sortOrder: String(plan.sortOrder),
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
      monthlyPrice: Number(form.monthlyPrice) || 0,
      description: form.description || undefined,
      maxUsers: Math.max(1, Number(form.maxUsers) || 1),
      voiceMinutes: Number(form.voiceMinutes) || 0,
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
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

  const managerFreeDaysNum = Number(managerFreeDays);
  const managerFreeDaysValid =
    managerFreeDays.trim() !== '' && Number.isInteger(managerFreeDaysNum) && managerFreeDaysNum >= 1;
  const managerFreeDaysDirty =
    !!settings && managerFreeDaysValid && managerFreeDaysNum !== (settings.managerMaxFreeDays ?? 0);

  const saveManagerFreeDays = () => {
    if (!managerFreeDaysValid) {
      toast.error('Введите целое число не меньше 1');
      return;
    }
    managerFreeDaysMutation.mutate(managerFreeDaysNum);
  };

  const deleteSubscribers = deleteTarget ? (subscribersByPlan.get(deleteTarget.id) ?? 0) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Тарифы"
        icon={CreditCard}
        subtitle="Планы подписки и платформенные лимиты"
        actions={
          <Button icon={Plus} onClick={openCreate}>
            Новый тариф
          </Button>
        }
      />

      {/* Платформенная настройка: бесплатные минуты голосового ввода всем автосервисам */}
      <Card padding="none">
        <CardHeader
          icon={Mic}
          title="Голосовой ввод — лимит платформы"
          subtitle="Бесплатные минуты голоса, которые ежемесячно получает каждый автосервис"
          divider={false}
        />
        <div className="px-5 pb-5">
          <p className="mb-4 max-w-[70ch] text-sm text-ink-2">
            Итоговый лимит автосервиса — максимум из пакета его тарифа и этого значения, плюс индивидуальная надбавка.
          </p>
          {settingsError ? (
            <QueryState
              isLoading={false}
              isError
              onRetry={refetchSettings}
              isFetching={settingsFetching}
              errorTitle="Не удалось загрузить настройки платформы"
              minHeight="py-6"
            >
              {null}
            </QueryState>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Бесплатных минут в месяц" htmlFor={`${uid}-free-min`} className="w-48">
                <Input
                  id={`${uid}-free-min`}
                  inputMode="numeric"
                  className="tabular-nums"
                  value={freeMinutes}
                  onChange={(e) => setFreeMinutes(digitsOnly(e.target.value))}
                  disabled={!settings}
                  rightSlot={<span className="text-xs">мин</span>}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={saveFreeMinutes}
                disabled={!freeMinutesDirty}
                loading={settingsMutation.isPending}
              >
                Сохранить
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Платформенная настройка: сколько дней пробного доступа менеджер может выдать за одно продление */}
      <Card padding="none">
        <CardHeader
          icon={UserCog}
          title="Менеджеры — пробный доступ"
          subtitle="Предел бесплатного продления, которое менеджер платформы делает сам"
          divider={false}
        />
        <div className="px-5 pb-5">
          <p className="mb-4 max-w-[70ch] text-sm text-ink-2">
            Действует на каждое бесплатное продление и на пробный период при создании автосервиса менеджером. Платные
            продления менеджер ограничивает только суммой оплаты.
          </p>
          {settingsError ? (
            <QueryState
              isLoading={false}
              isError
              onRetry={refetchSettings}
              isFetching={settingsFetching}
              errorTitle="Не удалось загрузить настройки платформы"
              minHeight="py-6"
            >
              {null}
            </QueryState>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field
                label="Максимум дней пробного доступа у менеджера"
                htmlFor={`${uid}-mgr-free-days`}
                className="w-full sm:w-80"
                error={managerFreeDays && !managerFreeDaysValid ? 'Введите целое число не меньше 1.' : undefined}
              >
                <Input
                  id={`${uid}-mgr-free-days`}
                  inputMode="numeric"
                  className="tabular-nums"
                  value={managerFreeDays}
                  onChange={(e) => setManagerFreeDays(digitsOnly(e.target.value))}
                  disabled={!settings}
                  invalid={!!managerFreeDays && !managerFreeDaysValid}
                  rightSlot={<span className="text-xs">дн.</span>}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={saveManagerFreeDays}
                disabled={!managerFreeDaysDirty}
                loading={managerFreeDaysMutation.isPending}
              >
                Сохранить
              </Button>
            </div>
          )}
        </div>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} lines={6} />
          ))}
        </div>
      ) : (
        <QueryState
          isLoading={false}
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
          minHeight="py-14"
        >
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Тарифы">
            {plans.map((plan) => {
              const features: string[] = Array.isArray(plan.features) ? plan.features : [];
              const subscribers = subscribersByPlan.get(plan.id) ?? 0;
              return (
                <li key={plan.id}>
                  <Card
                    as="article"
                    padding="none"
                    className={cn('flex h-full flex-col', !plan.isActive && 'opacity-80')}
                  >
                    <div className="px-5 pt-5">
                      {/* Header: имя + статус */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="truncate text-md font-semibold text-ink">{plan.name}</h2>
                          <p className="mt-1">
                            <span className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                              {formatMoney(plan.monthlyPrice)}
                            </span>
                            <span className="ml-1 text-sm text-ink-3">/мес</span>
                          </p>
                        </div>
                        {plan.isActive ? (
                          <Badge tone="ok" dot className="flex-shrink-0">
                            Активен
                          </Badge>
                        ) : (
                          <Badge className="flex-shrink-0">В архиве</Badge>
                        )}
                      </div>

                      {plan.description && <p className="mt-1.5 text-sm text-ink-3">{plan.description}</p>}

                      {/* Meta */}
                      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
                        <div className="inline-flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
                          <dt className="sr-only">Сотрудников</dt>
                          <dd>
                            до <span className="tabular-nums">{plan.maxUsers}</span> сотр.
                          </dd>
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <Mic className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
                          <dt className="sr-only">Минут голоса</dt>
                          <dd>
                            <span className="tabular-nums">{plan.voiceMinutes ?? 0}</span> мин/мес
                          </dd>
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
                          <dt className="sr-only">Подключено автосервисов</dt>
                          <dd>
                            <span className="tabular-nums">{subscribers}</span>{' '}
                            {pluralRu(subscribers, 'подключён', 'подключено', 'подключено')}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {/* Feature availability — grouped by section */}
                    <div className="mt-4 flex-1 space-y-3 border-t border-line px-5 pt-4">
                      {FEATURE_GROUPS.map((grp) => (
                        <div key={grp.group}>
                          <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-3">{grp.label}</p>
                          <ul className="space-y-0.5 text-[13px]">
                            {grp.items.map((feat) => {
                              const included = features.includes(feat.key);
                              return (
                                <li key={feat.key} className="flex items-center gap-2">
                                  {included ? (
                                    <Check className="h-3.5 w-3.5 flex-shrink-0 text-ok" aria-label="Включено" />
                                  ) : (
                                    <X className="h-3.5 w-3.5 flex-shrink-0 text-ink-4" aria-label="Не включено" />
                                  )}
                                  <span className={included ? 'text-ink-2' : 'text-ink-3'}>{feat.label}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="mt-4 flex items-center gap-2 border-t border-line px-5 py-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Pencil}
                        onClick={() => openEdit(plan)}
                        className="flex-1"
                      >
                        Редактировать
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={plan.isActive ? Archive : ArchiveRestore}
                        onClick={() => toggleActiveMutation.mutate({ id: plan.id, isActive: !plan.isActive })}
                        disabled={toggleActiveMutation.isPending}
                        title={
                          plan.isActive
                            ? 'Скрыть из выбора; подключённые автосервисы продолжат работать'
                            : 'Вернуть в выбор'
                        }
                      >
                        {plan.isActive ? 'В архив' : 'Активировать'}
                      </Button>
                      <IconButton
                        label={`Удалить тариф «${plan.name}» безвозвратно`}
                        icon={Trash2}
                        variant="danger"
                        size="sm"
                        onClick={() => setDeleteTarget(plan)}
                      />
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </QueryState>
      )}

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingPlan ? 'Редактировать тариф' : 'Новый тариф'}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={isSaving}>
              Отмена
            </Button>
            <Button type="submit" form={formId} loading={isSaving}>
              {editingPlan ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <Field label="Название" htmlFor={`${uid}-name`} required>
            <Input
              id={`${uid}-name`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Например: Бизнес"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Цена, ₽/мес" htmlFor={`${uid}-price`}>
              <Input
                id={`${uid}-price`}
                inputMode="decimal"
                className="tabular-nums"
                value={form.monthlyPrice}
                onChange={(e) => setForm({ ...form, monthlyPrice: digitsOnly(e.target.value) })}
                rightSlot={<span className="text-xs">₽</span>}
              />
            </Field>
            <Field label="Макс. сотрудников" htmlFor={`${uid}-max-users`}>
              <Input
                id={`${uid}-max-users`}
                inputMode="numeric"
                className="tabular-nums"
                value={form.maxUsers}
                onChange={(e) => setForm({ ...form, maxUsers: digitsOnly(e.target.value) })}
              />
            </Field>
          </div>

          <Field label="Описание" htmlFor={`${uid}-desc`}>
            <Input
              id={`${uid}-desc`}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Краткое описание тарифа"
            />
          </Field>

          {/* Feature checkboxes — grouped by section (core / section / integration) */}
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-2">Доступные функции</legend>
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-line-strong p-3">
              {FEATURE_GROUPS.map((grp) => (
                <div key={grp.group}>
                  <p className="mb-1 px-1 text-2xs font-semibold uppercase tracking-wide text-ink-3">{grp.label}</p>
                  <div className="space-y-0.5">
                    {grp.items.map((feat) => (
                      <Checkbox
                        key={feat.key}
                        label={feat.label}
                        checked={form.features.includes(feat.key)}
                        onChange={() => toggleFeature(feat.key)}
                        className="w-full rounded-md px-2 py-1 hover:bg-surface-2"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Минуты голоса / мес" htmlFor={`${uid}-voice`} hint="0 — только бесплатный лимит платформы">
              <Input
                id={`${uid}-voice`}
                inputMode="numeric"
                className="tabular-nums"
                value={form.voiceMinutes}
                onChange={(e) => setForm({ ...form, voiceMinutes: digitsOnly(e.target.value) })}
              />
            </Field>
            <Field label="Порядок сортировки" htmlFor={`${uid}-sort`}>
              <Input
                id={`${uid}-sort`}
                inputMode="numeric"
                className="tabular-nums"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: digitsOnly(e.target.value) })}
              />
            </Field>
          </div>
          <p className="text-xs text-ink-3">
            Пакет минут работает при включённой функции «Голосовой ввод (пакет минут)».
          </p>

          <div className="flex items-center gap-3 border-t border-line pt-4">
            <Switch
              id={`${uid}-active`}
              checked={form.isActive}
              onChange={(v) => setForm({ ...form, isActive: v })}
              label="Тариф активен"
            />
            <label htmlFor={`${uid}-active`} className="text-sm font-medium text-ink-2">
              {form.isActive ? 'Тариф активен — доступен для выбора' : 'В архиве — скрыт из выбора'}
            </label>
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
