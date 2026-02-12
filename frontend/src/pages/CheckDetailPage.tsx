import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Trash2,
  CalendarDays,
  User,
  Car,
  Gauge,
  CreditCard,
  MessageSquare,
  Loader2,
  Printer,
  Pause,
  Banknote,
  ShieldCheck,
  Clock,
  Pencil,
  CheckCircle2,
  Save,
} from 'lucide-react';
import { checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { Check, PaymentMethod } from '../types';
import { PaymentMethod as PM } from '../types';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' \u20BD';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'По гарантии',
  cash_card: 'Нал + Карта',
};

const PAYMENT_BADGE_CLASSES: Record<string, string> = {
  cash: 'bg-green-50 text-green-700 border-green-200',
  card: 'bg-blue-50 text-blue-700 border-blue-200',
  warranty: 'bg-orange-50 text-orange-700 border-orange-200',
  cash_card: 'bg-purple-50 text-purple-700 border-purple-200',
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CheckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editComment, setEditComment] = useState('');
  const [editDiscount, setEditDiscount] = useState('');
  const [splitMode, setSplitMode] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');

  // ---- Queries ----

  const {
    data: check,
    isLoading,
    isError,
  } = useQuery<Check>({
    queryKey: ['check', id],
    queryFn: async () => {
      const res = await checksApi.getById(id!);
      return res.data;
    },
    enabled: !!id,
  });

  // ---- Mutations ----

  const deleteMutation = useMutation({
    mutationFn: () => checksApi.delete(id!),
    onSuccess: () => {
      toast.success('Чек удалён');
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      navigate('/checks');
    },
    onError: () => {
      toast.error('Не удалось удалить чек');
    },
  });

  const payMutation = useMutation({
    mutationFn: (data: { paymentMethod: PaymentMethod; isDeferred: boolean; cashAmount?: number; cardAmount?: number }) =>
      checksApi.update(id!, data),
    onSuccess: () => {
      toast.success('Чек оплачен');
      queryClient.invalidateQueries({ queryKey: ['check', id] });
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      setShowPaymentModal(false);
      setSplitMode(false);
    },
    onError: () => toast.error('Не удалось обновить чек'),
  });

  const editMutation = useMutation({
    mutationFn: (data: { comment?: string; discount?: number }) =>
      checksApi.update(id!, data),
    onSuccess: () => {
      toast.success('Чек обновлён');
      queryClient.invalidateQueries({ queryKey: ['check', id] });
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      setShowEditModal(false);
    },
    onError: () => toast.error('Не удалось обновить чек'),
  });

  function handlePayment(method: PaymentMethod, cashAmt?: number, cardAmt?: number) {
    payMutation.mutate({
      paymentMethod: method,
      isDeferred: false,
      cashAmount: cashAmt,
      cardAmount: cardAmt,
    });
  }

  function handleEditSave() {
    editMutation.mutate({
      comment: editComment.trim() || undefined,
      discount: parseFloat(editDiscount) || undefined,
    });
  }

  // ---- Render ----

  if (isLoading) return <LoadingSpinner />;

  if (isError || !check) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/checks')}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад к чекам
        </button>
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="text-sm">Чек не найден</p>
        </div>
      </div>
    );
  }

  const paymentLabel = PAYMENT_LABELS[check.paymentMethod] || check.paymentMethod;
  const paymentBadgeClass =
    PAYMENT_BADGE_CLASSES[check.paymentMethod] || PAYMENT_BADGE_CLASSES.cash;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/checks')}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-base md:text-lg font-bold text-gray-900">
              Чек #{check.number}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              от {formatDate(check.date)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => {
              const url = checksApi.getPrintUrl(id!);
              const token = localStorage.getItem('token');
              window.open(`${url}?token=${token}`, '_blank');
            }}
            className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 h-9 w-9 sm:w-auto sm:px-4 sm:py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Printer className="h-4 w-4" />
            <span className="hidden sm:inline">Печать</span>
          </button>

          {hasPermission('checks_delete') && (
            <button
              onClick={() => setDeleteOpen(true)}
              className="flex items-center justify-center gap-2 rounded-lg border border-red-300 h-9 w-9 sm:w-auto sm:px-4 sm:py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Удалить</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Deferred check banner ── */}
      {check.isDeferred && (
        <div className="rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
              <Pause className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-900">Чек отложен</h3>
              <p className="text-xs text-amber-600">Выберите действие для продолжения</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setEditComment(check.comment || '');
                setEditDiscount(check.discount?.toString() || '');
                setShowEditModal(true);
              }}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-amber-300 bg-white px-4 py-3 text-sm font-semibold text-amber-800 hover:bg-amber-50 active:scale-[0.98] transition-all"
            >
              <Pencil className="h-4 w-4" />
              Изменить
            </button>
            <button
              type="button"
              onClick={() => { setShowPaymentModal(true); setSplitMode(false); setCashAmount(''); setCardAmount(''); }}
              className="flex-[1.5] flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
            >
              <CheckCircle2 className="h-4 w-4" />
              Перейти к оплате
            </button>
          </div>
        </div>
      )}

      {/* Info card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Дата</p>
              <p className="text-sm font-medium text-gray-900">
                {formatDate(check.date)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <User className="h-5 w-5 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Мастер</p>
              <p className="text-sm font-medium text-gray-900">
                {check.master?.fullName || '\u2014'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <User className="h-5 w-5 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Клиент</p>
              {check.client ? (
                <Link
                  to={`/clients/${check.clientId}`}
                  className="text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
                >
                  {check.client.fullName}
                </Link>
              ) : (
                <p className="text-sm text-gray-900">{'\u2014'}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Car className="h-5 w-5 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Автомобиль</p>
              <p className="text-sm font-medium text-gray-900">
                {check.car
                  ? `${check.car.plateNumber} ${check.car.makeModel}`
                  : '\u2014'}
              </p>
            </div>
          </div>

          {check.mileage !== undefined && check.mileage !== null && (
            <div className="flex items-center gap-3">
              <Gauge className="h-5 w-5 text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Пробег</p>
                <p className="text-sm font-medium text-gray-900">
                  {check.mileage.toLocaleString('ru-RU')} км
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">Оплата</p>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${paymentBadgeClass}`}
              >
                {paymentLabel}
              </span>
            </div>
          </div>

          {check.comment && (
            <div className="flex items-start gap-3 sm:col-span-2 lg:col-span-3">
              <MessageSquare className="h-5 w-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-xs text-gray-500">Комментарий</p>
                <p className="text-sm text-gray-700">{check.comment}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Services */}
      {check.services && check.services.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-200">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900">Услуги</h2>
          </div>
          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-gray-50">
            {check.services.map((line, idx) => (
              <div key={line.id || idx} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0 flex-1 mr-3">
                  <p className="text-sm text-gray-900 truncate">{line.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatMoney(line.price)} x {line.quantity}</p>
                </div>
                <span className="text-sm font-semibold text-gray-900 flex-shrink-0">{formatMoney(line.total)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50/50">
              <span className="text-sm font-semibold text-gray-700">Итого услуги</span>
              <span className="text-sm font-bold text-gray-900">{formatMoney(check.serviceTotal)}</span>
            </div>
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Название</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Цена</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Кол-во</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {check.services.map((line, idx) => (
                  <tr key={line.id || idx}>
                    <td className="px-5 py-3 text-gray-900">{line.name}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{formatMoney(line.price)}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{line.quantity}</td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">{formatMoney(line.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/50">
                  <td colSpan={3} className="px-5 py-3 text-right font-semibold text-gray-700">Итого услуги:</td>
                  <td className="px-5 py-3 text-right font-bold text-gray-900">{formatMoney(check.serviceTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Products */}
      {check.products && check.products.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-200">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900">Товары</h2>
          </div>
          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-gray-50">
            {check.products.map((line, idx) => (
              <div key={line.id || idx} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0 flex-1 mr-3">
                  <p className="text-sm text-gray-900 truncate">{line.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatMoney(line.sellPrice)} x {line.quantity}</p>
                </div>
                <span className="text-sm font-semibold text-gray-900 flex-shrink-0">{formatMoney(line.totalSell)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50/50">
              <span className="text-sm font-semibold text-gray-700">Итого товары</span>
              <span className="text-sm font-bold text-gray-900">{formatMoney(check.productTotal)}</span>
            </div>
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Название</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Цена</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Кол-во</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {check.products.map((line, idx) => (
                  <tr key={line.id || idx}>
                    <td className="px-5 py-3 text-gray-900">{line.name}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{formatMoney(line.sellPrice)}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{line.quantity}</td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">{formatMoney(line.totalSell)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/50">
                  <td colSpan={3} className="px-5 py-3 text-right font-semibold text-gray-700">Итого товары:</td>
                  <td className="px-5 py-3 text-right font-bold text-gray-900">{formatMoney(check.productTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Financial summary */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm">
        <h2 className="text-sm sm:text-base font-semibold text-gray-900 mb-3 sm:mb-4">
          Финансовая сводка
        </h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Услуги</span>
            <span className="font-medium text-gray-900">
              {formatMoney(check.serviceTotal)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Товары</span>
            <span className="font-medium text-gray-900">
              {formatMoney(check.productTotal)}
            </span>
          </div>
          <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
            <span className="text-base font-semibold text-gray-900">
              Общая выручка
            </span>
            <span className="text-lg font-bold text-gray-900">
              {formatMoney(check.totalRevenue)}
            </span>
          </div>

          {hasPermission('profit_view') && (
            <>
              <div className="border-t border-gray-200 pt-3 space-y-2">
                <div className="flex items-center justify-between text-gray-500">
                  <span>Себестоимость товаров</span>
                  <span>{formatMoney(check.productCostTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-gray-500">
                  <span>Зарплата мастера</span>
                  <span>{formatMoney(check.serviceSalaryTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-gray-500">
                  <span>Общие расходы</span>
                  <span>{formatMoney(check.totalCost)}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <span className="font-semibold text-gray-900">Прибыль</span>
                  <span
                    className={`text-lg font-bold ${
                      check.profit >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {formatMoney(check.profit)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Удалить чек"
        message={`Вы уверены, что хотите удалить чек #${check.number}? Это действие нельзя отменить.`}
        confirmText="Удалить"
        variant="danger"
      />

      {/* ── Payment modal for deferred checks ── */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !payMutation.isPending && setShowPaymentModal(false)} />
          <div className="relative w-full md:max-w-sm bg-white rounded-t-3xl md:rounded-2xl overflow-hidden">
            <div className="flex justify-center pt-3 pb-1 md:hidden">
              <div className="w-10 h-1 bg-gray-200 rounded-full" />
            </div>
            <div className="px-6 pt-4 pb-3 text-center">
              <h3 className="text-lg font-bold text-gray-900">Оплата чека #{check.number}</h3>
              <p className="text-2xl font-bold text-primary-600 mt-1">{formatMoney(check.totalRevenue)}</p>
            </div>

            {splitMode ? (
              <div className="px-6 pb-6 space-y-4">
                <p className="text-xs font-semibold text-purple-600 uppercase tracking-wider">Разделение оплаты</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
                      <Banknote className="h-3 w-3" />Наличные
                    </label>
                    <input type="number" value={cashAmount}
                      onChange={(e) => {
                        setCashAmount(e.target.value);
                        const cash = parseFloat(e.target.value) || 0;
                        const remaining = Math.max(0, check.totalRevenue - cash);
                        setCardAmount(remaining > 0 ? remaining.toString() : '');
                      }}
                      min="0" placeholder="0 ₽"
                      className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500/10" />
                  </div>
                  <div>
                    <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
                      <CreditCard className="h-3 w-3" />Карта
                    </label>
                    <input type="number" value={cardAmount}
                      onChange={(e) => {
                        setCardAmount(e.target.value);
                        const card = parseFloat(e.target.value) || 0;
                        const remaining = Math.max(0, check.totalRevenue - card);
                        setCashAmount(remaining > 0 ? remaining.toString() : '');
                      }}
                      min="0" placeholder="0 ₽"
                      className="block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm placeholder-gray-400 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500/10" />
                  </div>
                </div>
                <button type="button" onClick={() => handlePayment(PM.CASH_CARD, parseFloat(cashAmount) || 0, parseFloat(cardAmount) || 0)}
                  disabled={payMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-700 py-3.5 text-sm font-bold text-white shadow-lg active:scale-[0.98] disabled:opacity-50">
                  {payMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Подтвердить
                </button>
                <button type="button" onClick={() => setSplitMode(false)} disabled={payMutation.isPending}
                  className="w-full text-center text-sm text-gray-500 hover:text-gray-700 py-1">
                  Назад
                </button>
              </div>
            ) : (
              <div className="px-5 pb-6 space-y-2">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1 mb-1">Способ оплаты</p>

                <button type="button" onClick={() => handlePayment(PM.CASH)} disabled={payMutation.isPending}
                  className="flex items-center gap-3 w-full rounded-2xl bg-green-50 hover:bg-green-100 px-4 py-3.5 transition-colors disabled:opacity-50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100">
                    <Banknote className="h-5 w-5 text-green-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-900">Наличные</span>
                </button>

                <button type="button" onClick={() => handlePayment(PM.CARD)} disabled={payMutation.isPending}
                  className="flex items-center gap-3 w-full rounded-2xl bg-blue-50 hover:bg-blue-100 px-4 py-3.5 transition-colors disabled:opacity-50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                    <CreditCard className="h-5 w-5 text-blue-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-900">Карта</span>
                </button>

                <button type="button" onClick={() => handlePayment(PM.WARRANTY)} disabled={payMutation.isPending}
                  className="flex items-center gap-3 w-full rounded-2xl bg-orange-50 hover:bg-orange-100 px-4 py-3.5 transition-colors disabled:opacity-50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100">
                    <ShieldCheck className="h-5 w-5 text-orange-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-900">Гарантия</span>
                </button>

                <button type="button" onClick={() => setSplitMode(true)} disabled={payMutation.isPending}
                  className="flex items-center gap-3 w-full rounded-2xl bg-purple-50 hover:bg-purple-100 px-4 py-3.5 transition-colors disabled:opacity-50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100">
                    <CreditCard className="h-5 w-5 text-purple-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-900">Нал + Карта</span>
                </button>

                <button type="button" onClick={() => setShowPaymentModal(false)} disabled={payMutation.isPending}
                  className="w-full text-center text-sm text-gray-400 hover:text-gray-600 py-2 mt-1">
                  Отмена
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit modal for deferred checks ── */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !editMutation.isPending && setShowEditModal(false)} />
          <div className="relative w-full md:max-w-md bg-white rounded-t-3xl md:rounded-2xl overflow-hidden">
            <div className="flex justify-center pt-3 pb-1 md:hidden">
              <div className="w-10 h-1 bg-gray-200 rounded-full" />
            </div>
            <div className="px-6 pt-4 pb-3">
              <h3 className="text-lg font-bold text-gray-900">Изменить чек #{check.number}</h3>
            </div>
            <div className="px-6 pb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Комментарий</label>
                <textarea value={editComment} onChange={(e) => setEditComment(e.target.value)}
                  rows={3} placeholder="Опишите работу, пожелания..."
                  className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Скидка, ₽</label>
                <input type="number" value={editDiscount} onChange={(e) => setEditDiscount(e.target.value)}
                  min="0" placeholder="0"
                  className="block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowEditModal(false)} disabled={editMutation.isPending}
                  className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  Отмена
                </button>
                <button type="button" onClick={handleEditSave} disabled={editMutation.isPending}
                  className="flex-[1.5] flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-700 disabled:opacity-50">
                  {editMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
