import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  MapPin,
  Users,
  Calendar,
  Power,
  Pencil,
  Trash2,
  Hash,
  CalendarClock,
  Key,
  UserCircle,
  Copy,
  Check as CheckIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getApiError } from '../../api/axios';
import { adminApi } from '../../api/services';
import type { Tenant, User } from '../../types';
import Modal from '../../components/Modal';
import ConfirmDialog from '../../components/ConfirmDialog';
import LoadingSpinner from '../../components/LoadingSpinner';
import PhoneInput, { isPhoneComplete, getPhoneRaw } from '../../components/PhoneInput';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Директор',
  admin: 'Администратор',
  master: 'Мастер',
  storekeeper: 'Товаровед',
  accountant: 'Бухгалтер',
};

const roleBadgeColors: Record<string, string> = {
  superadmin: 'bg-red-50 text-red-700',
  director: 'bg-purple-50 text-purple-700',
  admin: 'bg-blue-50 text-blue-700',
  master: 'bg-green-50 text-green-700',
  storekeeper: 'bg-yellow-50 text-yellow-700',
  accountant: 'bg-gray-100 text-gray-600',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSubscriptionInfo(tenant: Tenant): {
  label: string;
  color: string;
  isExpired: boolean;
  daysLeft: number | null;
} {
  if (!tenant.subscriptionEnd) {
    return { label: 'Бессрочная', color: 'text-blue-700', isExpired: false, daysLeft: null };
  }
  const end = new Date(tenant.subscriptionEnd);
  const now = new Date();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    return { label: 'Истекла', color: 'text-red-700', isExpired: true, daysLeft };
  }
  if (daysLeft <= 7) {
    return { label: `Осталось ${daysLeft} дн.`, color: 'text-orange-700', isExpired: false, daysLeft };
  }
  return { label: `до ${formatDate(tenant.subscriptionEnd)}`, color: 'text-green-700', isExpired: false, daysLeft };
}

// ---------------------------------------------------------------------------
// Info row component
// ---------------------------------------------------------------------------

function InfoRow({
  icon: Icon,
  label,
  value,
  valueClass,
}: {
  icon: typeof Phone;
  label: string;
  value: string | number | undefined;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-400 flex-shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-gray-400">{label}</p>
        <p className={`text-sm font-medium ${valueClass || 'text-gray-900'}`}>{value || '--'}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy button helper
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
      title="Копировать"
    >
      {copied ? <CheckIcon className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Edit Tenant Modal
// ---------------------------------------------------------------------------

interface EditTenantForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  description: string;
  maxUsers: number;
}

function EditTenantModal({
  isOpen,
  onClose,
  tenant,
}: {
  isOpen: boolean;
  onClose: () => void;
  tenant: Tenant;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EditTenantForm>({
    name: tenant.name,
    phone: tenant.phone || '',
    email: tenant.email || '',
    address: tenant.address || '',
    description: tenant.description || '',
    maxUsers: tenant.maxUsers,
  });

  const updateMutation = useMutation({
    mutationFn: (data: EditTenantForm) => adminApi.updateTenant(tenant.id, data),
    onSuccess: () => {
      toast.success('Сохранено');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenant', tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      onClose();
    },
    onError: (err) => toast.error(getApiError(err, 'Не удалось сохранить')),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Название обязательно'); return; }
    if (form.phone.trim() && !isPhoneComplete(form.phone)) { toast.error('Введите телефон полностью'); return; }
    updateMutation.mutate({
      ...form,
      phone: form.phone.trim() ? getPhoneRaw(form.phone) : '',
    });
  }

  function handleChange(field: keyof EditTenantForm, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const inputClass =
    'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Редактировать" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Название *</label>
            <input type="text" value={form.name} onChange={(e) => handleChange('name', e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Телефон</label>
            <PhoneInput
              value={form.phone}
              onChange={(v) => handleChange('phone', v)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={form.email} onChange={(e) => handleChange('email', e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Адрес</label>
            <input type="text" value={form.address} onChange={(e) => handleChange('address', e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
            <textarea value={form.description} onChange={(e) => handleChange('description', e.target.value)} rows={3} className={inputClass + ' resize-none'} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Макс. пользователей</label>
            <input type="number" min={1} max={100} value={form.maxUsers} onChange={(e) => handleChange('maxUsers', parseInt(e.target.value, 10) || 1)} className={inputClass} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Отмена</button>
          <button type="submit" disabled={updateMutation.isPending} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {updateMutation.isPending ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Extend Subscription Modal
// ---------------------------------------------------------------------------

function ExtendSubscriptionModal({
  isOpen,
  onClose,
  tenant,
}: {
  isOpen: boolean;
  onClose: () => void;
  tenant: Tenant;
}) {
  const queryClient = useQueryClient();

  const getDefaultDate = () => {
    const base = tenant.subscriptionEnd ? new Date(tenant.subscriptionEnd) : new Date();
    if (base < new Date()) base.setTime(new Date().getTime());
    base.setDate(base.getDate() + 30);
    return base.toISOString().split('T')[0];
  };

  const [endDate, setEndDate] = useState(getDefaultDate());
  const [note, setNote] = useState('');

  const extendMutation = useMutation({
    mutationFn: () => adminApi.extendSubscription(tenant.id, { subscriptionEnd: endDate, note: note || undefined }),
    onSuccess: () => {
      toast.success('Подписка продлена');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenant', tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      onClose();
    },
    onError: (err) => toast.error(getApiError(err, 'Не удалось продлить подписку')),
  });

  function addDays(days: number) {
    const base = endDate ? new Date(endDate) : new Date();
    base.setDate(base.getDate() + days);
    setEndDate(base.toISOString().split('T')[0]);
  }

  const inputClass =
    'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Продлить подписку">
      <div className="space-y-4">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500">Текущая подписка</p>
          <p className="text-sm font-semibold text-gray-900 mt-0.5">
            {tenant.subscriptionEnd ? `до ${formatDate(tenant.subscriptionEnd)}` : 'Бессрочная'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Новая дата окончания</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => addDays(30)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">+30 дней</button>
          <button type="button" onClick={() => addDays(90)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">+90 дней</button>
          <button type="button" onClick={() => addDays(365)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">+1 год</button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Заметка</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Оплата за 1 месяц..." className={inputClass} />
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Отмена</button>
          <button onClick={() => extendMutation.mutate()} disabled={!endDate || extendMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {extendMutation.isPending ? 'Сохранение...' : 'Продлить'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isExtendOpen, setIsExtendOpen] = useState(false);

  const {
    data: tenant,
    isLoading,
    isError,
  } = useQuery<Tenant>({
    queryKey: ['admin', 'tenant', id],
    queryFn: async () => {
      const res = await adminApi.getTenant(id!);
      return res.data;
    },
    enabled: !!id,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: () =>
      tenant?.isActive ? adminApi.deactivateTenant(id!) : adminApi.activateTenant(id!),
    onSuccess: () => {
      toast.success(tenant?.isActive ? 'Деактивирован' : 'Активирован');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
    },
    onError: (err) => toast.error(getApiError(err, 'Ошибка')),
  });

  const deleteMutation = useMutation({
    mutationFn: () => adminApi.deleteTenant(id!),
    onSuccess: () => {
      toast.success('Удалён');
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      navigate('/tenants');
    },
    onError: (err) => toast.error(getApiError(err, 'Ошибка')),
  });

  if (isLoading) return <LoadingSpinner size="lg" />;

  if (isError || !tenant) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <Building2 className="h-7 w-7 text-red-500" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-gray-900">Не найден</h2>
        <button onClick={() => navigate('/tenants')}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">
          <ArrowLeft className="h-4 w-4" />К списку
        </button>
      </div>
    );
  }

  const users: User[] = tenant.users || [];
  const ownerUser = users.find((u) => u.role === 'director');
  const subInfo = getSubscriptionInfo(tenant);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/tenants')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-500 hover:bg-gray-50 flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-gray-900 truncate">{tenant.name}</h1>
              {tenant.isActive ? (
                <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 flex-shrink-0">Активен</span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 flex-shrink-0">Откл.</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 truncate">{tenant.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={() => setIsEditOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700" title="Редактировать">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={() => toggleActiveMutation.mutate()} disabled={toggleActiveMutation.isPending}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border ${tenant.isActive ? 'border-amber-300 text-amber-600 hover:bg-amber-50' : 'border-green-300 text-green-600 hover:bg-green-50'} disabled:opacity-50`}
            title={tenant.isActive ? 'Деактивировать' : 'Активировать'}>
            <Power className="h-4 w-4" />
          </button>
          <button onClick={() => setIsDeleteOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-300 text-red-500 hover:bg-red-50" title="Удалить">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Subscription card */}
      <div className={`rounded-xl border p-4 ${subInfo.isExpired ? 'border-red-200 bg-red-50/50' : 'border-indigo-200 bg-indigo-50/30'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Подписка</p>
            <p className={`text-lg font-bold ${subInfo.color}`}>{subInfo.label}</p>
            {tenant.subscriptionEnd && (
              <p className="text-[11px] text-gray-400 mt-0.5">
                {subInfo.isExpired
                  ? `Истекла ${formatDate(tenant.subscriptionEnd)}`
                  : `Окончание: ${formatDate(tenant.subscriptionEnd)}`}
              </p>
            )}
            {tenant.subscriptionNote && (
              <p className="text-[11px] text-gray-500 mt-1 italic">{tenant.subscriptionNote}</p>
            )}
          </div>
          <button onClick={() => setIsExtendOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 flex-shrink-0">
            <CalendarClock className="h-4 w-4" />
            Продлить
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Info + Owner */}
        <div className="space-y-4 lg:col-span-1">
          {/* Info */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">Информация</h2>
            </div>
            <div className="divide-y divide-gray-50 px-4">
              <InfoRow icon={Building2} label="Название" value={tenant.name} />
              <InfoRow icon={Phone} label="Телефон" value={tenant.phone} />
              <InfoRow icon={Mail} label="Email" value={tenant.email} />
              <InfoRow icon={MapPin} label="Адрес" value={tenant.address} />
              <InfoRow icon={Hash} label="Макс. сотрудников" value={tenant.maxUsers} />
              <InfoRow icon={Calendar} label="Создан" value={formatDateTime(tenant.createdAt)} />
            </div>
          </div>

          {/* Owner credentials */}
          {ownerUser && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/30 shadow-sm">
              <div className="border-b border-purple-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-purple-900">Доступы директора</h2>
              </div>
              <div className="px-4 py-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-gray-400">ФИО</p>
                    <p className="text-sm font-medium text-gray-900 truncate">{ownerUser.fullName}</p>
                  </div>
                  <CopyButton text={ownerUser.fullName} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-gray-400 flex items-center gap-1"><UserCircle className="h-3 w-3" />Телефон</p>
                    <p className="text-sm font-mono font-semibold text-purple-700">{ownerUser.username}</p>
                  </div>
                  <CopyButton text={ownerUser.username} />
                </div>
                <div className="rounded-lg bg-purple-100/50 p-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-purple-600">
                    <Key className="h-3 w-3" />
                    <span>Пароль задаётся при создании</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Users */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-900">Сотрудники</h2>
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                  {users.length} / {tenant.maxUsers}
                </span>
              </div>
            </div>

            {users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Users className="h-10 w-10 text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">Нет сотрудников</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-semibold flex-shrink-0">
                      {user.fullName?.charAt(0) || user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{user.fullName}</p>
                      <p className="text-[11px] text-gray-400 truncate">{user.phone || user.username}</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium flex-shrink-0 ${roleBadgeColors[user.role] || 'bg-gray-100 text-gray-600'}`}>
                      {roleLabels[user.role] || user.role}
                    </span>
                    {user.isActive ? (
                      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 flex-shrink-0">Акт.</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 flex-shrink-0">Откл.</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {isEditOpen && (
        <EditTenantModal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} tenant={tenant} />
      )}

      {isExtendOpen && (
        <ExtendSubscriptionModal isOpen={isExtendOpen} onClose={() => setIsExtendOpen(false)} tenant={tenant} />
      )}

      <ConfirmDialog
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Удалить автосервис"
        message={`Удалить "${tenant.name}"? Все данные безвозвратно удалятся.`}
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
