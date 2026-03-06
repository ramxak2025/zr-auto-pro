import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Trash2,
  Calendar,
  UserIcon,
  Car,
  Gauge,
  Wrench,
  MessageSquare,
  CheckCircle2,
  Clock,
  CreditCard,
  Banknote,
  TrendingUp,
  ChevronRight,
  ChevronDown,
  Package,
  ShieldCheck,
  Pencil,
  Printer,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { checksApi, myCompanyApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ConfirmDialog from '../components/ConfirmDialog';
import type { Check, Tenant } from '../types';
import { generateReceiptPdf } from '../utils/generateReceiptPdf';
import { formatMoney, paymentMethodLabels } from '../../../shared/utils/formatters';

const paymentMethodIcons: Record<string, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  warranty: ShieldCheck,
  cash_card: CreditCard,
};

const paymentMethodColors: Record<string, string> = {
  cash: 'text-green-600 bg-green-50',
  card: 'text-blue-600 bg-blue-50',
  warranty: 'text-yellow-600 bg-yellow-50',
  cash_card: 'text-gray-600 bg-gray-100',
};

export default function CheckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(true);
  const [productsOpen, setProductsOpen] = useState(true);

  const { data: check, isLoading } = useQuery<Check>({
    queryKey: ['check', id],
    queryFn: async () => {
      const res = await checksApi.getById(id!);
      return res.data;
    },
    enabled: !!id,
  });

  const { data: company } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
    staleTime: 5 * 60_000,
  });

  const finalizeMutation = useMutation({
    mutationFn: () => checksApi.update(id!, { isDeferred: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check', id] });
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Чек завершён');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Ошибка при завершении чека');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => checksApi.remove(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Чек удалён');
      navigate('/checks');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Ошибка при удалении');
    },
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!check) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">{'Чек не найден'}</p>
        <button onClick={() => navigate('/checks')} className="btn-primary mt-4">
          {'Назад к чекам'}
        </button>
      </div>
    );
  }

  const PaymentIcon = paymentMethodIcons[check.paymentMethod] ?? CreditCard;

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/checks')} className="btn-ghost btn-sm flex-shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="page-title whitespace-nowrap">
                {'Чек'} #{check.number}
              </h1>
              {check.isDeferred && (
                <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Отложен</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-400 mt-0.5">
              <Calendar className="w-3.5 h-3.5" />
              <span>{format(new Date(check.date), 'd MMMM yyyy', { locale: ru })}</span>
              <span className="text-gray-300">·</span>
              <Clock className="w-3.5 h-3.5" />
              <span>{format(new Date(check.date), 'HH:mm', { locale: ru })}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Print receipt */}
          <button
            onClick={() => generateReceiptPdf(check, company || user?.tenant)}
            className="p-2.5 rounded-xl text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
            title="Печать чека"
          >
            <Printer className="w-4 h-4" />
          </button>
          {check.isDeferred && (
            <>
              <button
                type="button"
                onClick={() => navigate(`/checks/${check.id}/edit`)}
                className="flex items-center gap-2 rounded-xl bg-primary-50 px-4 py-2.5 text-sm font-semibold text-primary-600 hover:bg-primary-100 transition-colors"
              >
                <Pencil className="w-4 h-4" />
                <span className="hidden sm:inline">Редактировать</span>
              </button>
              <button
                type="button"
                onClick={() => finalizeMutation.mutate()}
                disabled={finalizeMutation.isPending}
                className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span className="hidden sm:inline">Завершить</span>
              </button>
            </>
          )}
          {hasPermission('checks_delete') && !(user?.role === 'master' && check.isDeferred) && (
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="p-2.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Удалить чек"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Deferred check banner */}
      {check.isDeferred && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-700">Чек отложен (черновик)</p>
          <p className="text-xs text-red-500 mt-0.5">Не учитывается в статистике. Нажмите «Редактировать» чтобы дописать услуги или товары.</p>
        </div>
      )}

      {/* Info cards - Client, Car, Master, Mileage */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Client card - clickable */}
        {check.clientId ? (
          <Link
            to={`/clients/${check.clientId}`}
            className="stat-card animate-fade-in-up group hover:border-primary-200 hover:shadow-md transition-all"
            style={{ animationDelay: '0ms' }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <UserIcon className="w-3.5 h-3.5 text-blue-500" />
                </div>
                <span className="stat-label">{'Клиент'}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary-400 transition-colors" />
            </div>
            <p className="text-sm font-semibold text-gray-900 truncate">{check.client?.fullName ?? '—'}</p>
            {check.client?.phone && (
              <p className="text-xs text-gray-400 mt-0.5">{check.client.phone}</p>
            )}
          </Link>
        ) : (
          <div className="stat-card animate-fade-in-up" style={{ animationDelay: '0ms' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center">
                <UserIcon className="w-3.5 h-3.5 text-gray-400" />
              </div>
              <span className="stat-label">{'Клиент'}</span>
            </div>
            <p className="text-sm font-semibold text-gray-900">{'Розничный покупатель'}</p>
          </div>
        )}

        {/* Car card - clickable via client */}
        {check.car ? (
          <Link
            to={check.clientId ? `/clients/${check.clientId}` : '#'}
            className={`stat-card animate-fade-in-up group transition-all ${
              check.clientId ? 'hover:border-primary-200 hover:shadow-md' : ''
            }`}
            style={{ animationDelay: '80ms' }}
            onClick={(e) => { if (!check.clientId) e.preventDefault(); }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
                  <Car className="w-3.5 h-3.5 text-violet-500" />
                </div>
                <span className="stat-label">{'Автомобиль'}</span>
              </div>
              {check.clientId && (
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary-400 transition-colors" />
              )}
            </div>
            <p className="text-sm font-semibold text-gray-900 truncate">{check.car.makeModel}</p>
            {check.car.plateNumber && (
              <p className="text-xs text-gray-400 mt-0.5">{check.car.plateNumber}</p>
            )}
          </Link>
        ) : (
          <div className="stat-card animate-fade-in-up" style={{ animationDelay: '80ms' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center">
                <Car className="w-3.5 h-3.5 text-gray-400" />
              </div>
              <span className="stat-label">{'Автомобиль'}</span>
            </div>
            <p className="text-sm font-semibold text-gray-500">{'—'}</p>
          </div>
        )}

        {/* Master card */}
        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '160ms' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
              <Wrench className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <span className="stat-label">{'Мастер'}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900">{check.master?.fullName ?? '—'}</p>
        </div>

        {/* Mileage card */}
        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '240ms' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Gauge className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <span className="stat-label">{'Пробег'}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900">
            {check.mileage ? `${check.mileage.toLocaleString('ru-RU')} км` : '—'}
          </p>
        </div>
      </div>

      {/* Services - Accordion */}
      {check.services && check.services.length > 0 && (
        <div className="card overflow-hidden animate-fade-in-up" style={{ animationDelay: '320ms' }}>
          <button
            type="button"
            onClick={() => setServicesOpen(!servicesOpen)}
            className="w-full flex items-center justify-between px-4 py-3 sm:px-5 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900">{'Услуги'}</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{check.services.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">{formatMoney(check.serviceTotal)}</span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>
          {servicesOpen && (
            <div className="border-t border-gray-100">
              {/* Mobile: card layout */}
              <div className="sm:hidden divide-y divide-gray-50">
                {check.services.map((svc, idx) => (
                  <div key={svc.id ?? idx} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{svc.name}</p>
                        {svc.master?.fullName && (
                          <p className="text-xs text-gray-400 mt-0.5">{svc.master.fullName}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-gray-900">{formatMoney(svc.total)}</p>
                        {svc.quantity > 1 && (
                          <p className="text-xs text-gray-400">{svc.quantity} x {formatMoney(svc.price)}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden sm:block">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>{'Название'}</th>
                      <th>{'Мастер'}</th>
                      <th className="text-right">{'Цена'}</th>
                      <th className="text-center w-16">{'Кол-во'}</th>
                      <th className="text-right">{'Итого'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.services.map((svc, idx) => (
                      <tr key={svc.id ?? idx}>
                        <td className="text-gray-400">{idx + 1}</td>
                        <td className="font-medium">{svc.name}</td>
                        <td className="text-gray-600">{svc.master?.fullName ?? '—'}</td>
                        <td className="text-right text-gray-600">{formatMoney(svc.price)}</td>
                        <td className="text-center text-gray-600">{svc.quantity}</td>
                        <td className="text-right font-semibold">{formatMoney(svc.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Products - Accordion */}
      {check.products && check.products.length > 0 && (
        <div className="card overflow-hidden animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <button
            type="button"
            onClick={() => setProductsOpen(!productsOpen)}
            className="w-full flex items-center justify-between px-4 py-3 sm:px-5 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-900">{'Товары'}</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{check.products.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">{formatMoney(check.productTotal)}</span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${productsOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>
          {productsOpen && (
            <div className="border-t border-gray-100">
              {/* Mobile: card layout */}
              <div className="sm:hidden divide-y divide-gray-50">
                {check.products.map((prod, idx) => (
                  <div key={prod.id ?? idx} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{prod.name}</p>
                        {prod.quantity > 1 && (
                          <p className="text-xs text-gray-400 mt-0.5">{prod.quantity} x {formatMoney(prod.sellPrice)}</p>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900 flex-shrink-0">{formatMoney(prod.totalSell)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden sm:block">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>{'Название'}</th>
                      <th className="text-right">{'Цена'}</th>
                      <th className="text-center w-16">{'Кол-во'}</th>
                      <th className="text-right">{'Итого'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.products.map((prod, idx) => (
                      <tr key={prod.id ?? idx}>
                        <td className="text-gray-400">{idx + 1}</td>
                        <td className="font-medium">{prod.name}</td>
                        <td className="text-right text-gray-600">{formatMoney(prod.sellPrice)}</td>
                        <td className="text-center text-gray-600">{prod.quantity}</td>
                        <td className="text-right font-semibold">{formatMoney(prod.totalSell)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary & Payment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Financial summary */}
        <div className="card card-body animate-fade-in-up" style={{ animationDelay: '480ms' }}>
          <h2 className="text-base font-semibold text-gray-900 mb-4">{'Итого'}</h2>
          <div className="space-y-2.5">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{'Услуги'}</span>
              <span className="font-medium">{formatMoney(check.serviceTotal)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{'Товары'}</span>
              <span className="font-medium">{formatMoney(check.productTotal)}</span>
            </div>
            {(check.discount ?? 0) > 0 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">{'Скидка на товары'}</span>
                <span className="font-medium text-orange-500">-{formatMoney(check.discount ?? 0)}</span>
              </div>
            )}
            <div className="border-t border-gray-100 pt-2.5 mt-2.5">
              <div className="flex justify-between items-center">
                <span className="text-base font-bold text-gray-900">{'Выручка'}</span>
                <span className="text-lg font-bold text-primary-600">{formatMoney(check.totalRevenue)}</span>
              </div>
            </div>

            {hasPermission('profit_view') && (
              <div className="border-t border-dashed border-gray-200 pt-3 mt-3 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">{'Себестоимость товаров'}</span>
                  <span className="text-gray-500">{formatMoney(check.productCostTotal)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400">{'Зарплата мастеров'}</span>
                  <span className="text-gray-500">{formatMoney(check.serviceSalaryTotal)}</span>
                </div>
                <div className="flex justify-between items-center pt-1.5">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-bold text-gray-700">{'Чистая прибыль'}</span>
                  </div>
                  <span className={`text-base font-bold ${check.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {check.profit >= 0 ? '+' : ''}{formatMoney(check.profit)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Payment method card */}
        <div className="card card-body animate-fade-in-up" style={{ animationDelay: '560ms' }}>
          <h2 className="text-base font-semibold text-gray-900 mb-4">{'Оплата'}</h2>
          <div className={`inline-flex items-center gap-2.5 rounded-xl px-4 py-3 ${paymentMethodColors[check.paymentMethod] ?? 'text-gray-600 bg-gray-100'}`}>
            <PaymentIcon className="w-5 h-5" />
            <span className="text-sm font-semibold">{paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}</span>
          </div>
          {check.paymentMethod === 'cash_card' && (check.cashAmount > 0 || check.cardAmount > 0) && (
            <div className="mt-4 space-y-2.5">
              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <Banknote className="w-4 h-4" />
                  <span>{'Наличные'}</span>
                </div>
                <span className="font-medium">{formatMoney(check.cashAmount)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  <CreditCard className="w-4 h-4" />
                  <span>{'Карта'}</span>
                </div>
                <span className="font-medium">{formatMoney(check.cardAmount)}</span>
              </div>
            </div>
          )}

          {/* Comment */}
          {check.comment && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-gray-700">{'Комментарий'}</span>
              </div>
              <p className="text-sm text-amber-700 whitespace-pre-wrap bg-amber-50 rounded-lg p-3 border border-amber-100">{check.comment}</p>
            </div>
          )}
        </div>
      </div>

      {/* Back button */}
      <div className="flex justify-start pt-2">
        <button onClick={() => navigate('/checks')} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" />
          {'Назад к чекам'}
        </button>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={'Удалить чек'}
        message={`Вы уверены, что хотите удалить чек #${check.number}? Это действие нельзя отменить.`}
        confirmText={'Удалить'}
        variant="danger"
      />
    </div>
  );
}
