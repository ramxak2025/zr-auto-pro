import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ShoppingBag, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { checksApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import type { Check, PaginatedResponse } from '../types';
import { formatMoney, paymentMethodLabels } from '../../../shared/utils/formatters';

const paymentMethodBadge: Record<string, string> = {
  cash: 'badge-green',
  card: 'badge-blue',
  warranty: 'badge-yellow',
  cash_card: 'badge-gray',
};

export default function RetailChecksPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data: checksData, isLoading } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['checks', 'retail', page],
    queryFn: async () => {
      const res = await checksApi.getAll({ page, limit, retail: 'true' });
      return res.data;
    },
  });

  const checks = checksData?.data ?? [];
  const total = checksData?.total ?? 0;

  return (
    <div>
      <button
        onClick={() => navigate('/clients')}
        className="btn-secondary mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Назад к клиентам
      </button>

      {/* Retail buyer header */}
      <div className="card p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100">
            <ShoppingBag className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Розничный покупатель
            </h2>
            <p className="text-sm text-gray-500">Чеки без привязки к клиенту</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-sm text-gray-500">Всего чеков</p>
            <p className="text-xl font-bold text-gray-900">{total}</p>
          </div>
        </div>
      </div>

      {/* Checks list */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Чеки
        </h2>

        {isLoading ? (
          <LoadingSpinner />
        ) : checks.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Нет чеков"
            description="Нет чеков на розничного покупателя"
          />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {checks.map((check) => (
                <div
                  key={check.id}
                  onClick={() => navigate(`/checks/${check.id}`)}
                  className={`rounded-xl border shadow-sm p-4 active:bg-gray-50 transition-colors cursor-pointer ${
                    check.isDeferred
                      ? 'bg-red-50 border-red-200'
                      : 'bg-white border-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900">#{check.number}</span>
                      <span className="text-xs text-gray-400">
                        {format(new Date(check.date), 'dd.MM.yy', { locale: ru })}
                      </span>
                      {check.isDeferred && (
                        <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                          Отложен
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold text-gray-900">
                      {formatMoney(check.totalRevenue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-700 truncate">
                        {check.master?.fullName ?? '\u2014'}
                      </p>
                    </div>
                    <span className={`ml-2 flex-shrink-0 ${paymentMethodBadge[check.paymentMethod] ?? 'badge-gray'}`}>
                      {paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Дата</th>
                    <th>Мастер</th>
                    <th>Сумма</th>
                    <th>Оплата</th>
                  </tr>
                </thead>
                <tbody>
                  {checks.map((check) => (
                    <tr
                      key={check.id}
                      onClick={() => navigate(`/checks/${check.id}`)}
                      className={`cursor-pointer hover:bg-gray-50 ${check.isDeferred ? 'bg-red-50' : ''}`}
                    >
                      <td className="font-medium">
                        <span>{check.number}</span>
                        {check.isDeferred && (
                          <span className="ml-1.5 text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                            Отложен
                          </span>
                        )}
                      </td>
                      <td>{format(new Date(check.date), 'dd.MM.yyyy', { locale: ru })}</td>
                      <td>{check.master?.fullName ?? '\u2014'}</td>
                      <td className="font-semibold">{formatMoney(check.totalRevenue)}</td>
                      <td>
                        <span className={paymentMethodBadge[check.paymentMethod] ?? 'badge-gray'}>
                          {paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination page={page} total={total} limit={limit} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
