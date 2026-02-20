import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ConfirmDialog from '../components/ConfirmDialog';
import type { Check } from '../types';

const paymentMethodLabels: Record<string, string> = {
  cash: '\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435',
  card: '\u041A\u0430\u0440\u0442\u0430',
  warranty: '\u0413\u0430\u0440\u0430\u043D\u0442\u0438\u044F',
  cash_card: '\u041D\u0430\u043B/\u041A\u0430\u0440\u0442\u0430',
};

const paymentMethodBadge: Record<string, string> = {
  cash: 'badge-green',
  card: 'badge-blue',
  warranty: 'badge-yellow',
  cash_card: 'badge-gray',
};

const formatCurrency = (value: number): string => {
  return value.toLocaleString('ru-RU') + ' \u20BD';
};

export default function CheckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: check, isLoading } = useQuery<Check>({
    queryKey: ['check', id],
    queryFn: async () => {
      const res = await checksApi.getById(id!);
      return res.data;
    },
    enabled: !!id,
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
      toast.success('\u0427\u0435\u043A \u0443\u0434\u0430\u043B\u0435\u043D');
      navigate('/checks');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0438');
    },
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!check) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">{'\u0427\u0435\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D'}</p>
        <button onClick={() => navigate('/checks')} className="btn-primary mt-4">
          {'\u041D\u0430\u0437\u0430\u0434 \u043A \u0447\u0435\u043A\u0430\u043C'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/checks')} className="btn-ghost btn-sm">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="page-title">
                {'\u0427\u0435\u043A'} #{check.number}
              </h1>
              <span className={paymentMethodBadge[check.paymentMethod] ?? 'badge-gray'}>
                {paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}
              </span>
              {check.isDeferred && (
                <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Отложен</span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              <Calendar className="w-3.5 h-3.5 inline mr-1" />
              {format(new Date(check.date), 'd MMMM yyyy', { locale: ru })}
            </p>
          </div>
        </div>
        {hasPermission('checks_delete') && !(user?.role === 'master' && check.isDeferred) && (
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="btn-danger btn-sm"
          >
            <Trash2 className="w-4 h-4" />
            {'\u0423\u0434\u0430\u043B\u0438\u0442\u044C'}
          </button>
        )}
      </div>

      {/* Deferred check banner */}
      {check.isDeferred && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-red-700">Чек отложен (черновик)</p>
            <p className="text-xs text-red-500 mt-0.5">Не учитывается в статистике. Нельзя закрыть смену пока чек отложен.</p>
          </div>
          <button
            type="button"
            onClick={() => finalizeMutation.mutate()}
            disabled={finalizeMutation.isPending}
            className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 flex-shrink-0"
          >
            <CheckCircle2 className="w-4 h-4" />
            Завершить
          </button>
        </div>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '0ms' }}>
          <div className="flex items-center gap-2 mb-1">
            <UserIcon className="w-4 h-4 text-gray-400" />
            <span className="stat-label">{'\u041A\u043B\u0438\u0435\u043D\u0442'}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900">{check.client?.fullName ?? '\u0420\u043E\u0437\u043D\u0438\u0447\u043D\u044B\u0439 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C'}</p>
          {check.client?.phone && (
            <p className="text-xs text-gray-400 mt-0.5">{check.client.phone}</p>
          )}
        </div>

        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center gap-2 mb-1">
            <Car className="w-4 h-4 text-gray-400" />
            <span className="stat-label">{'\u0410\u0432\u0442\u043E\u043C\u043E\u0431\u0438\u043B\u044C'}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900">{check.car?.makeModel ?? '\u2014'}</p>
          {check.car?.plateNumber && (
            <p className="text-xs text-gray-400 mt-0.5">{check.car.plateNumber}</p>
          )}
        </div>

        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <div className="flex items-center gap-2 mb-1">
            <Wrench className="w-4 h-4 text-gray-400" />
            <span className="stat-label">{'\u041C\u0430\u0441\u0442\u0435\u0440'}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900">{check.master?.fullName ?? '\u2014'}</p>
        </div>

        <div className="stat-card animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          <div className="flex items-center gap-2 mb-1">
            <Gauge className="w-4 h-4 text-gray-400" />
            <span className="stat-label">{'\u041F\u0440\u043E\u0431\u0435\u0433'}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900">
            {check.mileage ? `${check.mileage.toLocaleString('ru-RU')} \u043A\u043C` : '\u2014'}
          </p>
        </div>
      </div>

      {/* Services Table */}
      {check.services && check.services.length > 0 && (
        <div className="animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">{'\u0423\u0441\u043B\u0443\u0433\u0438'}</h2>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{'\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435'}</th>
                  <th>{'\u041C\u0430\u0441\u0442\u0435\u0440'}</th>
                  <th>{'\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C'}</th>
                </tr>
              </thead>
              <tbody>
                {check.services.map((svc, idx) => (
                  <tr key={svc.id ?? idx}>
                    <td>{idx + 1}</td>
                    <td className="font-medium">{svc.name}</td>
                    <td>{svc.master?.fullName ?? '\u2014'}</td>
                    <td className="font-semibold">{formatCurrency(svc.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Products Table */}
      {check.products && check.products.length > 0 && (
        <div className="animate-fade-in-up" style={{ animationDelay: '500ms' }}>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">{'\u0422\u043E\u0432\u0430\u0440\u044B'}</h2>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{'\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435'}</th>
                  <th>{'\u0426\u0435\u043D\u0430'}</th>
                  <th>{'\u041A\u043E\u043B-\u0432\u043E'}</th>
                  <th>{'\u0418\u0442\u043E\u0433\u043E'}</th>
                </tr>
              </thead>
              <tbody>
                {check.products.map((prod, idx) => (
                  <tr key={prod.id ?? idx}>
                    <td>{idx + 1}</td>
                    <td className="font-medium">{prod.name}</td>
                    <td>{formatCurrency(prod.sellPrice)}</td>
                    <td>{prod.quantity}</td>
                    <td className="font-semibold">{formatCurrency(prod.totalSell)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="card card-body animate-fade-in-up" style={{ animationDelay: '600ms' }}>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">{'\u0418\u0442\u043E\u0433\u043E'}</h2>
        <div className="space-y-2 max-w-sm">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">{'\u0423\u0441\u043B\u0443\u0433\u0438:'}</span>
            <span className="font-medium">{formatCurrency(check.serviceTotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">{'\u0422\u043E\u0432\u0430\u0440\u044B:'}</span>
            <span className="font-medium">{formatCurrency(check.productTotal)}</span>
          </div>
          {(check.discount ?? 0) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">{'\u0421\u043A\u0438\u0434\u043A\u0430:'}</span>
              <span className="font-medium text-red-500">-{formatCurrency(check.discount ?? 0)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold border-t pt-2">
            <span>{'\u0412\u044B\u0440\u0443\u0447\u043A\u0430:'}</span>
            <span className="text-primary-600">{formatCurrency(check.totalRevenue)}</span>
          </div>
          {check.paymentMethod === 'cash_card' && (check.cashAmount > 0 || check.cardAmount > 0) && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{'\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435:'}</span>
                <span className="font-medium">{formatCurrency(check.cashAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">{'\u041A\u0430\u0440\u0442\u0430:'}</span>
                <span className="font-medium">{formatCurrency(check.cardAmount)}</span>
              </div>
            </>
          )}
          {hasPermission('profit_view') && (
            <div className="flex justify-between text-sm border-t pt-2">
              <span className="text-gray-500">{'\u041F\u0440\u0438\u0431\u044B\u043B\u044C:'}</span>
              <span className={`font-semibold ${check.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(check.profit)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Comment */}
      {check.comment && (
        <div className="card card-body animate-fade-in-up" style={{ animationDelay: '700ms' }}>
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-4 h-4 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-900">{'\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439'}</h2>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{check.comment}</p>
        </div>
      )}

      {/* Back button */}
      <div className="flex justify-start">
        <button onClick={() => navigate('/checks')} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" />
          {'\u041D\u0430\u0437\u0430\u0434 \u043A \u0447\u0435\u043A\u0430\u043C'}
        </button>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={'\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0435\u043A'}
        message={`\u0412\u044B \u0443\u0432\u0435\u0440\u0435\u043D\u044B, \u0447\u0442\u043E \u0445\u043E\u0442\u0438\u0442\u0435 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0435\u043A #${check.number}? \u042D\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043D\u0435\u043B\u044C\u0437\u044F \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C.`}
        confirmText={'\u0423\u0434\u0430\u043B\u0438\u0442\u044C'}
        variant="danger"
      />
    </div>
  );
}
