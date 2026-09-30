import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

import { managerApi, plansApi } from '../../api/services';
import type { CreateManagerTenantRequest } from '../../api/services';
import type { Plan, SubscriptionStatus, Tenant } from '../../types';
import { formatMoney } from '../../../../shared/utils/formatters';
import { isCompletePhone, normalizePhone } from '../../../../shared/validation/phone';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import SearchInput from '../../components/SearchInput';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { RadioGroup } from '../../ui/RadioGroup';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Skeleton } from '../../ui/Skeleton';
import { Textarea } from '../../ui/Textarea';
import { Toolbar } from '../../ui/Toolbar';
import { ErrorRow, ToggleChip } from '../../components/admin/adminUi';
import TenantsTable from '../../components/admin/TenantsTable';
import { apiErrorCode, apiErrorMessage } from '../../components/admin/apiError';
import { managerKeys } from '../../components/admin/managerQueryKeys';
import { maskPhoneInput } from '../../components/admin/phoneInput';
import { useManagerSummary } from '../../components/admin/useManagerSummary';

/*
 * «Мои автосервисы» (кабинет менеджера): только клиенты этого менеджера, поиск и фильтр по состоянию
 * подписки в URL, создание автосервиса с владельцем-директором и пробным доступом.
 * Карточка автосервиса — ManagerTenantDetailPage.
 */

type StatusFilter = 'all' | SubscriptionStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'expired', label: 'Истёкшие' },
  { value: 'suspended', label: 'Приостановленные' },
];
const STATUS_KEYS = STATUS_FILTERS.map((f) => f.value);

const MIN_PASSWORD = 6;
const DEFAULT_TRIAL_DAYS = 14;
const TRIAL_PRESETS = [7, 14, 30];

interface CreateForm {
  name: string;
  phone: string;
  address: string;
  planId: string;
  directorName: string;
  directorPhone: string;
  directorPassword: string;
  trialDays: string;
  note: string;
}

// Пока лимит менеджера не загрузился, ставим обычный пробный на 14 дней: сервер всё равно проверит максимум.
const emptyForm = (maxDays?: number): CreateForm => ({
  name: '',
  phone: '',
  address: '',
  planId: '',
  directorName: '',
  directorPhone: '',
  directorPassword: '',
  trialDays: String(maxDays ? Math.min(DEFAULT_TRIAL_DAYS, maxDays) : DEFAULT_TRIAL_DAYS),
  note: '',
});

export default function ManagerTenantsPage() {
  const uid = useId();
  const formId = `${uid}-manager-tenant-form`;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Поиск, фильтр и открытое окно создания — в URL: F5 и «Назад» их сохраняют, обзор открывает окно ссылкой.
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const rawStatus = params.get('status');
  const statusFilter: StatusFilter = STATUS_KEYS.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : 'all';
  const createOpen = params.get('new') === '1';

  const patch = (changes: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === '' || (k === 'status' && v === 'all')) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  };

  const { data: summary } = useManagerSummary();
  const maxDays = summary?.maxFreeDays;

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: managerKeys.tenants(statusFilter),
    queryFn: () => managerApi.tenants(statusFilter === 'all' ? undefined : { status: statusFilter }),
    select: (res) => res.data,
  });
  const tenants = useMemo<Tenant[]>(() => data ?? [], [data]);

  // Тарифы нужны только форме создания — грузим, когда её открыли (ключ общий с кабинетом суперадмина).
  const {
    data: plans,
    isLoading: plansLoading,
    isError: plansError,
    isFetching: plansFetching,
    refetch: refetchPlans,
  } = useQuery({
    queryKey: ['plans'],
    queryFn: () => plansApi.getAll(),
    select: (res) => (res.data as Plan[]).filter((p) => p.isActive),
    enabled: createOpen,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tenants;
    const qDigits = q.replace(/\D/g, '');
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (t.phone ?? '').replace(/\D/g, '').includes(qDigits)),
    );
  }, [tenants, search]);
  const isFiltered = search.trim() !== '' || statusFilter !== 'all';

  const [form, setForm] = useState<CreateForm>(() => emptyForm());
  const [showErrors, setShowErrors] = useState(false);
  // Ответ 409 PHONE_TAKEN: показываем у поля телефона владельца, пока его не поправят.
  const [phoneTaken, setPhoneTaken] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  // Modal монтирует содержимое только пока открыт, а состояние нужно футеру — сбрасываем при открытии.
  if (createOpen !== wasOpen) {
    setWasOpen(createOpen);
    if (createOpen) {
      setForm(emptyForm(maxDays));
      setShowErrors(false);
      setPhoneTaken(null);
    }
  }

  const trialNum = Number(form.trialDays);
  const errors = {
    name: form.name.trim() ? undefined : 'Введите название автосервиса.',
    phone:
      form.phone === '' || isCompletePhone(form.phone) ? undefined : 'Введите телефон полностью или очистите поле.',
    planId: form.planId ? undefined : 'Выберите тариф.',
    directorName: form.directorName.trim() ? undefined : 'Введите имя владельца.',
    directorPhone: isCompletePhone(form.directorPhone) ? undefined : 'Введите телефон полностью — это логин владельца.',
    directorPassword:
      form.directorPassword.length >= MIN_PASSWORD ? undefined : `Пароль — не короче ${MIN_PASSWORD} символов.`,
    trialDays:
      Number.isInteger(trialNum) && trialNum >= 1 && (!maxDays || trialNum <= maxDays)
        ? undefined
        : maxDays
          ? `Введите целое число дней от 1 до ${maxDays}.`
          : 'Введите целое число дней, не меньше 1.',
  };
  const formValid = !Object.values(errors).some(Boolean);
  // Пустое поле подсвечиваем только после попытки отправки, введённое неверно — сразу.
  const shown = (message: string | undefined, value: string) => (showErrors || value ? message : undefined);
  const directorPhoneError = phoneTaken ?? shown(errors.directorPhone, form.directorPhone);

  const createMutation = useMutation({
    mutationFn: (payload: CreateManagerTenantRequest) => managerApi.createTenant(payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: managerKeys.tenantsAll });
      queryClient.invalidateQueries({ queryKey: managerKeys.summary });
      toast.success(`Автосервис «${res.data.name}» создан`);
      navigate(`/manager/tenants/${res.data.id}`);
    },
    onError: (err) => {
      if (apiErrorCode(err) === 'PHONE_TAKEN') {
        setPhoneTaken(apiErrorMessage(err, 'Этот телефон уже занят другим пользователем платформы.'));
        return;
      }
      toast.error(apiErrorMessage(err, 'Не удалось создать автосервис'));
    },
  });
  const isSaving = createMutation.isPending;

  const openCreate = () => patch({ new: '1' });
  const closeCreate = () => patch({ new: null });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (!formValid) return;
    const payload: CreateManagerTenantRequest = {
      name: form.name.trim(),
      planId: form.planId,
      director: {
        name: form.directorName.trim(),
        phone: normalizePhone(form.directorPhone),
        password: form.directorPassword,
      },
      trialDays: trialNum,
    };
    if (form.phone) payload.phone = normalizePhone(form.phone);
    if (form.address.trim()) payload.address = form.address.trim();
    if (form.note.trim()) payload.note = form.note.trim();
    createMutation.mutate(payload);
  };

  const trialPresets = TRIAL_PRESETS.filter((d) => !maxDays || d <= maxDays);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Мои автосервисы"
        icon={Building2}
        subtitle={summary ? `Всего: ${summary.tenants.total}` : undefined}
        actions={
          <Button icon={Plus} onClick={openCreate}>
            Новый автосервис
          </Button>
        }
      />

      <Toolbar
        end={
          isFiltered && !isLoading && !isError ? (
            <span className="text-sm text-ink-3">
              Найдено: <span className="font-semibold tabular-nums text-ink">{filtered.length}</span>
            </span>
          ) : undefined
        }
      >
        <SearchInput
          value={search}
          onChange={(v) => patch({ q: v })}
          placeholder="Название или телефон…"
          aria-label="Поиск автосервисов"
          className="w-full sm:w-72"
        />
        <SegmentedControl<StatusFilter>
          aria-label="Состояние подписки"
          value={statusFilter}
          onChange={(v) => patch({ status: v })}
          options={STATUS_FILTERS}
        />
      </Toolbar>

      <TenantsTable
        rows={filtered}
        rowHref={(t) => `/manager/tenants/${t.id}`}
        caption="Мои автосервисы"
        isLoading={isLoading}
        isError={isError}
        isFetching={isFetching}
        onRetry={() => refetch()}
        errorTitle="Не удалось загрузить автосервисы"
        emptyState={
          isFiltered
            ? {
                icon: Building2,
                title: 'Ничего не найдено',
                description: 'Измените поиск или фильтр.',
                action: { label: 'Сбросить', onClick: () => patch({ q: null, status: null }) },
              }
            : {
                icon: Building2,
                title: 'Автосервисов пока нет',
                description: 'Заведите первого клиента: пробный доступ откроется сразу после создания.',
                action: { label: 'Создать', onClick: openCreate },
              }
        }
      />

      <Modal
        isOpen={createOpen}
        onClose={closeCreate}
        title="Новый автосервис"
        description="Клиент закрепится за вами. Владелец получит вход по телефону и паролю ниже."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeCreate} disabled={isSaving}>
              Отмена
            </Button>
            <Button type="submit" form={formId} loading={isSaving}>
              Создать
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field label="Название" htmlFor={`${uid}-name`} required error={shown(errors.name, form.name)}>
            <Input
              id={`${uid}-name`}
              autoComplete="off"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Автосервис «Мотор»"
              invalid={!!shown(errors.name, form.name)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Телефон автосервиса" htmlFor={`${uid}-phone`} error={shown(errors.phone, form.phone)}>
              <Input
                id={`${uid}-phone`}
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                className="tabular-nums"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: maskPhoneInput(e.target.value) })}
                placeholder="+7 (XXX) XXX-XX-XX"
                invalid={!!shown(errors.phone, form.phone)}
              />
            </Field>
            <Field label="Адрес" htmlFor={`${uid}-address`}>
              <Input
                id={`${uid}-address`}
                autoComplete="off"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Город, улица, дом"
              />
            </Field>
          </div>

          {/* Владелец — первая учётная запись роли «директор» */}
          <fieldset className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Владелец автосервиса</legend>
            <Field
              label="Имя владельца"
              htmlFor={`${uid}-dname`}
              required
              error={shown(errors.directorName, form.directorName)}
            >
              <Input
                id={`${uid}-dname`}
                autoComplete="off"
                value={form.directorName}
                onChange={(e) => setForm({ ...form, directorName: e.target.value })}
                placeholder="Иванов Иван Иванович"
                invalid={!!shown(errors.directorName, form.directorName)}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Телефон владельца (логин)" htmlFor={`${uid}-dphone`} required error={directorPhoneError}>
                <Input
                  id={`${uid}-dphone`}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  className="tabular-nums"
                  value={form.directorPhone}
                  onChange={(e) => {
                    setPhoneTaken(null);
                    setForm({ ...form, directorPhone: maskPhoneInput(e.target.value) });
                  }}
                  placeholder="+7 (XXX) XXX-XX-XX"
                  invalid={!!directorPhoneError}
                />
              </Field>
              <Field
                label="Пароль владельца"
                htmlFor={`${uid}-dpass`}
                required
                hint={`Минимум ${MIN_PASSWORD} символов. Передайте его владельцу.`}
                error={shown(errors.directorPassword, form.directorPassword)}
              >
                <Input
                  id={`${uid}-dpass`}
                  type="text"
                  autoComplete="off"
                  value={form.directorPassword}
                  onChange={(e) => setForm({ ...form, directorPassword: e.target.value })}
                  invalid={!!shown(errors.directorPassword, form.directorPassword)}
                />
              </Field>
            </div>
          </fieldset>

          {/* Тариф задаёт лимит сотрудников и цену продления */}
          {plansLoading ? (
            <Skeleton className="h-28 w-full rounded-lg" />
          ) : plansError && !plans ? (
            <ErrorRow message="Не удалось загрузить тарифы" onRetry={() => refetchPlans()} loading={plansFetching} />
          ) : (plans ?? []).length === 0 ? (
            <p className="text-sm text-ink-3">Нет доступных тарифов — обратитесь к владельцу платформы.</p>
          ) : (
            <div>
              <RadioGroup
                label="Тариф"
                value={form.planId || null}
                onChange={(v) => setForm({ ...form, planId: v })}
                options={(plans ?? []).map((plan) => ({
                  value: plan.id,
                  label: `${plan.name} — ${formatMoney(plan.monthlyPrice)}/мес`,
                  description: `До ${plan.maxUsers} сотрудников${plan.description ? ` · ${plan.description}` : ''}`,
                }))}
              />
              {showErrors && errors.planId && (
                <p className="mt-1.5 text-xs text-bad-text" role="alert">
                  {errors.planId}
                </p>
              )}
            </div>
          )}

          <Field
            label="Пробный доступ, дней"
            htmlFor={`${uid}-trial`}
            required
            hint={
              maxDays
                ? `Не больше ${maxDays} дн. Дальше подписку продлевают платным продлением в карточке автосервиса.`
                : 'Дальше подписку продлевают платным продлением в карточке автосервиса.'
            }
            error={shown(errors.trialDays, form.trialDays)}
          >
            <div className="space-y-2">
              <Input
                id={`${uid}-trial`}
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                className="w-28 tabular-nums"
                value={form.trialDays}
                onChange={(e) => setForm({ ...form, trialDays: e.target.value.replace(/\D/g, '') })}
                invalid={!!shown(errors.trialDays, form.trialDays)}
              />
              {trialPresets.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Быстрый выбор срока">
                  {trialPresets.map((d) => (
                    <ToggleChip
                      key={d}
                      active={form.trialDays === String(d)}
                      onClick={() => setForm({ ...form, trialDays: String(d) })}
                    >
                      {d} дн.
                    </ToggleChip>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <Field label="Заметка" htmlFor={`${uid}-note`} hint="Сохранится в примечании к подписке автосервиса.">
            <Textarea
              id={`${uid}-note`}
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Например: договорились о встрече в пятницу"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
