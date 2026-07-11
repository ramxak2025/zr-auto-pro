import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Pencil,
  Trash2,
  Building2,
  Loader2,
  UserPlus,
  ChevronDown,
  Phone,
  MapPin,
  Mail,
  Calendar,
  StickyNote,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import { tenantsApi, plansApi } from '../../api/services';
import { Tenant, Plan } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import QueryState from '../../components/QueryState';
import Switch from '../../components/Switch';
import SubscriptionPeriodBadge from '../../components/SubscriptionPeriodBadge';

interface TenantFormData {
  name: string;
  phone: string;
  address: string;
  email: string;
  description: string;
  planId: string;
  maxUsers: number;
  isActive: boolean;
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
  maxUsers: 5,
  isActive: true,
  subscriptionEnd: '',
  subscriptionNote: '',
  directorName: '',
  directorPhone: '',
  directorPassword: '',
};

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

export default function AdminTenantsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [form, setForm] = useState<TenantFormData>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
  const plans = (plansData ?? []).filter((p) => p.isActive);

  const createMutation = useMutation({
    mutationFn: (data: any) => tenantsApi.create(data),
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

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => tenantsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Автосервис обновлён');
      closeModal();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Ошибка обновления');
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
    setEditingTenant(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setForm({
      name: tenant.name,
      phone: tenant.phone || '',
      address: tenant.address || '',
      email: tenant.email || '',
      description: tenant.description || '',
      planId: tenant.planId || '',
      maxUsers: tenant.maxUsers,
      isActive: tenant.isActive,
      subscriptionEnd: tenant.subscriptionEnd ? tenant.subscriptionEnd.slice(0, 10) : '',
      subscriptionNote: tenant.subscriptionNote || '',
      directorName: '',
      directorPhone: '',
      directorPassword: '',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingTenant(null);
    setForm({ ...emptyForm });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Введите название автосервиса');
      return;
    }

    const isCreating = !editingTenant;

    if (isCreating && !form.directorPhone.trim()) {
      toast.error('Введите телефон директора');
      return;
    }
    if (isCreating && !form.directorPassword.trim()) {
      toast.error('Введите пароль директора');
      return;
    }

    const selectedPlan = plans.find((p) => p.id === form.planId);
    const payload: any = {
      name: form.name,
      phone: form.phone || undefined,
      address: form.address || undefined,
      email: form.email || undefined,
      description: form.description || undefined,
      planId: form.planId || null,
      maxUsers: selectedPlan ? selectedPlan.maxUsers : Number(form.maxUsers),
      monthlyPrice: selectedPlan ? selectedPlan.monthlyPrice : 0,
      isActive: form.isActive,
      subscriptionEnd: form.subscriptionEnd || null,
      subscriptionNote: form.subscriptionNote || null,
    };

    if (isCreating) {
      payload.directorName = form.directorName || undefined;
      payload.directorPhone = form.directorPhone;
      payload.directorPassword = form.directorPassword;
    }

    if (editingTenant) {
      updateMutation.mutate({ id: editingTenant.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Автосервисы</h1>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" />
          Новый автосервис
        </button>
      </div>

      {/* Accordion Cards */}
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
        <div className="space-y-3">
          {tenants.map((tenant) => {
            const isExpanded = expandedId === tenant.id;
            const userCount = tenant.userCount ?? tenant.users?.length ?? 0;

            return (
              <div key={tenant.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                {/* Collapsed header - always visible */}
                <button
                  type="button"
                  onClick={() => toggleExpand(tenant.id)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 w-9 h-9 bg-primary-50 rounded-lg flex items-center justify-center">
                      <Building2 className="w-4.5 h-4.5 text-primary-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{tenant.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {tenant.isActive ? (
                          <span className="badge-green text-xs">Активна</span>
                        ) : (
                          <span className="badge-red text-xs">Неактивна</span>
                        )}
                        {tenant.plan?.name && (
                          <span className="text-xs text-primary-600 font-medium">{tenant.plan.name}</span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-gray-500 tabular-nums">
                          <Users className="w-3 h-3" />
                          {userCount} / {tenant.maxUsers}
                        </span>
                        <SubscriptionPeriodBadge
                          kind={tenant.currentPeriodKind}
                          until={tenant.subscriptionEnd}
                          size="sm"
                        />
                      </div>
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-2.5 bg-gray-50/50">
                    {/* Phone */}
                    <div className="flex items-start gap-2.5 text-sm">
                      <Phone className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-gray-500 text-xs">Телефон</div>
                        <div className="text-gray-800">{tenant.phone || '—'}</div>
                      </div>
                    </div>

                    {/* Address */}
                    <div className="flex items-start gap-2.5 text-sm">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-gray-500 text-xs">Адрес</div>
                        <div className="text-gray-800">{tenant.address || '—'}</div>
                      </div>
                    </div>

                    {/* Email */}
                    <div className="flex items-start gap-2.5 text-sm">
                      <Mail className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-gray-500 text-xs">Email</div>
                        <div className="text-gray-800">{tenant.email || '—'}</div>
                      </div>
                    </div>

                    {/* Subscription End */}
                    <div className="flex items-start gap-2.5 text-sm">
                      <Calendar className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-gray-500 text-xs">Подписка до</div>
                        <div className="text-gray-800">
                          {tenant.subscriptionEnd
                            ? format(parseISO(tenant.subscriptionEnd), 'd MMM yyyy', { locale: ru })
                            : '—'}
                        </div>
                      </div>
                    </div>

                    {/* Subscription Note */}
                    {tenant.subscriptionNote && (
                      <div className="flex items-start gap-2.5 text-sm">
                        <StickyNote className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-gray-500 text-xs">Примечание</div>
                          <div className="text-gray-800">{tenant.subscriptionNote}</div>
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-2.5 border-t border-gray-200">
                      <button
                        onClick={() => navigate(`/admin/tenants/${tenant.id}`)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                      >
                        <Building2 className="w-4 h-4" />
                        Подробнее
                      </button>
                      <button
                        onClick={() => openEdit(tenant)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Редактировать"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteId(tenant.id)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 bg-white border border-gray-200 hover:bg-red-50 hover:border-red-200 rounded-lg transition-colors"
                        title="Удалить"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </QueryState>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingTenant ? 'Редактировать автосервис' : 'Новый автосервис'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
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

          {/* Phone */}
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

          {/* Address */}
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

          {/* Email */}
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

          {/* Description */}
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

          {/* Director section — only for new tenants */}
          {!editingTenant && (
            <div className="bg-primary-50 rounded-xl p-4 space-y-3 border border-primary-100">
              <div className="flex items-center gap-2 text-primary-700 font-medium text-sm">
                <UserPlus className="w-4 h-4" />
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
          )}

          {/* Tariff / Plan selection */}
          <div>
            <label className="label">Тариф</label>
            {plans.length > 0 ? (
              <div className="space-y-2">
                {plans.map((plan) => {
                  const isSelected = form.planId === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setForm({ ...form, planId: plan.id, maxUsers: plan.maxUsers })}
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
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Нет доступных тарифов. Создайте тариф в разделе &laquo;Тарифы&raquo;.
              </p>
            )}
          </div>

          {/* Active Toggle */}
          <div className="flex items-center gap-3">
            <Switch checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="Активна" />
            <span className="text-sm font-medium text-gray-700">{form.isActive ? 'Активна' : 'Неактивна'}</span>
          </div>

          {/* Subscription End */}
          <div>
            <label className="label">Подписка до</label>
            <input
              type="date"
              className="input"
              value={form.subscriptionEnd}
              onChange={(e) => setForm({ ...form, subscriptionEnd: e.target.value })}
            />
          </div>

          {/* Subscription Note */}
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

          {/* Actions */}
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
              ) : editingTenant ? (
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
        title="Удалить автосервис"
        message="Вы уверены, что хотите удалить этот автосервис? Все данные будут потеряны. Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
