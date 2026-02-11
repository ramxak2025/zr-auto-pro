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
} from 'lucide-react';
import { checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { Check, PaymentMethod } from '../types';
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
  transfer: 'Перевод',
  mixed: 'Смешанная',
};

const PAYMENT_BADGE_CLASSES: Record<string, string> = {
  cash: 'bg-green-50 text-green-700 border-green-200',
  card: 'bg-blue-50 text-blue-700 border-blue-200',
  transfer: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  mixed: 'bg-gray-50 text-gray-700 border-gray-200',
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
            <h1 className="text-2xl font-bold text-gray-900">
              Чек #{check.number}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              от {formatDate(check.date)}
            </p>
          </div>
        </div>

        {hasPermission('checks_delete') && (
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Удалить
          </button>
        )}
      </div>

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

      {/* Services table */}
      {check.services && check.services.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">Услуги</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">
                    Название
                  </th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">
                    Цена
                  </th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">
                    Кол-во
                  </th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">
                    Сумма
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {check.services.map((line, idx) => (
                  <tr key={line.id || idx}>
                    <td className="px-5 py-3 text-gray-900">{line.name}</td>
                    <td className="px-5 py-3 text-right text-gray-600">
                      {formatMoney(line.price)}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-600">
                      {line.quantity}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">
                      {formatMoney(line.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/50">
                  <td
                    colSpan={3}
                    className="px-5 py-3 text-right font-semibold text-gray-700"
                  >
                    Итого услуги:
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-gray-900">
                    {formatMoney(check.serviceTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Products table */}
      {check.products && check.products.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">Товары</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50">
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">
                    Название
                  </th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">
                    Цена продажи
                  </th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">
                    Кол-во
                  </th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">
                    Сумма
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {check.products.map((line, idx) => (
                  <tr key={line.id || idx}>
                    <td className="px-5 py-3 text-gray-900">{line.name}</td>
                    <td className="px-5 py-3 text-right text-gray-600">
                      {formatMoney(line.sellPrice)}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-600">
                      {line.quantity}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900">
                      {formatMoney(line.totalSell)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/50">
                  <td
                    colSpan={3}
                    className="px-5 py-3 text-right font-semibold text-gray-700"
                  >
                    Итого товары:
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-gray-900">
                    {formatMoney(check.productTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Financial summary */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
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
    </div>
  );
}
