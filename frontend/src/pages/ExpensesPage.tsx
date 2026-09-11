import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wallet, Tag, Loader2, X, ShieldAlert, Info, Repeat, Truck } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { expensesApi, suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import DatePeriodPicker from '../components/DatePeriodPicker';
import PageHeader from '../components/PageHeader';
import QueryState from '../components/QueryState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import Switch from '../components/Switch';
import { apiErrorMessage } from '../../../shared/utils/apiError';

const formatCurrency = (value: number) =>
  Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD';

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
  const { today, monthStart } = useTenantCalendar();

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [modalOpen, setModalOpen] = useState(false);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatRecurring, setNewCatRecurring] = useState(false);

  const [form, setForm] = useState({
    categoryId: '',
    amount: '',
    description: '',
    date: today,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const res = await expensesApi.getCategories();
      return res.data;
    },
  });

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
  const { data: purchaseReport } = useQuery({
    queryKey: ['supplier-payments-report', dateFrom, dateTo],
    queryFn: async () => {
      const res = await suppliersApi.getPaymentsReport({ dateFrom, dateTo });
      return res.data;
    },
    enabled: canViewPurchases,
  });

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
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast.error('Укажите сумму');
      return;
    }
    createMutation.mutate({
      categoryId: form.categoryId || undefined,
      amount: parseFloat(form.amount),
      description: form.description || undefined,
      date: form.date,
    });
  };

  const totalExpenses = expenses.reduce((sum: number, e: any) => sum + e.amount, 0);

  // Group by category
  const byCategory: Record<string, { name: string; total: number }> = {};
  for (const exp of expenses) {
    const cat = exp.categoryName || 'Без категории';
    if (!byCategory[cat]) byCategory[cat] = { name: cat, total: 0 };
    byCategory[cat].total += exp.amount;
  }
  const categoryBreakdown = Object.values(byCategory).sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Расходы"
        icon={Wallet}
        subtitle="Учёт расходов по статьям"
        actions={
          canManageCategories || canAddExpense ? (
            <>
              {canManageCategories && (
                <button onClick={() => setCatModalOpen(true)} className="btn-secondary text-xs justify-center">
                  <Tag className="w-3.5 h-3.5" /> Категории
                </button>
              )}
              {canAddExpense && (
                <button onClick={() => setModalOpen(true)} className="btn-primary justify-center">
                  <Plus className="w-4 h-4" /> Добавить
                </button>
              )}
            </>
          ) : undefined
        }
      />

      <DatePeriodPicker
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(f, t) => {
          setDateFrom(f);
          setDateTo(t);
        }}
      />

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={expenses.length === 0}
        empty={{ icon: Wallet, title: 'Нет расходов', description: 'Добавьте расходы за выбранный период' }}
        minHeight="min-h-[40vh]"
      >
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 p-5 text-white">
            <p className="text-xs font-semibold text-white/70 uppercase tracking-wider">Итого расходов</p>
            <p className="text-3xl font-bold mt-1 tabular-nums">{formatCurrency(totalExpenses)}</p>
          </div>

          {/* Category breakdown */}
          {categoryBreakdown.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">По категориям</p>
              </div>
              <div className="grid grid-cols-1 gap-px bg-gray-100 sm:grid-cols-2 lg:grid-cols-3">
                {categoryBreakdown.map((cat) => (
                  <div key={cat.name} className="flex items-center justify-between gap-3 bg-white px-4 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-rose-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-800 truncate">{cat.name}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900 whitespace-nowrap tabular-nums">
                      {formatCurrency(cat.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {expenses.map((exp: any) => {
              const isWarranty = exp.source === 'warranty';
              return (
                <div
                  key={exp.id}
                  className={`rounded-xl border shadow-sm p-4 flex items-center gap-3 ${
                    isWarranty ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-gray-100'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span
                        className={`text-sm font-bold tabular-nums ${isWarranty ? 'text-amber-700' : 'text-gray-900'}`}
                      >
                        {formatCurrency(exp.amount)}
                      </span>
                      {isWarranty ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                          <ShieldAlert className="w-3 h-3" />
                          Гарантия (убыток)
                        </span>
                      ) : (
                        exp.categoryName && (
                          <span className="text-[10px] font-semibold bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded-full">
                            {exp.categoryName}
                          </span>
                        )
                      )}
                    </div>
                    {/* 149 — получатель «выплаты вне программы» (свободное имя). */}
                    {exp.recipientName && (
                      <p className="text-xs font-semibold text-gray-700 truncate">→ {exp.recipientName}</p>
                    )}
                    {exp.description && <p className="text-xs text-gray-500 truncate">{exp.description}</p>}
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {format(new Date(exp.date), 'dd.MM.yyyy', { locale: ru })}
                      {exp.userName ? ` · ${exp.userName}` : ''}
                    </p>
                  </div>
                  {canDeleteExpense && !isWarranty && (
                    <button
                      type="button"
                      aria-label="Удалить расход"
                      title="Удалить расход"
                      onClick={() => setDeleteId(exp.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-container overflow-y-auto md:max-h-[calc(100vh-22rem)]">
            <table className="table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Сумма</th>
                  <th>Категория</th>
                  <th>Описание</th>
                  <th>Дата</th>
                  <th>Сотрудник</th>
                  {canDeleteExpense && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp) => {
                  const isWarranty = exp.source === 'warranty';
                  return (
                    <tr key={exp.id} className={isWarranty ? 'bg-amber-50/50' : ''}>
                      <td
                        className={`font-semibold whitespace-nowrap tabular-nums ${isWarranty ? 'text-amber-700' : 'text-gray-900'}`}
                      >
                        {formatCurrency(exp.amount)}
                      </td>
                      <td>
                        {isWarranty ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                            <ShieldAlert className="w-3 h-3" />
                            Гарантия (убыток)
                          </span>
                        ) : exp.categoryName ? (
                          <span className="text-[10px] font-semibold bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded-full">
                            {exp.categoryName}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="max-w-[320px] truncate text-gray-600" title={exp.description || undefined}>
                        {/* 149 — получатель «выплаты вне программы» перед описанием. */}
                        {exp.recipientName ? (
                          <>
                            <span className="font-semibold text-gray-700">→ {exp.recipientName}</span>
                            {exp.description ? ` · ${exp.description}` : ''}
                          </>
                        ) : (
                          exp.description || <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-gray-500">
                        {format(new Date(exp.date), 'dd.MM.yyyy', { locale: ru })}
                      </td>
                      <td className="text-gray-500">{exp.userName || '—'}</td>
                      {canDeleteExpense && (
                        <td>
                          {!isWarranty && (
                            <button
                              type="button"
                              aria-label="Удалить расход"
                              title="Удалить расход"
                              onClick={() => setDeleteId(exp.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </QueryState>

      {/* Закупка товара — справочный отток, НЕ влияет на прибыль (волна G).
          Показываем секцию только когда за период были оплаты поставщикам. */}
      {purchaseReport && purchaseReport.total > 0 && (
        <div className="card overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-gray-100 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600">
                <Truck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">Закупка товара</p>
                <p className="text-[11px] text-gray-500">Не влияет на прибыль</p>
              </div>
            </div>
            <span className="whitespace-nowrap text-lg font-bold text-slate-700 tabular-nums">
              {formatCurrency(purchaseReport.total)}
            </span>
          </div>
          <p className="flex items-start gap-1.5 border-b border-gray-100 px-4 py-2.5 text-xs leading-snug text-gray-500">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            Оплаты поставщикам за период — отток денег на закупку. В прибыль не входит: стоимость товара уже учтена в
            себестоимости при продаже.
          </p>
          {purchaseReport.items.length > 0 && (
            <div className="divide-y divide-gray-100">
              {purchaseReport.items.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800">{p.supplierName || 'Поставщик'}</p>
                    <p className="text-[11px] text-gray-500">
                      {format(new Date(p.date), 'dd.MM.yyyy', { locale: ru })}
                      {p.comment ? ` · ${p.comment}` : ''}
                    </p>
                  </div>
                  <span className="whitespace-nowrap text-sm font-semibold text-slate-700 tabular-nums">
                    {formatCurrency(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add expense modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Новый расход" size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Категория</label>
            <select
              className="input"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">Без категории</option>
              {categories.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Сумма</label>
            <input
              type="number"
              className="input"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0"
              min="0"
              step="0.01"
              required
            />
          </div>
          <div>
            <label className="label">Описание</label>
            <input
              type="text"
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Например: Аренда офиса за январь"
            />
          </div>
          <div>
            <label className="label">Дата</label>
            <input
              type="date"
              className="input"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={createMutation.isPending} className="btn-primary">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Добавить
            </button>
          </div>
        </form>
      </Modal>

      {/* Categories management modal */}
      <Modal isOpen={catModalOpen} onClose={() => setCatModalOpen(false)} title="Категории расходов" size="md">
        <div className="space-y-4">
          {/* Create */}
          <div className="rounded-xl border border-gray-200 p-3 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Новая категория (Аренда, Маркетинг...)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newCatName.trim())
                    createCatMutation.mutate({ name: newCatName.trim(), isRecurring: newCatRecurring });
                }}
              />
              <button
                onClick={() => {
                  if (newCatName.trim())
                    createCatMutation.mutate({ name: newCatName.trim(), isRecurring: newCatRecurring });
                }}
                disabled={!newCatName.trim() || createCatMutation.isPending}
                aria-label="Создать категорию"
                className="btn-primary px-3"
              >
                {createCatMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Repeat className="h-4 w-4 text-gray-400" /> Постоянный расход
              </span>
              <Switch checked={newCatRecurring} onChange={setNewCatRecurring} label="Постоянный расход" />
            </div>
            <p className="flex items-start gap-1.5 text-xs text-gray-500 leading-snug">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Оплаты идут в кассу, а в прибыли учитываются через План — равномерно по дням месяца.
            </p>
          </div>

          {/* List */}
          <div className="divide-y divide-gray-100">
            {categories.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">Нет категорий</p>
            ) : (
              categories.map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{c.name}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`hidden sm:inline text-xs ${c.isRecurring ? 'text-primary-600 font-medium' : 'text-gray-400'}`}
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
                  <button
                    type="button"
                    aria-label={`Удалить категорию ${c.name}`}
                    title="Удалить категорию"
                    onClick={() => deleteCatMutation.mutate(c.id)}
                    className="p-1 rounded text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
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
        message="Вы уверены, что хотите удалить этот расход?"
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
