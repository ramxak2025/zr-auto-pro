import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  Wallet,
  Tag,
  Loader2,
  X,
} from 'lucide-react';
import { format, startOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { expensesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import DatePeriodPicker from '../components/DatePeriodPicker';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

const formatCurrency = (value: number) =>
  Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD';

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isDirector = user?.role === 'director' || user?.role === 'superadmin';

  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [modalOpen, setModalOpen] = useState(false);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');

  const [form, setForm] = useState({
    categoryId: '',
    amount: '',
    description: '',
    date: today,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => { const res = await expensesApi.getCategories(); return res.data; },
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', dateFrom, dateTo],
    queryFn: async () => { const res = await expensesApi.getAll({ dateFrom, dateTo }); return res.data; },
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
    onError: () => toast.error('Ошибка при добавлении расхода'),
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
    mutationFn: (data: { name: string }) => expensesApi.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      toast.success('Категория создана');
      setNewCatName('');
      setCatModalOpen(false);
    },
    onError: () => toast.error('Ошибка при создании категории'),
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
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100">
            <Wallet className="h-5 w-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Расходы</h1>
            <p className="text-xs text-gray-400">Учёт расходов по статьям</p>
          </div>
        </div>
        {isDirector && (
          <div className="flex items-center gap-2">
            <button onClick={() => setCatModalOpen(true)} className="btn-secondary text-xs flex-1 sm:flex-none justify-center">
              <Tag className="w-3.5 h-3.5" /> Категории
            </button>
            <button onClick={() => setModalOpen(true)} className="btn-primary flex-1 sm:flex-none justify-center">
              <Plus className="w-4 h-4" /> Добавить
            </button>
          </div>
        )}
      </div>

      <DatePeriodPicker dateFrom={dateFrom} dateTo={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />

      {/* Summary */}
      <div className="rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 p-5 text-white">
        <p className="text-xs font-semibold text-white/70 uppercase tracking-wider">Итого расходов</p>
        <p className="text-3xl font-bold mt-1">{formatCurrency(totalExpenses)}</p>
      </div>

      {/* Category breakdown */}
      {categoryBreakdown.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">По категориям</p>
          </div>
          <div className="divide-y divide-gray-50">
            {categoryBreakdown.map((cat) => (
              <div key={cat.name} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-2 rounded-full bg-rose-400" />
                  <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                </div>
                <span className="text-sm font-bold text-gray-900">{formatCurrency(cat.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expenses list */}
      {isLoading ? (
        <LoadingSpinner />
      ) : expenses.length === 0 ? (
        <EmptyState icon={Wallet} title="Нет расходов" description="Добавьте расходы за выбранный период" />
      ) : (
        <div className="space-y-2">
          {expenses.map((exp: any) => (
            <div key={exp.id} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-bold text-gray-900">{formatCurrency(exp.amount)}</span>
                  {exp.categoryName && (
                    <span className="text-[10px] font-semibold bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded-full">{exp.categoryName}</span>
                  )}
                </div>
                {exp.description && <p className="text-xs text-gray-500 truncate">{exp.description}</p>}
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {format(new Date(exp.date), 'dd.MM.yyyy', { locale: ru })}
                  {exp.userName ? ` · ${exp.userName}` : ''}
                </p>
              </div>
              {isDirector && (
                <button
                  onClick={() => setDeleteId(exp.id)}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
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
                <option key={c.id} value={c.id}>{c.name}</option>
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
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Отмена</button>
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
          <div className="flex gap-2">
            <input
              type="text"
              className="input flex-1"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Новая категория (Аренда, Маркетинг...)"
            />
            <button
              onClick={() => {
                if (newCatName.trim()) createCatMutation.mutate({ name: newCatName.trim() });
              }}
              disabled={!newCatName.trim() || createCatMutation.isPending}
              className="btn-primary px-3"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {categories.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">Нет категорий</p>
            ) : (
              categories.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-medium text-gray-800">{c.name}</span>
                  <button
                    onClick={() => deleteCatMutation.mutate(c.id)}
                    className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors"
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
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
        title="Удалить расход"
        message="Вы уверены, что хотите удалить этот расход?"
        confirmText="Удалить"
        variant="danger"
      />
    </div>
  );
}
