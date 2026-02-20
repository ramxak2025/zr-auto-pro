import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, FileText, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { checksApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import DatePeriodPicker from '../components/DatePeriodPicker';
import SearchInput from '../components/SearchInput';
import type { Check, User, PaginatedResponse } from '../types';

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

export default function ChecksPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('checks_delete');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [masterId, setMasterId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const limit = 20;

  const { data: mastersData } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters();
      return res.data;
    },
  });

  const { data: checksData, isLoading } = useQuery<PaginatedResponse<Check>>({
    queryKey: ['checks', page, search, masterId, dateFrom, dateTo],
    queryFn: async () => {
      const params: Record<string, any> = { page, limit };
      if (search) params.search = search;
      if (masterId) params.masterId = masterId;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const res = await checksApi.getAll(params);
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => checksApi.remove(id),
    onSuccess: () => {
      toast.success('Чек удалён');
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось удалить чек');
    },
  });

  const handleDelete = (e: React.MouseEvent, checkId: string, checkNumber: number) => {
    e.stopPropagation();
    if (window.confirm(`Удалить чек #${checkNumber}? Это действие необратимо.`)) {
      deleteMutation.mutate(checkId);
    }
  };

  const handleDateChange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleMasterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setMasterId(e.target.value);
    setPage(1);
  };

  const checks = checksData?.data ?? [];
  const total = checksData?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">{'\u0427\u0435\u043A\u0438'}</h1>
        <Link to="/checks/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          {'\u041D\u043E\u0432\u044B\u0439 \u0447\u0435\u043A'}
        </Link>
      </div>

      {/* Filters */}
      <div className="card card-body">
        <div className="flex flex-col lg:flex-row gap-4">
          <DatePeriodPicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={handleDateChange}
          />
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <div className="w-full sm:w-48">
              <select
                value={masterId}
                onChange={handleMasterChange}
                className="input"
              >
                <option value="">{'\u0412\u0441\u0435 \u043C\u0430\u0441\u0442\u0435\u0440\u0430'}</option>
                {mastersData?.map((master) => (
                  <option key={master.id} value={master.id}>
                    {master.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <SearchInput
                value={search}
                onChange={handleSearchChange}
                placeholder={'\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0443, \u0430\u0432\u0442\u043E, \u043D\u043E\u043C\u0435\u0440\u0443...'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSpinner />
      ) : checks.length === 0 ? (
        <EmptyState icon={FileText} title="Чеков не найдено" description="Попробуйте изменить фильтры или создайте новый чек" />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {checks.map((check) => (
              <div key={check.id} onClick={() => navigate(`/checks/${check.id}`)}
                className={`rounded-xl border shadow-sm p-4 active:bg-gray-50 transition-colors cursor-pointer ${
                  check.isDeferred
                    ? 'bg-red-50 border-red-200'
                    : 'bg-white border-gray-100'
                }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">#{check.number}</span>
                    <span className="text-xs text-gray-400">{format(new Date(check.date), 'dd.MM.yy', { locale: ru })}</span>
                    {check.isDeferred && (
                      <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Отложен</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{formatCurrency(check.totalRevenue)}</span>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, check.id, check.number)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-700 truncate">{check.client?.fullName ?? 'Розничный покупатель'}</p>
                    {check.car && <p className="text-xs text-gray-400 truncate">{check.car.plateNumber} {'\u00B7'} {check.car.makeModel}</p>}
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
                  <th>#</th><th>Дата</th><th>Клиент</th><th>Авто</th><th>Мастер</th><th>Сумма</th><th>Оплата</th>
                  {canDelete && <th className="w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.id} onClick={() => navigate(`/checks/${check.id}`)} className={`cursor-pointer ${check.isDeferred ? 'bg-red-50' : ''}`}>
                    <td className="font-medium">
                      <span>{check.number}</span>
                      {check.isDeferred && <span className="ml-1.5 text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Отложен</span>}
                    </td>
                    <td>{format(new Date(check.date), 'dd.MM.yyyy', { locale: ru })}</td>
                    <td>{check.client?.fullName ?? 'Розничный покупатель'}</td>
                    <td>{check.car ? <div><div className="text-sm">{check.car.makeModel}</div><div className="text-xs text-gray-400">{check.car.plateNumber}</div></div> : '\u2014'}</td>
                    <td>{check.master?.fullName ?? '\u2014'}</td>
                    <td className="font-semibold">{formatCurrency(check.totalRevenue)}</td>
                    <td><span className={paymentMethodBadge[check.paymentMethod] ?? 'badge-gray'}>{paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}</span></td>
                    {canDelete && (
                      <td>
                        <button
                          type="button"
                          onClick={(e) => handleDelete(e, check.id, check.number)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} total={total} limit={limit} onChange={setPage} />
        </>
      )}
    </div>
  );
}
