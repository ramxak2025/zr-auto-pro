import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, Plus, Repeat, ShieldAlert, Tag, Trash2, Truck, Wallet, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { expensesApi, suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import { formatDateShort, formatMoney } from '../../../shared/utils/formatters';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import type { Expense } from '../types';
import DatePeriodPicker from '../components/DatePeriodPicker';
import PageHeader from '../components/PageHeader';
import QueryState from '../components/QueryState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Switch from '../components/Switch';
import MonthPager from '../components/reports/MonthPager';
import { patchParams, periodLabel, readPeriod } from '../components/reports/periodParams';
import { formatDayKeyRu } from '../components/reports/reportFormat';
import { numericColumnSizing } from '../components/reports/tableWidths';
import { ErrorRow } from '../components/dashboard/shared';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Card, CardHeader } from '../ui/Card';
import { StatCard } from '../ui/StatCard';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Money } from '../ui/Money';
import { Toolbar } from '../ui/Toolbar';
import { Badge } from '../ui/Badge';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { SkeletonCard } from '../ui/Skeleton';
import { cn } from '../ui/cn';

const percentFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** Дата расхода: 'YYYY-MM-DD' — без Date (без сдвига пояса), ISO-момент — в поясе автосервиса. */
function expenseDate(date: string, timeZone: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDayKeyRu(date) : formatDateShort(date, timeZone);
}

interface CategoryTotal {
  name: string;
  total: number;
  count: number;
}

/** Категория расходов в форме ответа GET /expenses/categories. */
type ExpenseCategoryRow = Awaited<ReturnType<typeof expensesApi.getCategories>>['data'][number];

/**
 * Расходы за период: KPI, таблица расходов рядом с разбивкой по категориям,
 * справочная «Закупка товара». Период — в URL; запросы и ключи прежние.
 */
export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  // Волна «права как в Битрикс24» — зеркало backend expenses/:
  //   can_add_expenses  → POST /expenses («Добавить»);
  //   settings_manage   → CRUD категорий («Категории»);
  //   financial_reports → approve/reject/DELETE (удаление расхода).
  // Байпас superadmin/director — внутри hasPermission; admin — по матрице.
  const canAddExpense = hasPermission('can_add_expenses');
  const canManageCategories = hasPermission('settings_manage');
  const canDeleteExpense = hasPermission('financial_reports');

  // Дефолтный период — текущий месяц ПО КАЛЕНДАРЮ АВТОСЕРВИСА (157): границы
  // уезжают на сервер, а он режет сутки поясом тенанта. По часам браузера
  // бухгалтер из другого региона в ночь на 1-е число открывал страницу уже в
  // новом месяце, пока сервер был ещё в старом, — и видел ноль расходов.
  const { today, monthStart, timeZone } = useTenantCalendar();

  const [params, setParams] = useSearchParams();
  const period = readPeriod(params, { from: monthStart, to: today });
  const dateFrom = period.from;
  const dateTo = period.to;
  const setPeriod = (from: string, to: string) => setParams(patchParams(params, { from, to }), { replace: true });

  const [modalOpen, setModalOpen] = useState(false);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [catToDelete, setCatToDelete] = useState<ExpenseCategoryRow | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatRecurring, setNewCatRecurring] = useState(false);

  const [form, setForm] = useState({
    categoryId: '',
    amount: '',
    description: '',
    date: today,
  });

  const categoriesQuery = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const res = await expensesApi.getCategories();
      return res.data;
    },
  });
  const categories: ExpenseCategoryRow[] = categoriesQuery.data ?? [];

  const {
    data: expenses = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['expenses', dateFrom, dateTo],
    queryFn: async () => {
      const res = await expensesApi.getAll({ dateFrom, dateTo });
      return res.data;
    },
  });

  // Волна G (решение владельца 2026-07): закупки/оплаты поставщикам показываем в
  // «Расходах» отдельной СПРАВОЧНОЙ секцией «Закупка товара (не влияет на прибыль)».
  // Это ОТТОК денег на закупку; в прибыль НЕ входит — стоимость товара уже учтена
  // в себестоимости при продаже, задваивать нельзя. Эндпоинт гейтится на сервере
  // как GET /expenses (can_add_expenses | financial_reports), поэтому запрос
  // включаем только при наличии одного из этих прав.
  const canViewPurchases = canAddExpense || canDeleteExpense;
  const purchasesQuery = useQuery({
    queryKey: ['supplier-payments-report', dateFrom, dateTo],
    queryFn: async () => {
      const res = await suppliersApi.getPaymentsReport({ dateFrom, dateTo });
      return res.data;
    },
    enabled: canViewPurchases,
  });
  const purchaseReport = purchasesQuery.data;

  const createMutation = useMutation({
    mutationFn: (data: any) => expensesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
      toast.success('Расход добавлен');
      setModalOpen(false);
      setForm({ categoryId: '', amount: '', description: '', date: today });
    },
    // Расход всегда падает в филиал СЕССИИ (163) — «записать в никуда» больше
    // нельзя, отказ 400 «Выберите филиал» ушёл вместе с режимом общей сводки.
    // Текст сервера показываем по-прежнему: у отказа может быть совсем другая
    // причина (закрытый период, снятое право), и глухое «Ошибка при добавлении
    // расхода» её бы съело.
    onError: (err) => toast.error(apiErrorMessage(err) ?? 'Ошибка при добавлении расхода', { duration: 8000 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expensesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
      toast.success('Расход удалён');
    },
    onError: () => toast.error('Ошибка при удалении'),
  });

  const createCatMutation = useMutation({
    mutationFn: (data: { name: string; isRecurring?: boolean }) => expensesApi.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      toast.success('Категория создана');
      setNewCatName('');
      setNewCatRecurring(false);
      setCatModalOpen(false);
    },
    onError: () => toast.error('Ошибка при создании категории'),
  });

  // Toggle the «постоянный расход» flag (v3.0.1 ФИЧА 1). Recurring categories
  // are accrual-neutral: their payments hit the cash register but are counted
  // in profit via the Planning config, not deducted again as one-offs.
  const updateCatMutation = useMutation({
    mutationFn: ({ id, isRecurring }: { id: string; isRecurring: boolean }) =>
      expensesApi.updateCategory(id, { isRecurring }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
    },
    onError: () => toast.error('Не удалось изменить категорию'),
  });

  const deleteCatMutation = useMutation({
    mutationFn: (id: string) => expensesApi.removeCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      toast.success('Категория удалена');
    },
    onError: (err) => toast.error(apiErrorMessage(err) ?? 'Не удалось удалить категорию'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount.replace(',', '.'));
    if (!amount || amount <= 0) {
      toast.error('Укажите сумму');
      return;
    }
    createMutation.mutate({
      categoryId: form.categoryId || undefined,
      amount,
      description: form.description || undefined,
      date: form.date,
    });
  };

  const submitCategory = () => {
    if (newCatName.trim()) createCatMutation.mutate({ name: newCatName.trim(), isRecurring: newCatRecurring });
  };

  const totalExpenses = expenses.reduce((sum: number, e: Expense) => sum + e.amount, 0);
  const warrantyTotal = expenses
    .filter((e: Expense) => e.source === 'warranty')
    .reduce((sum: number, e: Expense) => sum + e.amount, 0);

  // Group by category
  const categoryBreakdown = useMemo<CategoryTotal[]>(() => {
    const byCategory: Record<string, CategoryTotal> = {};
    for (const exp of expenses as Expense[]) {
      const cat = exp.categoryName || 'Без категории';
      if (!byCategory[cat]) byCategory[cat] = { name: cat, total: 0, count: 0 };
      byCategory[cat].total += exp.amount;
      byCategory[cat].count += 1;
    }
    return Object.values(byCategory).sort((a, b) => b.total - a.total);
  }, [expenses]);
  const topCategory = categoryBreakdown[0];

  const columns: DataTableColumn<Expense>[] = [
    {
      key: 'date',
      header: 'Дата',
      sortable: true,
      width: 110,
      render: (exp) => (
        <span className="whitespace-nowrap tabular-nums text-ink-2">{expenseDate(exp.date, timeZone)}</span>
      ),
    },
    {
      key: 'categoryName',
      header: 'Категория',
      sortable: true,
      render: (exp) =>
        exp.source === 'warranty' ? (
          <Badge tone="warn" icon={ShieldAlert}>
            Гарантия (убыток)
          </Badge>
        ) : exp.categoryName ? (
          <Badge outline>{exp.categoryName}</Badge>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'description',
      header: 'Описание',
      primary: true,
      truncate: true,
      width: '40%',
      render: (exp) =>
        exp.recipientName ? (
          <span title={exp.description || undefined}>
            {/* 149 — получатель «выплаты вне программы» перед описанием. */}
            <span className="font-medium text-ink">→ {exp.recipientName}</span>
            {exp.description ? <span className="text-ink-2"> · {exp.description}</span> : null}
          </span>
        ) : exp.description ? (
          <span className="text-ink-2" title={exp.description}>
            {exp.description}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'userName',
      header: 'Сотрудник',
      hideBelow: 'lg',
      width: 150,
      render: (exp) => <span className="whitespace-nowrap text-ink-2">{exp.userName || '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Сумма',
      numeric: true,
      sortable: true,
      ...numericColumnSizing('Сумма'),
      render: (exp) => (
        <Money
          value={exp.amount}
          className={cn('font-semibold', exp.source === 'warranty' ? 'text-warn-text' : 'text-ink')}
        />
      ),
      footer: (rows) => <Money value={rows.reduce((s, e) => s + e.amount, 0)} />,
    },
  ];
  if (canDeleteExpense) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Действия</span>,
      interactive: true,
      align: 'right',
      width: 48,
      render: (exp) =>
        exp.source === 'warranty' ? null : (
          <IconButton
            size="sm"
            variant="danger"
            label="Удалить расход"
            icon={Trash2}
            onClick={() => setDeleteId(exp.id)}
          />
        ),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Расходы"
        icon={Wallet}
        subtitle="Учёт расходов по статьям"
        actions={
          canManageCategories || canAddExpense ? (
            <>
              {canManageCategories && (
                <Button variant="secondary" icon={Tag} onClick={() => setCatModalOpen(true)}>
                  Категории
                </Button>
              )}
              {canAddExpense && (
                <Button icon={Plus} onClick={() => setModalOpen(true)}>
                  Добавить
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <Toolbar>
        <MonthPager from={dateFrom} to={dateTo} todayKey={today} onChange={setPeriod} />
        <DatePeriodPicker dateFrom={dateFrom} dateTo={dateTo} onChange={setPeriod} />
      </Toolbar>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={expenses.length === 0}
        empty={{
          icon: Wallet,
          title: 'За период расходов нет',
          description: 'Добавьте расход или измените период',
          action: canAddExpense ? { label: 'Добавить расход', onClick: () => setModalOpen(true) } : undefined,
        }}
        errorTitle="Не удалось загрузить расходы"
        loader={
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonCard key={i} lines={1} />
              ))}
            </div>
            <DataTable<Expense> columns={columns} rows={[]} rowKey={(e) => e.id} isLoading />
          </div>
        }
        minHeight="min-h-[40vh]"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard compact label="Итого расходов" value={formatMoney(totalExpenses)} hint={periodLabel(period)} />
            <StatCard compact label="Записей" value={expenses.length} hint={`Категорий: ${categoryBreakdown.length}`} />
            <StatCard
              compact
              label="Крупнейшая статья"
              value={topCategory ? formatMoney(topCategory.total) : '—'}
              hint={topCategory?.name}
            />
            <StatCard
              compact
              label="Гарантия (убыток)"
              value={formatMoney(warrantyTotal)}
              hint="Запчасти и оплата мастера по гарантии"
              tone={warrantyTotal > 0 ? 'warn' : 'neutral'}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
            <Card padding="none" className="overflow-hidden xl:col-span-2">
              <CardHeader title="Расходы за период" subtitle={periodLabel(period)} divider={false} />
              <DataTable<Expense>
                columns={columns}
                rows={expenses}
                rowKey={(e) => e.id}
                caption="Расходы за период"
                bare
                className="overflow-x-auto"
                rowClassName={(exp) => (exp.source === 'warranty' ? '[&>td]:bg-warn-soft' : undefined)}
              />
            </Card>

            <Card padding="none" className="overflow-hidden">
              <CardHeader title="По категориям" subtitle="Доля от расходов периода" dense divider={false} />
              <DataTable<CategoryTotal>
                dense
                bare
                rows={categoryBreakdown}
                rowKey={(c) => c.name}
                caption="Расходы по категориям"
                columns={[
                  {
                    key: 'name',
                    header: 'Категория',
                    primary: true,
                    render: (c) => (
                      <span className="block min-w-0">
                        <span className="block truncate font-medium text-ink">{c.name}</span>
                        <span className="block text-2xs text-ink-3">{c.count} зап.</span>
                      </span>
                    ),
                    footer: 'Итого',
                  },
                  {
                    key: 'total',
                    header: 'Сумма',
                    numeric: true,
                    render: (c) => <Money value={c.total} className="font-medium text-ink" />,
                    footer: <Money value={totalExpenses} />,
                  },
                  {
                    key: 'share',
                    header: 'Доля',
                    numeric: true,
                    width: 72,
                    render: (c) =>
                      totalExpenses > 0 ? `${percentFormat.format((c.total / totalExpenses) * 100)}%` : '—',
                    footer: totalExpenses > 0 ? '100%' : '',
                  },
                ]}
              />
            </Card>
          </div>
        </div>
      </QueryState>

      {/* Закупка товара — справочный отток, НЕ влияет на прибыль (волна G).
          Показываем секцию только когда за период были оплаты поставщикам. */}
      {canViewPurchases && purchasesQuery.isError && (
        <ErrorRow
          message="Не удалось загрузить закупки товара за период"
          onRetry={() => purchasesQuery.refetch()}
          loading={purchasesQuery.isFetching}
        />
      )}
      {purchaseReport && purchaseReport.total > 0 && (
        <Card padding="none" className="overflow-hidden">
          <CardHeader
            icon={Truck}
            iconTone="neutral"
            title="Закупка товара"
            subtitle="Оплаты поставщикам за период — не влияют на прибыль"
            actions={<Money value={purchaseReport.total} className="text-base font-semibold text-ink" />}
          />
          <p className="flex items-start gap-2 border-b border-line px-5 py-3 text-xs leading-snug text-ink-3">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            Отток денег на закупку. В прибыль не входит: стоимость товара уже учтена в себестоимости при продаже.
          </p>
          {purchaseReport.items.length > 0 && (
            <DataTable<(typeof purchaseReport.items)[number]>
              dense
              bare
              rows={purchaseReport.items}
              rowKey={(p) => p.id}
              caption="Оплаты поставщикам за период"
              className="overflow-x-auto"
              columns={[
                {
                  key: 'date',
                  header: 'Дата',
                  width: 110,
                  render: (p) => <span className="tabular-nums text-ink-2">{expenseDate(p.date, timeZone)}</span>,
                },
                {
                  key: 'supplierName',
                  header: 'Поставщик',
                  primary: true,
                  render: (p) => <span className="font-medium text-ink">{p.supplierName || 'Поставщик'}</span>,
                },
                {
                  key: 'comment',
                  header: 'Комментарий',
                  hideBelow: 'md',
                  truncate: true,
                  width: '40%',
                  render: (p) =>
                    p.comment ? <span className="text-ink-2">{p.comment}</span> : <span className="text-ink-3">—</span>,
                },
                {
                  key: 'amount',
                  header: 'Сумма',
                  numeric: true,
                  render: (p) => <Money value={p.amount} className="font-medium text-ink" />,
                  footer: <Money value={purchaseReport.total} />,
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* Add expense modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Новый расход"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" form="expense-form" icon={Plus} loading={createMutation.isPending}>
              Добавить
            </Button>
          </>
        }
      >
        <form id="expense-form" onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="Категория"
            htmlFor="expense-category"
            hint={
              categoriesQuery.isError ? 'Не удалось загрузить категории — расход можно записать без неё' : undefined
            }
          >
            <Select
              id="expense-category"
              placeholder="Без категории"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            />
          </Field>
          <Field label="Сумма" htmlFor="expense-amount" required>
            <Input
              id="expense-amount"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0"
              required
              rightSlot={<span className="text-sm">₽</span>}
            />
          </Field>
          <Field label="Описание" htmlFor="expense-description">
            <Input
              id="expense-description"
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Например: Аренда офиса за январь"
            />
          </Field>
          <Field label="Дата" htmlFor="expense-date" required>
            <Input
              id="expense-date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </Field>
        </form>
      </Modal>

      {/* Categories management modal */}
      <Modal isOpen={catModalOpen} onClose={() => setCatModalOpen(false)} title="Категории расходов" size="md">
        <div className="space-y-4">
          {/* Create */}
          <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex gap-2">
              <Input
                aria-label="Название новой категории"
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Новая категория (Аренда, Маркетинг…)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitCategory();
                  }
                }}
              />
              <Button
                icon={Plus}
                onClick={submitCategory}
                disabled={!newCatName.trim()}
                loading={createCatMutation.isPending}
                className="flex-shrink-0"
              >
                Создать
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink-2">
                <Repeat className="h-4 w-4 text-ink-3" aria-hidden="true" /> Постоянный расход
              </span>
              <Switch checked={newCatRecurring} onChange={setNewCatRecurring} label="Постоянный расход" />
            </div>
            <p className="flex items-start gap-1.5 text-xs leading-snug text-ink-3">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              Оплаты идут в кассу, а в прибыли учитываются через План — равномерно по дням месяца.
            </p>
          </div>

          {/* List */}
          {categoriesQuery.isError ? (
            <ErrorRow
              message="Не удалось загрузить категории"
              onRetry={() => categoriesQuery.refetch()}
              loading={categoriesQuery.isFetching}
            />
          ) : categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">Категорий пока нет</p>
          ) : (
            <ul className="divide-y divide-line">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{c.name}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'hidden text-xs sm:inline',
                        c.isRecurring ? 'font-medium text-accent-text' : 'text-ink-3',
                      )}
                    >
                      Постоянный
                    </span>
                    <Switch
                      checked={!!c.isRecurring}
                      onChange={(v) => updateCatMutation.mutate({ id: c.id, isRecurring: v })}
                      disabled={updateCatMutation.isPending}
                      label={`Отметить категорию «${c.name}» постоянным расходом`}
                    />
                  </div>
                  <IconButton
                    size="sm"
                    variant="danger"
                    label={`Удалить категорию ${c.name}`}
                    icon={X}
                    onClick={() => setCatToDelete(c)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Удалить расход"
        message="Расход исчезнет из списка и из прибыли за период. Продолжить?"
        confirmText="Удалить"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={catToDelete !== null}
        onClose={() => setCatToDelete(null)}
        onConfirm={() => {
          if (catToDelete) deleteCatMutation.mutate(catToDelete.id);
        }}
        title="Удалить категорию"
        message={
          catToDelete ? `Категория «${catToDelete.name}» будет удалена. Расходы останутся, но без категории.` : ''
        }
        confirmText="Удалить"
        variant="danger"
        loading={deleteCatMutation.isPending}
      />
    </div>
  );
}
