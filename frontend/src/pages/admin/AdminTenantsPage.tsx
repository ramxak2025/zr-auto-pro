import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Building2, Loader2, UserPlus, Users, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO, isPast } from 'date-fns';
import { ru } from 'date-fns/locale';

import { tenantsApi, plansApi } from '../../api/services';
import { Tenant, Plan } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import QueryState from '../../components/QueryState';
import SubscriptionPeriodBadge from '../../components/SubscriptionPeriodBadge';
import { AdminPageHeader, Chip } from '../../components/admin/adminUi';

/*
 * Список автосервисов: плотная таблица с поиском, фильтрами по статусу/тарифу
 * и клиентской пагинацией (getAll отдаёт весь список — режем на страницы на
 * клиенте). Редактор тенанта ЕДИНЫЙ и живёт только на странице «Подробнее»
 * (AdminTenantDetailPage) — здесь только просмотр, создание и удаление.
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

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'expired', label: 'Истёкшие' },
  { key: 'inactive', label: 'Отключённые' },
];

function formatPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 0 && digits[0] === '8') {
    digits = '7' + digits.slice(1);
  }
  if (digits.length === 0) return '';
  if (digits.length <= 1) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 1)} (${digits.slice(1)}`;
  if (digits.length <= 7) return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
  if (digits.length <= 9)
    return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

function isTenantExpired(t: Tenant): boolean {
  return !!t.subscriptionEnd && isPast(parseISO(t.subscriptionEnd));
}

export default function AdminTenantsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TenantFormData>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Поиск / фильтры / страница
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [planFilter, setPlanFilter] = useState('');
  const [page, setPage] = useState(1);

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

  const tenants = data ?? [];
  const activePlans = (plansData ?? []).filter((p) => p.isActive);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((t) => {
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
  }, [data, search, statusFilter, planFilter]);

  // Клампим страницу вместо useEffect-сброса: смена фильтра сразу показывает 1-ю.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const applyFilter =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

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

  const renderStatus = (tenant: Tenant) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {tenant.isActive ? <span className="badge-green">Активна</span> : <span className="badge-red">Отключена</span>}
      {isTenantExpired(tenant) && tenant.isActive && <span className="badge-yellow">Истекла</span>}
    </div>
  );

  return (
    <div>
      <AdminPageHeader
        title="Автосервисы"
        subtitle={`Всего: ${tenants.length}`}
        actions={
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" />
            Новый автосервис
          </button>
        }
      />

      {/* Toolbar: поиск + фильтры */}
      <div className="mb-4 space-y-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            className="input pl-9"
            value={search}
            onChange={(e) => applyFilter<string>(setSearch)(e.target.value)}
            placeholder="Поиск: название, телефон, email"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f.key}
              active={statusFilter === f.key}
              onClick={() => applyFilter<StatusFilter>(setStatusFilter)(f.key)}
            >
              {f.label}
            </Chip>
          ))}
          {(plansData ?? []).length > 0 && (
            <select
              className="input w-auto py-1.5 text-sm"
              value={planFilter}
              onChange={(e) => applyFilter<string>(setPlanFilter)(e.target.value)}
              aria-label="Фильтр по тарифу"
            >
              <option value="">Все тарифы</option>
              {(plansData ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {filtered.length !== tenants.length && (
            <span className="text-sm text-gray-500">
              Найдено: <span className="font-semibold tabular-nums">{filtered.length}</span>
            </span>
          )}
        </div>
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить автосервисы"
        isEmpty={tenants.length === 0}
        empty={{
          icon: Building2,
          title: 'Нет автосервисов',
          description: 'Создайте первый автосервис',
          action: { label: 'Создать', onClick: openCreate },
        }}
        minHeight="min-h-[40vh]"
      >
        {filtered.length === 0 ? (
          <div className="card flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Search className="h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">Ничего не найдено — измените поиск или фильтры.</p>
          </div>
        ) : (
          <>
            {/* Desktop: плотная таблица */}
            <div className="table-container hidden md:block">
              <table className="table">
                <thead>
                  <tr>
                    <th>Автосервис</th>
                    <th>Статус</th>
                    <th>Тариф</th>
                    <th>Сотрудники</th>
                    <th>Подписка</th>
                    <th className="w-24 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((tenant) => {
                    const userCount = tenant.userCount ?? tenant.users?.length ?? 0;
                    return (
                      <tr
                        key={tenant.id}
                        onClick={() => navigate(`/admin/tenants/${tenant.id}`)}
                        className="cursor-pointer"
                      >
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50">
                              <Building2 className="h-4 w-4 text-primary-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900">{tenant.name}</p>
                              <p className="truncate text-xs text-gray-500">{tenant.phone || tenant.email || '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td>{renderStatus(tenant)}</td>
                        <td>
                          {tenant.plan?.name ? (
                            <div>
                              <p className="text-gray-900">{tenant.plan.name}</p>
                              <p className="text-xs tabular-nums text-gray-500">
                                {tenant.monthlyPrice.toLocaleString('ru-RU')} ₽/мес
                              </p>
                            </div>
                          ) : (
                            <span className="text-gray-400">Не назначен</span>
                          )}
                        </td>
                        <td>
                          <span className="inline-flex items-center gap-1.5 tabular-nums text-gray-700">
                            <Users className="h-3.5 w-3.5 text-gray-400" />
                            {userCount} / {tenant.maxUsers}
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-col gap-1">
                            {tenant.subscriptionEnd ? (
                              <span
                                className={`tabular-nums ${
                                  isTenantExpired(tenant) ? 'font-medium text-red-600' : 'text-gray-700'
                                }`}
                              >
                                до {format(parseISO(tenant.subscriptionEnd), 'd MMM yyyy', { locale: ru })}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                            <SubscriptionPeriodBadge
                              kind={tenant.currentPeriodKind}
                              until={tenant.subscriptionEnd}
                              size="sm"
                            />
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => navigate(`/admin/tenants/${tenant.id}`)}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary-600"
                              title="Подробнее"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeleteId(tenant.id)}
                              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              title="Удалить"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: карточки */}
            <div className="space-y-2.5 md:hidden">
              {pageItems.map((tenant) => {
                const userCount = tenant.userCount ?? tenant.users?.length ?? 0;
                return (
                  <button
                    key={tenant.id}
                    type="button"
                    onClick={() => navigate(`/admin/tenants/${tenant.id}`)}
                    className="card w-full p-4 text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50">
                          <Building2 className="h-4 w-4 text-primary-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-gray-900">{tenant.name}</p>
                          <p className="truncate text-xs text-gray-500">
                            {tenant.plan?.name || 'Тариф не назначен'} ·{' '}
                            <span className="tabular-nums">
                              {userCount}/{tenant.maxUsers}
                            </span>{' '}
                            польз.
                          </p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 flex-shrink-0 text-gray-400" />
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {renderStatus(tenant)}
                      <SubscriptionPeriodBadge
                        kind={tenant.currentPeriodKind}
                        until={tenant.subscriptionEnd}
                        size="sm"
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Пагинация */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500">
                  Стр. <span className="tabular-nums">{currentPage}</span> из{' '}
                  <span className="tabular-nums">{totalPages}</span> ·{' '}
                  <span className="tabular-nums">{filtered.length}</span> автосервисов
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="btn-secondary btn-sm"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Назад
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="btn-secondary btn-sm"
                  >
                    Вперёд
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </QueryState>

      {/* Create Modal — редактирование существующего тенанта только в «Подробнее» */}
      <Modal isOpen={modalOpen} onClose={closeModal} title="Новый автосервис" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Название</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ООО Автосервис"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Телефон автосервиса</label>
              <input
                type="tel"
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+7 (XXX) XXX-XX-XX"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="info@example.com"
              />
            </div>
          </div>

          <div>
            <label className="label">Адрес</label>
            <input
              type="text"
              className="input"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Город, улица, дом"
            />
          </div>

          <div>
            <label className="label">Описание</label>
            <textarea
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Краткое описание"
            />
          </div>

          {/* Директор — владелец нового автосервиса */}
          <div className="space-y-3 rounded-xl border border-primary-100 bg-primary-50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-primary-700">
              <UserPlus className="h-4 w-4" />
              Директор (владелец автосервиса)
            </div>

            <div>
              <label className="label">ФИО директора</label>
              <input
                type="text"
                className="input"
                value={form.directorName}
                onChange={(e) => setForm({ ...form, directorName: e.target.value })}
                placeholder="Иванов Иван Иванович"
              />
            </div>

            <div>
              <label className="label">Телефон директора (для входа) *</label>
              <input
                type="tel"
                inputMode="numeric"
                className="input"
                value={form.directorPhone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  setForm({ ...form, directorPhone: formatPhone(digits) });
                }}
                placeholder="+7 (XXX) XXX-XX-XX"
                required
              />
            </div>

            <div>
              <label className="label">Пароль директора *</label>
              <input
                type="text"
                className="input"
                value={form.directorPassword}
                onChange={(e) => setForm({ ...form, directorPassword: e.target.value })}
                placeholder="Минимум 4 символа"
                required
              />
            </div>
          </div>

          {/* Тариф — задаёт лимит сотрудников и цену */}
          <div>
            <label className="label">Тариф</label>
            {activePlans.length > 0 ? (
              <div className="space-y-2">
                {activePlans.map((plan) => {
                  const isSelected = form.planId === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setForm({ ...form, planId: isSelected ? '' : plan.id })}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border-2 text-left transition-all ${
                        isSelected
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div>
                        <p className={`text-sm font-semibold ${isSelected ? 'text-primary-700' : 'text-gray-900'}`}>
                          {plan.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          До {plan.maxUsers} сотрудников
                          {plan.description && ` · ${plan.description}`}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-bold tabular-nums ${isSelected ? 'text-primary-600' : 'text-gray-700'}`}
                      >
                        {plan.monthlyPrice.toLocaleString('ru-RU')} ₽/мес
                      </span>
                    </button>
                  );
                })}
                <p className="text-xs text-gray-500">Лимит сотрудников и стоимость берутся из выбранного тарифа.</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Нет доступных тарифов. Создайте тариф в разделе &laquo;Тарифы&raquo;.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Подписка до</label>
              <input
                type="date"
                className="input"
                value={form.subscriptionEnd}
                onChange={(e) => setForm({ ...form, subscriptionEnd: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Примечание к подписке</label>
              <input
                type="text"
                className="input"
                value={form.subscriptionNote}
                onChange={(e) => setForm({ ...form, subscriptionNote: e.target.value })}
                placeholder="Например: Оплачено до марта"
              />
            </div>
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
        title="Удалить автосервис"
        message="Вы уверены, что хотите удалить этот автосервис? Все данные будут потеряны. Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
