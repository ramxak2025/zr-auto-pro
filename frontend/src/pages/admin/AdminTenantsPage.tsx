import { useId, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Building2, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import { tenantsApi, plansApi } from '../../api/services';
import { Tenant, Plan } from '../../types';
import { formatMoney } from '../../../../shared/utils/formatters';
import { formatPhone } from '../../../../shared/validation/phone';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import Pagination from '../../components/Pagination';
import SearchInput from '../../components/SearchInput';
import SubscriptionPeriodBadge from '../../components/SubscriptionPeriodBadge';
import { Button } from '../../ui/Button';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { Money } from '../../ui/Money';
import { RadioGroup } from '../../ui/RadioGroup';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { Textarea } from '../../ui/Textarea';
import { Toolbar } from '../../ui/Toolbar';
import { cn } from '../../ui/cn';
import { TenantStatusBadges, isTenantExpired } from '../../components/admin/adminUi';

/*
 * Список автосервисов: плотная таблица с поиском, фильтрами по статусу/тарифу
 * и клиентской пагинацией (getAll отдаёт весь список — режем на страницы на
 * клиенте). Редактор тенанта ЕДИНЫЙ и живёт только на странице «Подробнее»
 * (AdminTenantDetailPage) — здесь только просмотр, создание и удаление.
 * Поиск, фильтры и страница — в URL: F5 и «Назад» их сохраняют.
 */

interface TenantFormData {
  name: string;
  phone: string;
  address: string;
  email: string;
  description: string;
  planId: string;
  subscriptionEnd: string;
  subscriptionNote: string;
  directorName: string;
  directorPhone: string;
  directorPassword: string;
}

const emptyForm: TenantFormData = {
  name: '',
  phone: '',
  address: '',
  email: '',
  description: '',
  planId: '',
  subscriptionEnd: '',
  subscriptionNote: '',
  directorName: '',
  directorPhone: '',
  directorPassword: '',
};

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'active' | 'expired' | 'inactive';
const STATUS_KEYS: StatusFilter[] = ['all', 'active', 'expired', 'inactive'];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'expired', label: 'Истёкшие' },
  { value: 'inactive', label: 'Отключённые' },
];

const userCountOf = (t: Tenant) => t.userCount ?? t.users?.length ?? 0;

export default function AdminTenantsPage() {
  const queryClient = useQueryClient();
  const uid = useId();
  const formId = `${uid}-tenant-form`;

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TenantFormData>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Поиск / фильтры / страница — в URL
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const rawStatus = params.get('status');
  const statusFilter: StatusFilter = STATUS_KEYS.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : 'all';
  const planFilter = params.get('plan') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const patch = (changes: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === '' || (k === 'status' && v === 'all') || (k === 'page' && v === '1')) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  };

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.getAll(),
    select: (res) => res.data as Tenant[],
  });

  const { data: plansData } = useQuery({
    queryKey: ['plans'],
    queryFn: () => plansApi.getAll(),
    select: (res) => res.data as Plan[],
  });

  const tenants = useMemo(() => data ?? [], [data]);
  const activePlans = (plansData ?? []).filter((p) => p.isActive);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tenants.filter((t) => {
      if (q) {
        const hay = `${t.name} ${t.phone ?? ''} ${t.email ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter === 'active' && (!t.isActive || isTenantExpired(t))) return false;
      if (statusFilter === 'expired' && !isTenantExpired(t)) return false;
      if (statusFilter === 'inactive' && t.isActive) return false;
      if (planFilter && t.planId !== planFilter) return false;
      return true;
    });
  }, [tenants, search, statusFilter, planFilter]);

  // Клампим страницу вместо useEffect-сброса: смена фильтра сразу показывает 1-ю.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const isFiltered = filtered.length !== tenants.length;

  const createMutation = useMutation({
    mutationFn: (payload: any) => tenantsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Автосервис создан');
      closeModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка создания');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tenantsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Автосервис удалён');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка удаления');
    },
  });

  const openCreate = () => {
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setForm({ ...emptyForm });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Введите название автосервиса');
      return;
    }
    if (!form.directorPhone.trim()) {
      toast.error('Введите телефон директора');
      return;
    }
    if (!form.directorPassword.trim()) {
      toast.error('Введите пароль директора');
      return;
    }

    // Лимит сотрудников и цена задаются выбранным тарифом (без скрытого поля
    // maxUsers в форме — раньше оно молча перетиралось тарифом).
    const selectedPlan = activePlans.find((p) => p.id === form.planId);
    createMutation.mutate({
      name: form.name,
      phone: form.phone || undefined,
      address: form.address || undefined,
      email: form.email || undefined,
      description: form.description || undefined,
      planId: form.planId || null,
      maxUsers: selectedPlan ? selectedPlan.maxUsers : 5,
      monthlyPrice: selectedPlan ? selectedPlan.monthlyPrice : 0,
      isActive: true,
      subscriptionEnd: form.subscriptionEnd || null,
      subscriptionNote: form.subscriptionNote || null,
      directorName: form.directorName || undefined,
      directorPhone: form.directorPhone,
      directorPassword: form.directorPassword,
    });
  };

  const isSaving = createMutation.isPending;
  const deleteTarget = deleteId ? tenants.find((t) => t.id === deleteId) : undefined;

  const columns: DataTableColumn<Tenant>[] = [
    {
      key: 'name',
      header: 'Автосервис',
      primary: true,
      // max-w-0 + truncate: колонка забирает остаток ширины и режет длинное
      // название многоточием, а не выталкивает «Статус» за край экрана на 375 px.
      truncate: true,
      sortable: true,
      sortValue: (t) => t.name,
      render: (t) => (
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{t.name}</span>
            <span className="block truncate text-xs font-normal text-ink-3">
              {t.phone ? formatPhone(t.phone) : t.email || '—'}
            </span>
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Статус', render: (t) => <TenantStatusBadges tenant={t} /> },
    {
      key: 'plan',
      header: 'Тариф',
      hideBelow: 'md',
      sortable: true,
      sortValue: (t) => t.plan?.name ?? '',
      render: (t) =>
        t.plan?.name ? (
          <span className="block">
            <span className="block text-ink">{t.plan.name}</span>
            <span className="block text-xs tabular-nums text-ink-3">
              <Money value={t.monthlyPrice} />
              /мес
            </span>
          </span>
        ) : (
          <span className="text-ink-3">Не назначен</span>
        ),
    },
    {
      key: 'users',
      header: 'Сотрудники',
      numeric: true,
      hideBelow: 'lg',
      sortable: true,
      sortValue: (t) => userCountOf(t),
      render: (t) => (
        <span className="text-ink-2">
          {userCountOf(t)} <span className="text-ink-3">/ {t.maxUsers}</span>
        </span>
      ),
    },
    {
      key: 'subscription',
      header: 'Подписка',
      hideBelow: 'md',
      sortable: true,
      sortValue: (t) => t.subscriptionEnd ?? '',
      render: (t) => (
        <span className="flex flex-col items-start gap-1">
          {t.subscriptionEnd ? (
            <span className={cn('tabular-nums', isTenantExpired(t) ? 'font-medium text-bad-text' : 'text-ink-2')}>
              до {format(parseISO(t.subscriptionEnd), 'd MMM yyyy', { locale: ru })}
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          )}
          <SubscriptionPeriodBadge kind={t.currentPeriodKind} until={t.subscriptionEnd} size="sm" />
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      interactive: true,
      width: 48,
      render: (t) => (
        <IconButton
          label={`Удалить «${t.name}»`}
          icon={Trash2}
          variant="danger"
          size="sm"
          onClick={() => setDeleteId(t.id)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Автосервисы"
        icon={Building2}
        subtitle={`Всего: ${tenants.length}`}
        actions={
          <Button icon={Plus} onClick={openCreate}>
            Новый автосервис
          </Button>
        }
      />

      <Toolbar
        end={
          isFiltered ? (
            <span className="text-sm text-ink-3">
              Найдено: <span className="font-semibold tabular-nums text-ink">{filtered.length}</span>
            </span>
          ) : undefined
        }
      >
        <SearchInput
          value={search}
          onChange={(v) => patch({ q: v, page: null })}
          placeholder="Название, телефон, email…"
          aria-label="Поиск автосервисов"
          className="w-full sm:w-72"
        />
        <SegmentedControl<StatusFilter>
          aria-label="Статус"
          value={statusFilter}
          onChange={(v) => patch({ status: v, page: null })}
          options={STATUS_FILTERS}
        />
        {(plansData ?? []).length > 0 && (
          <Select
            aria-label="Тариф"
            value={planFilter}
            onChange={(e) => patch({ plan: e.target.value, page: null })}
            className="w-44"
          >
            <option value="">Все тарифы</option>
            {(plansData ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </Toolbar>

      <DataTable
        caption="Автосервисы платформы"
        rows={pageItems}
        rowKey={(t) => t.id}
        rowHref={(t) => `/admin/tenants/${t.id}`}
        rowLabel={(t) => `Открыть карточку «${t.name}»`}
        columns={columns}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить автосервисы"
        emptyState={
          tenants.length === 0
            ? {
                icon: Building2,
                title: 'Нет автосервисов',
                description: 'Создайте первый автосервис',
                action: { label: 'Создать', onClick: openCreate },
              }
            : {
                icon: Building2,
                title: 'Ничего не найдено',
                description: 'Измените поиск или фильтры.',
                action: {
                  label: 'Сбросить фильтры',
                  onClick: () => patch({ q: null, status: null, plan: null, page: null }),
                },
              }
        }
      />
      <Pagination
        page={currentPage}
        total={filtered.length}
        limit={PAGE_SIZE}
        onChange={(p) => patch({ page: String(p) })}
      />

      {/* Создание — редактирование существующего тенанта только в карточке */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title="Новый автосервис"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={isSaving}>
              Отмена
            </Button>
            <Button type="submit" form={formId} loading={isSaving}>
              Создать
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <Field label="Название" htmlFor={`${uid}-name`} required>
            <Input
              id={`${uid}-name`}
              name="organization"
              autoComplete="organization"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ООО «Автосервис»"
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Телефон автосервиса" htmlFor={`${uid}-phone`}>
              <Input
                id={`${uid}-phone`}
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+7 (XXX) XXX-XX-XX"
              />
            </Field>
            <Field label="Email" htmlFor={`${uid}-email`}>
              <Input
                id={`${uid}-email`}
                type="email"
                inputMode="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="info@example.com"
              />
            </Field>
          </div>

          <Field label="Адрес" htmlFor={`${uid}-address`}>
            <Input
              id={`${uid}-address`}
              autoComplete="street-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Город, улица, дом"
            />
          </Field>

          <Field label="Описание" htmlFor={`${uid}-desc`}>
            <Textarea
              id={`${uid}-desc`}
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Краткое описание"
            />
          </Field>

          {/* Директор — владелец нового автосервиса */}
          <fieldset className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Директор — владелец автосервиса</legend>
            <Field label="ФИО директора" htmlFor={`${uid}-dname`}>
              <Input
                id={`${uid}-dname`}
                autoComplete="off"
                value={form.directorName}
                onChange={(e) => setForm({ ...form, directorName: e.target.value })}
                placeholder="Иванов Иван Иванович"
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Телефон директора (логин)" htmlFor={`${uid}-dphone`} required>
                <Input
                  id={`${uid}-dphone`}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  value={form.directorPhone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setForm({ ...form, directorPhone: formatPhone(digits) });
                  }}
                  placeholder="+7 (XXX) XXX-XX-XX"
                  required
                />
              </Field>
              <Field label="Пароль директора" htmlFor={`${uid}-dpass`} required hint="Минимум 4 символа">
                <Input
                  id={`${uid}-dpass`}
                  type="text"
                  autoComplete="off"
                  value={form.directorPassword}
                  onChange={(e) => setForm({ ...form, directorPassword: e.target.value })}
                  required
                />
              </Field>
            </div>
          </fieldset>

          {/* Тариф — задаёт лимит сотрудников и цену */}
          {activePlans.length > 0 ? (
            <RadioGroup
              label="Тариф"
              value={form.planId}
              onChange={(v) => setForm({ ...form, planId: v })}
              options={[
                { value: '', label: 'Без тарифа', description: 'Лимит 5 сотрудников, 0 ₽/мес — назначить можно позже' },
                ...activePlans.map((plan) => ({
                  value: plan.id,
                  label: `${plan.name} — ${formatMoney(plan.monthlyPrice)}/мес`,
                  description: `До ${plan.maxUsers} сотрудников${plan.description ? ` · ${plan.description}` : ''}`,
                })),
              ]}
            />
          ) : (
            <p className="text-sm text-ink-3">Нет доступных тарифов. Создайте тариф в разделе «Тарифы».</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Подписка до" htmlFor={`${uid}-sub-end`}>
              <Input
                id={`${uid}-sub-end`}
                type="date"
                className="tabular-nums"
                value={form.subscriptionEnd}
                onChange={(e) => setForm({ ...form, subscriptionEnd: e.target.value })}
              />
            </Field>
            <Field label="Примечание к подписке" htmlFor={`${uid}-sub-note`}>
              <Input
                id={`${uid}-sub-note`}
                value={form.subscriptionNote}
                onChange={(e) => setForm({ ...form, subscriptionNote: e.target.value })}
                placeholder="Например: оплачено до марта"
              />
            </Field>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Удалить автосервис"
        message={`Автосервис «${deleteTarget?.name ?? ''}» и все его данные будут удалены безвозвратно. Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
