import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import {
  Home,
  Info,
  Megaphone,
  Pencil,
  Percent,
  Plus,
  SlidersHorizontal,
  Tag,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { planningApi, usersApi } from '../api/services';
import { roleLabels } from '../../../shared/utils/formatters';
import type { FixedCost, FixedCostCategory, EmployeeCompensation, EmployeeCompensationType, User } from '../types';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Switch from '../components/Switch';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Card, CardHeader } from '../ui/Card';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Money } from '../ui/Money';
import { Badge } from '../ui/Badge';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { SegmentedControl } from '../ui/SegmentedControl';

// ---------------------------------------------------------------------------
// Label / visual maps
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<FixedCostCategory, { label: string; icon: typeof Home }> = {
  rent: { label: 'Аренда', icon: Home },
  utilities: { label: 'Коммуналка', icon: Zap },
  marketing: { label: 'Реклама', icon: Megaphone },
  other: { label: 'Прочее', icon: Tag },
};
const CATEGORY_ORDER: FixedCostCategory[] = ['rent', 'utilities', 'marketing', 'other'];
const CATEGORY_OPTIONS = CATEGORY_ORDER.map((c) => ({
  value: c,
  label: CATEGORY_META[c].label,
  icon: CATEGORY_META[c].icon,
}));

const COMP_META: Record<
  EmployeeCompensationType,
  { label: string; short: string; icon: typeof Wallet; unit: '₽' | '%' }
> = {
  fixed_monthly: { label: 'Оклад в месяц', short: 'Оклад', icon: Wallet, unit: '₽' },
  pct_turnover: { label: '% с оборота', short: '% оборот', icon: TrendingUp, unit: '%' },
  pct_profit: { label: '% с прибыли', short: '% прибыль', icon: Percent, unit: '%' },
};
const COMP_OPTIONS = (Object.keys(COMP_META) as EmployeeCompensationType[]).map((t) => ({
  value: t,
  label: COMP_META[t].short,
  icon: COMP_META[t].icon,
}));

const percentFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const formatPct = (v: number) => `${percentFormat.format(v)}%`;

const inactiveRow = '[&>td]:opacity-60';

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
    const amount = parseFloat(form.monthlyAmount.replace(',', '.'));
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

  const columns: DataTableColumn<FixedCost>[] = [
    {
      key: 'name',
      header: 'Название',
      primary: true,
      sortable: true,
      render: (c) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{c.name}</span>
          <span className="block text-xs text-ink-3 md:hidden">
            {(CATEGORY_META[c.category] ?? CATEGORY_META.other).label}
          </span>
        </span>
      ),
      footer: 'Итого в месяц',
    },
    {
      key: 'category',
      header: 'Категория',
      hideBelow: 'md',
      sortable: true,
      sortValue: (c) => (CATEGORY_META[c.category] ?? CATEGORY_META.other).label,
      render: (c) => {
        const meta = CATEGORY_META[c.category] ?? CATEGORY_META.other;
        return (
          <Badge outline icon={meta.icon}>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: 'monthlyAmount',
      header: 'В месяц',
      numeric: true,
      sortable: true,
      render: (c) => <Money value={c.monthlyAmount} className="font-medium text-ink" />,
      footer: <Money value={totalMonthly} />,
    },
    {
      key: 'active',
      header: 'В прибыли',
      align: 'center',
      interactive: true,
      width: 96,
      render: (c) => (
        <span className="inline-flex justify-center">
          <Switch
            checked={c.active}
            onChange={(active) => toggleMut.mutate({ id: c.id, active })}
            label={`${c.active ? 'Выключить' : 'Включить'} расход ${c.name}`}
          />
        </span>
      ),
      footer: <span className="block text-center text-xs font-normal text-ink-3">только активные</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Действия</span>,
      interactive: true,
      align: 'right',
      width: 88,
      render: (c) => (
        <span className="inline-flex items-center gap-0.5">
          <IconButton size="sm" label={`Изменить ${c.name}`} icon={Pencil} onClick={() => openEdit(c)} />
          <IconButton
            size="sm"
            variant="danger"
            label={`Удалить ${c.name}`}
            icon={Trash2}
            onClick={() => setDeleteId(c.id)}
          />
        </span>
      ),
    },
  ];

  return (
    <Card padding="none" className="overflow-hidden">
      <CardHeader
        icon={Wallet}
        iconTone="neutral"
        title="Постоянные расходы"
        subtitle="Ежемесячные суммы: аренда, коммуналка, реклама"
        divider={false}
        actions={
          <Button size="sm" variant="secondary" icon={Plus} onClick={openCreate}>
            Добавить
          </Button>
        }
      />

      <DataTable<FixedCost>
        columns={columns}
        rows={costs}
        rowKey={(c) => c.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить постоянные расходы"
        emptyState={{
          icon: Wallet,
          title: 'Постоянных расходов пока нет',
          description:
            'Добавьте аренду, коммуналку и рекламу — они будут равномерно вычитаться из прибыли по дням месяца.',
          action: { label: 'Добавить расход', onClick: openCreate },
        }}
        rowClassName={(c) => (c.active ? undefined : inactiveRow)}
        caption="Постоянные расходы в месяц"
        bare
        className="overflow-x-auto"
      />

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editing ? 'Изменить расход' : 'Новый постоянный расход'}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Отмена
            </Button>
            <Button type="submit" form="fixed-cost-form" icon={editing ? undefined : Plus} loading={saving}>
              {editing ? 'Сохранить' : 'Добавить'}
            </Button>
          </>
        }
      >
        <form id="fixed-cost-form" onSubmit={submit} className="space-y-4">
          <Field label="Название" htmlFor="fixed-name" required>
            <Input
              id="fixed-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Аренда бокса, Реклама Авито…"
              autoComplete="off"
              required
            />
          </Field>
          <Field label="Категория">
            <SegmentedControl
              aria-label="Категория"
              fullWidth
              options={CATEGORY_OPTIONS}
              value={form.category}
              onChange={(category) => setForm({ ...form, category })}
            />
          </Field>
          <Field label="Сумма в месяц" htmlFor="fixed-amount" required>
            <Input
              id="fixed-amount"
              inputMode="decimal"
              value={form.monthlyAmount}
              onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })}
              placeholder="0"
              required
              rightSlot={<span className="text-sm">₽</span>}
            />
          </Field>
          {editing && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-3">
              <div>
                <p className="text-sm font-medium text-ink">Учитывать в прибыли</p>
                <p className="text-xs text-ink-3">Выключенные расходы не вычитаются</p>
              </div>
              <Switch
                checked={form.active}
                onChange={(active) => setForm({ ...form, active })}
                label="Учитывать расход в прибыли"
              />
            </div>
          )}
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
        loading={deleteMut.isPending}
      />
    </Card>
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

  // Команда ТЕКУЩЕГО филиала (167): оклады заводятся сотрудникам этого
  // автосервиса; сервер отдаёт в списке окладов тоже только их.
  const usersQuery = useQuery({
    queryKey: ['users', 'point'],
    queryFn: async () => (await usersApi.getAll({ scope: 'point' })).data,
  });
  const employees: User[] = (usersQuery.data ?? []).filter((u) => u.isActive && !u.dismissedAt && !u.purgedAt);

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
    const amount = parseFloat(form.amount.replace(',', '.'));
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
  const addDisabledReason = usersQuery.isError
    ? 'Не удалось загрузить сотрудников'
    : available.length === 0 && !usersQuery.isLoading
      ? 'Все сотрудники уже настроены'
      : undefined;

  const columns: DataTableColumn<EmployeeCompensation>[] = [
    {
      key: 'userName',
      header: 'Сотрудник',
      primary: true,
      sortable: true,
      sortValue: (r) => nameFor(r),
      render: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{nameFor(r)}</span>
          {roleFor(r) && <span className="block text-xs text-ink-3">{roleFor(r)}</span>}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Тип',
      hideBelow: 'md',
      sortable: true,
      sortValue: (r) => (COMP_META[r.type] ?? COMP_META.fixed_monthly).label,
      render: (r) => {
        const meta = COMP_META[r.type] ?? COMP_META.fixed_monthly;
        return (
          <Badge outline icon={meta.icon}>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: 'amount',
      header: 'Значение',
      numeric: true,
      sortable: true,
      render: (r) =>
        r.type === 'fixed_monthly' ? (
          <span className="whitespace-nowrap">
            <Money value={r.amount} className="font-medium text-ink" />
            <span className="ml-1 text-xs text-ink-3">/ мес</span>
          </span>
        ) : (
          <span className="font-medium tabular-nums text-ink">{formatPct(r.amount)}</span>
        ),
    },
    {
      key: 'active',
      header: 'В прибыли',
      align: 'center',
      interactive: true,
      width: 96,
      render: (r) => (
        <span className="inline-flex justify-center">
          <Switch
            checked={r.active}
            onChange={(active) => toggleMut.mutate({ id: r.id, active })}
            label={`${r.active ? 'Выключить' : 'Включить'} мотивацию ${nameFor(r)}`}
          />
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Действия</span>,
      interactive: true,
      align: 'right',
      width: 88,
      render: (r) => (
        <span className="inline-flex items-center gap-0.5">
          <IconButton size="sm" label={`Изменить ${nameFor(r)}`} icon={Pencil} onClick={() => openEdit(r)} />
          <IconButton
            size="sm"
            variant="danger"
            label={`Удалить ${nameFor(r)}`}
            icon={Trash2}
            onClick={() => setDeleteId(r.id)}
          />
        </span>
      ),
    },
  ];

  return (
    <Card padding="none" className="overflow-hidden">
      <CardHeader
        icon={Users}
        iconTone="neutral"
        title="Мотивация сотрудников"
        subtitle="Оклад, % с оборота и % с прибыли — для тех, кто вне сдельной оплаты"
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={openCreate}
            disabled={!!addDisabledReason}
            title={addDisabledReason}
          >
            Добавить
          </Button>
        }
      />

      <div className="flex items-start gap-2 border-b border-line bg-info-soft px-5 py-2.5 text-xs leading-snug text-info-text">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <p>
          Для уборщиков, администраторов, кассиров. <span className="font-medium">% мастеру за работу</span> задаётся в
          услугах и чеке — он уже в прибыли.
        </p>
      </div>

      <DataTable<EmployeeCompensation>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить мотивацию"
        emptyState={{
          icon: Users,
          title: 'Мотивация не настроена',
          description: 'Добавьте оклад или процент сотрудникам вне сдельной оплаты, чтобы прибыль считалась точнее.',
          action: available.length ? { label: 'Добавить сотрудника', onClick: openCreate } : undefined,
        }}
        rowClassName={(r) => (r.active ? undefined : inactiveRow)}
        caption="Мотивация сотрудников"
        bare
        className="overflow-x-auto"
      />

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editing ? `Мотивация: ${editing.userName || nameFor(editing)}` : 'Мотивация сотрудника'}
        description={editing && roleFor(editing) ? roleFor(editing) : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Отмена
            </Button>
            <Button
              type="submit"
              form="compensation-form"
              icon={editing ? undefined : Plus}
              loading={saving}
              disabled={!editing && !form.userId}
            >
              {editing ? 'Сохранить' : 'Добавить'}
            </Button>
          </>
        }
      >
        <form id="compensation-form" onSubmit={submit} className="space-y-4">
          {!editing && (
            <Field label="Сотрудник" htmlFor="compensation-user" required>
              <Select
                id="compensation-user"
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
                options={
                  available.length === 0
                    ? [{ value: '', label: 'Нет доступных сотрудников' }]
                    : available.map((u) => ({
                        value: u.id,
                        label: `${u.fullName}${u.role ? ` — ${roleLabels[u.role] || u.role}` : ''}`,
                      }))
                }
              />
            </Field>
          )}

          <Field label="Тип оплаты">
            <SegmentedControl
              aria-label="Тип оплаты"
              fullWidth
              options={COMP_OPTIONS}
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
            />
          </Field>

          <Field
            label={editUnit === '₽' ? 'Оклад в месяц' : 'Процент'}
            htmlFor="compensation-amount"
            required
            hint={
              form.type === 'fixed_monthly'
                ? 'Равномерно распределяется по дням месяца.'
                : form.type === 'pct_turnover'
                  ? 'Процент от выручки за период.'
                  : 'Процент от прибыли по чекам за период.'
            }
          >
            <Input
              id="compensation-amount"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0"
              required
              rightSlot={<span className="text-sm">{editUnit}</span>}
            />
          </Field>

          {editing && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-3">
              <div>
                <p className="text-sm font-medium text-ink">Учитывать в прибыли</p>
                <p className="text-xs text-ink-3">Выключенная мотивация не вычитается</p>
              </div>
              <Switch
                checked={form.active}
                onChange={(active) => setForm({ ...form, active })}
                label="Учитывать мотивацию в прибыли"
              />
            </div>
          )}
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
        loading={deleteMut.isPending}
      />
    </Card>
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
        title="Планирование"
        icon={SlidersHorizontal}
        subtitle="Постоянные расходы и мотивация — для реальной чистой прибыли по начислению"
      />

      <div className="flex items-start gap-3 rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-sm text-info-text">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
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
