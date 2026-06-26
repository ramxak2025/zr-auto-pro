import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Coins, Phone, ChevronRight } from 'lucide-react';
import { debtsApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { Debtor } from '../types';
import { formatPhone } from '../../../shared/validation/phone';

const formatCurrency = (amount: number) => amount.toLocaleString('ru-RU') + ' ₽';

export default function DebtorsPage() {
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery<Debtor[]>({
    queryKey: ['debts', 'debtors'],
    queryFn: async () => {
      const res = await debtsApi.debtors();
      return res.data;
    },
  });

  // Backend already orders by balance desc, but we sort defensively so the UI
  // is stable regardless of source ordering.
  const debtors = useMemo(() => [...(data ?? [])].sort((a, b) => b.balance - a.balance), [data]);

  const totalDebt = useMemo(() => debtors.reduce((sum, d) => sum + d.balance, 0), [debtors]);

  if (isLoading) return <LoadingSpinner />;

  if (isError) {
    return (
      <EmptyState icon={Coins} title="Не удалось загрузить дебиторку" description="Попробуйте обновить страницу" />
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Дебиторка</h1>
          <p className="text-sm text-gray-500 mt-0.5">Клиенты с непогашенным долгом</p>
        </div>
        {debtors.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-gray-500">Всего долгов</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalDebt)}</p>
          </div>
        )}
      </div>

      {debtors.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="Должников нет"
          description="Все клиенты рассчитались — непогашенных долгов не осталось"
        />
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="table-container hidden sm:block">
            <table className="table">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>Телефон</th>
                  <th className="text-right">Долг</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {debtors.map((debtor) => (
                  <tr
                    key={debtor.clientId}
                    onClick={() => navigate(`/clients/${debtor.clientId}`)}
                    className="cursor-pointer"
                  >
                    <td className="font-medium text-gray-900">{debtor.name}</td>
                    <td className="text-gray-600">{debtor.phone ? formatPhone(debtor.phone) : '—'}</td>
                    <td className="text-right font-bold text-red-600 whitespace-nowrap">
                      {formatCurrency(debtor.balance)}
                    </td>
                    <td className="text-right">
                      <ChevronRight className="w-4 h-4 text-gray-300 inline-block" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 sm:hidden">
            {debtors.map((debtor) => (
              <button
                key={debtor.clientId}
                type="button"
                onClick={() => navigate(`/clients/${debtor.clientId}`)}
                className="w-full card press-soft flex items-center gap-3 p-4 text-left"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 flex-shrink-0">
                  <Coins className="w-5 h-5 text-red-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">{debtor.name}</p>
                  {debtor.phone && (
                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" />
                      {formatPhone(debtor.phone)}
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-red-600 whitespace-nowrap">{formatCurrency(debtor.balance)}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
