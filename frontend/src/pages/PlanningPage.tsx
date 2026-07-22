import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import {
  SlidersHorizontal,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Home,
  Zap,
  Megaphone,
  Tag,
  Wallet,
  TrendingUp,
  Percent,
  Users,
  Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { planningApi, usersApi } from '../api/services';
import { formatMoney, roleLabels } from '../../../shared/utils/formatters';
import type { FixedCost, FixedCostCategory, EmployeeCompensation, EmployeeCompensationType, User } from '../types';
import PageHeader from '../components/PageHeader';
import QueryState from '../components/QueryState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Switch from '../components/Switch';

// ---------------------------------------------------------------------------
// Label / visual maps
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<FixedCostCategory, { label: string; icon: typeof Home; chip: string; tint: string }> = {
  rent: { label: 'Аренда', icon: Home, chip: 'bg-indigo-50 text-indigo-600', tint: 'text-indigo-600' },
  utilities: { label: 'Коммуналка', icon: Zap, chip: 'bg-amber-50 text-amber-600', tint: 'text-amber-600' },
  marketing: { label: 'Реклама', icon: Megaphone, chip: 'bg-violet-50 text-violet-600', tint: 'text-violet-600' },
  other: { label: 'Прочее', icon: Tag, chip: 'bg-slate-100 text-slate-600', tint: 'text-slate-500' },
};
const CATEGORY_ORDER: FixedCostCategory[] = ['rent', 'utilities', 'marketing', 'other'];

const COMP_META: Record<
  EmployeeCompensationType,
  { label: string; short: string; icon: typeof Wallet; chip: string; unit: '₽' | '%' }
> = {
  fixed_monthly: {
    label: 'Оклад в месяц',
    short: 'Оклад',
    icon: Wallet,
    chip: 'bg-green-50 text-green-600',
    unit: '₽',
  },
  pct_turnover: {
    label: '% с оборота',
    short: '% оборот',
    icon: TrendingUp,
    chip: 'bg-blue-50 text-blue-600',
    unit: '%',
  },
  pct_profit: {
    label: '% с прибыли',
    short: '% прибыль',
    icon: Percent,
    chip: 'bg-emerald-50 text-emerald-600',
    unit: '%',
  },
};

const formatPct = (v: number) => `${(Math.round(v * 10) / 10).toString().replace('.', ',')} %`;

// ---------------------------------------------------------------------------
// Section 1 — Fixed monthly costs
// ---------------------------------------------------------------------------

interface FixedForm {
  name: string;
  category: FixedCostCategory;
  monthlyAmount: string;
  active: boolean;
}

const emptyFixedForm: FixedForm = { name: '', category: 'rent', monthlyAmount: '', active: true };

function FixedCostsSection() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FixedCost | null>(null);
  const [form, setForm] = useState<FixedForm>(emptyFixedForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['planning', 'fixed-costs'],
    queryFn: async () => (await planningApi.fixedCosts.list()).data,
  });
  const costs = data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['planning', 'fixed-costs'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
  };

  const createMut = useMutation({
    mutationFn: (body: { name: string; category: FixedCostCategory; monthlyAmount: number }) =>
      planningApi.fixedCosts.create(body),
    onSuccess: () => {
      invalidate();
      toast.success('Постоянный расход добавлен');
      closeModal();
    },
    onError: () => toast.error('Не удалось сохранить'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof planningApi.fixedCosts.update>[1] }) =>
      planningApi.fixedCosts.update(id, body),
    onSuccess: () => {
      invalidate();
      toast.success('Сохранено');
      closeModal();
    },
    onError: () => toast.error('Не удалось сохранить'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => planningApi.fixedCosts.update(id, { active }),
    onSuccess: invalidate,
    onError: () => toast.error('Не удалось изменить'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => planningApi.fixedCosts.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success('Удалено');
    },
    onError: () => toast.error('Не удалось удалить'),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyFixedForm);
    setModalOpen(true);
  };
  const openEdit = (c: FixedCost) => {
    setEditing(c);
    setForm({ name: c.name, category: c.category, monthlyAmount: String(c.monthlyAmount), active: c.active });
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.monthlyAmount);
    if (!form.name.trim()) return toast.error('Укажите название');
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Укажите сумму в месяц');
    if (editing) {
      updateMut.mutate({
        id: editing.id,
        body: { name: form.name.trim(), category: form.category, monthlyAmount: amount, active: form.active },
      });
    } else {
      createMut.mutate({ name: form.name.trim(), category: form.category, monthlyAmount: amount });
    }
  };

  const totalMonthly = costs.filter((c) => c.active).reduce((s, c) => s + c.monthlyAmount, 0);
  const saving = createMut.isPending || updateMut.isPending;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Постоянные расходы</h2>
            <p className="text-xs text-gray-500">Ежемесячные суммы: аренда, коммуналка, реклама</p>
          </div>
        </div>
        <button onClick={openCreate} className="btn-primary btn-sm flex-shrink-0">
          <Plus className="h-4 w-4" /> Добавить
        </button>
      </header>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={costs.length === 0}
        empty={{
          icon: Wallet,
          title: 'Постоянных расходов пока нет',
          description:
            'Добавьте аренду, коммуналку и рекламу — они будут равномерно вычитаться из прибыли по дням месяца.',
          action: { label: 'Добавить расход', onClick: openCreate },
        }}
        minHeight="min-h-[30vh]"
      >
        <ul className="divide-y divide-gray-100">
          {costs.map((c) => {
            const meta = CATEGORY_META[c.category] ?? CATEGORY_META.other;
            const Icon = meta.icon;
            return (
              <li
                key={c.id}
                className={`flex items-center gap-3 px-5 py-3.5 transition-colors ${c.active ? '' : 'opacity-55'}`}
              >
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${meta.chip}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-500">{meta.label}</p>
                </div>
                <span className="whitespace-nowrap text-sm font-semibold text-gray-900 tabular-nums">
                  {formatMoney(c.monthlyAmount)}
                  <span className="ml-1 text-[11px] font-normal text-gray-400">/ мес</span>
                </span>
                <Switch
                  checked={c.active}
                  onChange={(active) => toggleMut.mutate({ id: c.id, active })}
                  label={`${c.active ? 'Выключить' : 'Включить'} расход ${c.name}`}
                  className="ml-1"
                />
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => openEdit(c)}
                    aria-label={`Изменить ${c.name}`}
                    title="Изменить"
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(c.id)}
                    aria-label={`Удалить ${c.name}`}
                    title="Удалить"
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/60 px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Итого в месяц</span>
          <span className="text-base font-bold text-gray-900 tabular-nums">{formatMoney(totalMonthly)}</span>
        </div>
      </QueryState>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editing ? 'Изменить расход' : 'Новый постоянный расход'}
        size="md"
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Название</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Аренда бокса, Реклама Авито…"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Категория</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CATEGORY_ORDER.map((cat) => {
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                const selected = form.category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setForm({ ...form, category: cat })}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition-all ${
                      selected
                        ? 'border-primary-500 bg-primary-50 text-primary-700 ring-1 ring-primary-500/20'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="label">Сумма в месяц</label>
            <div className="relative">
              <input
                type="number"
                className="input pr-9"
                value={form.monthlyAmount}
                onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })}
                placeholder="0"
                min="0"
                step="1"
                inputMode="numeric"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">
                ₽
              </span>
            </div>
          </div>
          {editing && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3.5 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Учитывать в прибыли</p>
                <p className="text-xs text-gray-500">Выключенные расходы не вычитаются</p>
              </div>
              <Switch
                checked={form.active}
                onChange={(active) => setForm({ ...form, active })}
                label="Учитывать расход в прибыли"
              />
            </div>
          )}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editing ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Удалить постоянный расход"
        message="Расход перестанет учитываться в чистой прибыли по начислению. Продолжить?"
        confirmText="Удалить"
        variant="danger"
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Employee compensation (оклад / % с оборота / % с прибыли)
// ---------------------------------------------------------------------------

interface CompForm {
  userId: string;
  type: EmployeeCompensationType;
  amount: string;
  active: boolean;
}

const emptyCompForm: CompForm = { userId: '', type: 'fixed_monthly', amount: '', active: true };

function CompensationSection() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeCompensation | null>(null);
  const [form, setForm] = useState<CompForm>(emptyCompForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['planning', 'compensation'],
    queryFn: async () => (await planningApi.compensation.list()).data,
  });
  const rows = data ?? [];

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await usersApi.getAll()).data,
  });
  const employees: User[] = (usersData ?? []).filter((u) => u.isActive && !u.dismissedAt && !u.purgedAt);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['planning', 'compensation'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
  };

  const upsertMut = useMutation({
    mutationFn: (body: { userId: string; type: EmployeeCompensationType; amount: number }) =>
      planningApi.compensation.upsert(body),
    onSuccess: () => {
      invalidate();
      toast.success('Мотивация сохранена');
      closeModal();
    },
    onError: () => toast.error('Не удалось сохранить'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof planningApi.compensation.update>[1] }) =>
      planningApi.compensation.update(id, body),
    onSuccess: () => {
      invalidate();
      toast.success('Сохранено');
      closeModal();
    },
    onError: () => toast.error('Не удалось сохранить'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => planningApi.compensation.update(id, { active }),
    onSuccess: invalidate,
    onError: () => toast.error('Не удалось изменить'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => planningApi.compensation.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success('Удалено');
    },
    onError: () => toast.error('Не удалось удалить'),
  });

  const configuredIds = new Set(rows.map((r) => r.userId));
  const available = employees.filter((u) => !configuredIds.has(u.id));

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyCompForm, userId: available[0]?.id ?? '' });
    setModalOpen(true);
  };
  const openEdit = (r: EmployeeCompensation) => {
    setEditing(r);
    setForm({ userId: r.userId, type: r.type, amount: String(r.amount), active: r.active });
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!form.userId) return toast.error('Выберите сотрудника');
    if (!Number.isFinite(amount) || amount < 0) return toast.error('Укажите значение');
    if (form.type !== 'fixed_monthly' && amount > 100) return toast.error('Процент не может быть больше 100');
    if (editing) {
      updateMut.mutate({ id: editing.id, body: { type: form.type, amount, active: form.active } });
    } else {
      upsertMut.mutate({ userId: form.userId, type: form.type, amount });
    }
  };

  const nameFor = (r: EmployeeCompensation) =>
    r.userName || employees.find((u) => u.id === r.userId)?.fullName || 'Сотрудник';
  const roleFor = (r: EmployeeCompensation) => {
    const role = r.userRole || employees.find((u) => u.id === r.userId)?.role;
    return role ? roleLabels[role] || role : '';
  };
  const saving = upsertMut.isPending || updateMut.isPending;
  const editUnit = COMP_META[form.type].unit;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <Users className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Мотивация сотрудников</h2>
            <p className="text-xs text-gray-500">Оклад, % с оборота и % с прибыли</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          disabled={available.length === 0}
          className="btn-primary btn-sm flex-shrink-0"
          title={available.length === 0 ? 'Все сотрудники уже настроены' : undefined}
        >
          <Plus className="h-4 w-4" /> Добавить
        </button>
      </header>

      <div className="flex items-start gap-2 border-b border-gray-100 bg-blue-50/50 px-5 py-2.5 text-xs text-blue-800">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <p>
          Для уборщиков, администраторов, кассиров. <span className="font-medium">% мастеру за работу</span> задаётся в
          услугах и чеке — он уже в прибыли.
        </p>
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={rows.length === 0}
        empty={{
          icon: Users,
          title: 'Мотивация не настроена',
          description: 'Добавьте оклад или процент сотрудникам вне сдельной оплаты, чтобы прибыль считалась точнее.',
          action: available.length ? { label: 'Добавить сотрудника', onClick: openCreate } : undefined,
        }}
        minHeight="min-h-[30vh]"
      >
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => {
            const meta = COMP_META[r.type] ?? COMP_META.fixed_monthly;
            const Icon = meta.icon;
            const role = roleFor(r);
            return (
              <li key={r.id} className={`flex items-center gap-3 px-5 py-3.5 ${r.active ? '' : 'opacity-55'}`}>
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${meta.chip}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{nameFor(r)}</p>
                  <p className="text-xs text-gray-500">
                    {meta.short}
                    {role ? ` · ${role}` : ''}
                  </p>
                </div>
                <span className="whitespace-nowrap text-sm font-semibold text-gray-900 tabular-nums">
                  {r.type === 'fixed_monthly' ? (
                    <>
                      {formatMoney(r.amount)}
                      <span className="ml-1 text-[11px] font-normal text-gray-400">/ мес</span>
                    </>
                  ) : (
                    formatPct(r.amount)
                  )}
                </span>
                <Switch
                  checked={r.active}
                  onChange={(active) => toggleMut.mutate({ id: r.id, active })}
                  label={`${r.active ? 'Выключить' : 'Включить'} мотивацию ${nameFor(r)}`}
                  className="ml-1"
                />
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    aria-label={`Изменить ${nameFor(r)}`}
                    title="Изменить"
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(r.id)}
                    aria-label={`Удалить ${nameFor(r)}`}
                    title="Удалить"
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </QueryState>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editing ? `Мотивация: ${editing.userName || nameFor(editing)}` : 'Мотивация сотрудника'}
        size="md"
      >
        <form onSubmit={submit} className="space-y-4">
          {editing ? (
            <div className="rounded-lg bg-gray-50 px-3.5 py-3">
              <p className="text-sm font-medium text-gray-900">{nameFor(editing)}</p>
              {roleFor(editing) && <p className="text-xs text-gray-500">{roleFor(editing)}</p>}
            </div>
          ) : (
            <div>
              <label className="label">Сотрудник</label>
              <select
                className="input"
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
              >
                {available.length === 0 && <option value="">Нет доступных сотрудников</option>}
                {available.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                    {u.role ? ` — ${roleLabels[u.role] || u.role}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">Тип оплаты</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(COMP_META) as EmployeeCompensationType[]).map((t) => {
                const meta = COMP_META[t];
                const Icon = meta.icon;
                const selected = form.type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, type: t })}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center text-[11px] font-medium leading-tight transition-all ${
                      selected
                        ? 'border-primary-500 bg-primary-50 text-primary-700 ring-1 ring-primary-500/20'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {meta.short}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="label">{editUnit === '₽' ? 'Оклад в месяц' : 'Процент'}</label>
            <div className="relative">
              <input
                type="number"
                className="input pr-9"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0"
                min="0"
                max={editUnit === '%' ? 100 : undefined}
                step={editUnit === '%' ? '0.1' : '1'}
                inputMode="decimal"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400">
                {editUnit}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {form.type === 'fixed_monthly'
                ? 'Равномерно распределяется по дням месяца.'
                : form.type === 'pct_turnover'
                  ? 'Процент от выручки за период.'
                  : 'Процент от прибыли по чекам за период.'}
            </p>
          </div>

          {editing && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3.5 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Учитывать в прибыли</p>
                <p className="text-xs text-gray-500">Выключенная мотивация не вычитается</p>
              </div>
              <Switch
                checked={form.active}
                onChange={(active) => setForm({ ...form, active })}
                label="Учитывать мотивацию в прибыли"
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={saving || (!editing && !form.userId)} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editing ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Удалить мотивацию"
        message="Оплата сотрудника перестанет учитываться в чистой прибыли по начислению. Продолжить?"
        confirmText="Удалить"
        variant="danger"
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlanningPage() {
  const { hasPermission } = useAuth();
  // Планирование (fixed-costs/compensation) — ключ financial_reports (backend
  // planning/ класс-гейт; волна Битрикс24). Байпас superadmin/director — внутри
  // hasPermission; admin — по матрице роли из /auth/me.
  const canView = hasPermission('financial_reports');

  // Defensive route guard — the menu entry is already permission-gated, but a
  // direct URL hit without the right is bounced to the dashboard (server 403s).
  if (!canView) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Постоянные расходы и мотивация"
        icon={SlidersHorizontal}
        subtitle="Планирование для реальной чистой прибыли"
      />

      <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-3.5 text-sm text-primary-900">
        <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-600" />
        <p className="leading-relaxed">
          Эти суммы вычитаются из прибыли <span className="font-semibold">равномерно по дням месяца</span>, а не в день
          оплаты. Так «Чистая прибыль по начислению» на главной не прыгает и показывает реальную картину.
        </p>
      </div>

      <FixedCostsSection />
      <CompensationSection />
    </div>
  );
}
