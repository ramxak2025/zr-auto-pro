import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, FileText, Trash2, Clock, MessageSquare, TrendingUp, Car, User as UserIcon, Percent } from 'lucide-react';
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
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал/Карта',
};

const paymentMethodBadge: Record<string, string> = {
  cash: 'badge-green',
  card: 'badge-blue',
  warranty: 'badge-yellow',
  cash_card: 'badge-gray',
};

const formatCurrency = (value: number): string => {
  return value.toLocaleString('ru-RU') + ' ₽';
};

export default function ChecksPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('checks_delete');
  const canViewProfit = hasPermission('profit_view');
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
        <h1 className="page-title">{'Чеки'}</h1>
        <Link to="/checks/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          {'Новый чек'}
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
                <option value="">{'Все мастера'}</option>
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
                placeholder={'Поиск по клиенту, авто, номеру...'}
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
                className={`rounded-2xl border shadow-sm overflow-hidden active:scale-[0.99] transition-all cursor-pointer ${
                  check.isDeferred
                    ? 'bg-red-50/50 border-red-200'
                    : 'bg-white border-gray-100'
                }`}>
                {/* Card header */}
                <div className="px-4 pt-3.5 pb-2.5">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base font-bold text-gray-900">#{check.number}</span>
                      {check.isDeferred && (
                        <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full flex-shrink-0">Отложен</span>
                      )}
                      <span className={`flex-shrink-0 ${paymentMethodBadge[check.paymentMethod] ?? 'badge-gray'}`}>
                        {paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
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

                  {/* Client & Car */}
                  <div className="space-y-1 mb-3">
                    <div className="flex items-center gap-2">
                      <UserIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <p className="text-sm font-medium text-gray-800 truncate">{check.client?.fullName ?? 'Розничный покупатель'}</p>
                    </div>
                    {check.car && (
                      <div className="flex items-center gap-2">
                        <Car className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <p className="text-sm text-gray-600 truncate">
                          {check.car.makeModel}
                          <span className="text-gray-400 ml-1.5">{check.car.plateNumber}</span>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Comment preview */}
                  {check.comment && (
                    <div className="flex items-start gap-2 mb-3">
                      <MessageSquare className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-gray-400 line-clamp-1">{check.comment}</p>
                    </div>
                  )}
                </div>

                {/* Card footer - financial info */}
                <div className={`px-4 py-2.5 border-t flex items-center justify-between gap-3 ${
                  check.isDeferred ? 'border-red-100 bg-red-50/30' : 'border-gray-50 bg-gray-50/50'
                }`}>
                  <div className="flex items-center gap-3 text-xs text-gray-400 min-w-0">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{format(new Date(check.date), 'dd.MM.yy HH:mm', { locale: ru })}</span>
                    </div>
                    {check.master && (
                      <span className="truncate">{check.master.fullName}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {(check.discount ?? 0) > 0 && (
                      <div className="flex items-center gap-0.5">
                        <Percent className="w-3 h-3 text-orange-400" />
                        <span className="text-xs font-medium text-orange-500">-{formatCurrency(check.discount ?? 0)}</span>
                      </div>
                    )}
                    <span className="text-sm font-bold text-gray-900">{formatCurrency(check.totalRevenue)}</span>
                  </div>
                </div>

                {/* Profit bar for directors */}
                {canViewProfit && (
                  <div className={`px-4 py-2 border-t flex items-center justify-between ${
                    check.isDeferred ? 'border-red-100' : 'border-gray-100'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-400">Прибыль</span>
                    </div>
                    <span className={`text-sm font-bold ${check.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {check.profit >= 0 ? '+' : ''}{formatCurrency(check.profit)}
                    </span>
                  </div>
                )}
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
                  <th>Клиент</th>
                  <th>Авто</th>
                  <th>Мастер</th>
                  {(canViewProfit) && <th>Скидка</th>}
                  <th>Выручка</th>
                  {canViewProfit && <th>Прибыль</th>}
                  <th>Оплата</th>
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
                    <td>
                      <div className="text-sm">{format(new Date(check.date), 'dd.MM.yyyy', { locale: ru })}</div>
                      <div className="text-xs text-gray-400">{format(new Date(check.date), 'HH:mm', { locale: ru })}</div>
                    </td>
                    <td>
                      <div className="text-sm font-medium">{check.client?.fullName ?? 'Розничный покупатель'}</div>
                      {check.comment && (
                        <div className="text-xs text-gray-400 truncate max-w-[200px]" title={check.comment}>
                          <MessageSquare className="w-3 h-3 inline mr-1" />
                          {check.comment}
                        </div>
                      )}
                    </td>
                    <td>
                      {check.car ? (
                        <div>
                          <div className="text-sm">{check.car.makeModel}</div>
                          <div className="text-xs text-gray-400">{check.car.plateNumber}</div>
                        </div>
                      ) : '—'}
                    </td>
                    <td>{check.master?.fullName ?? '—'}</td>
                    {canViewProfit && (
                      <td>
                        {(check.discount ?? 0) > 0 ? (
                          <span className="text-sm text-orange-500 font-medium">-{formatCurrency(check.discount ?? 0)}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    )}
                    <td className="font-semibold">{formatCurrency(check.totalRevenue)}</td>
                    {canViewProfit && (
                      <td>
                        <span className={`font-semibold ${check.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {check.profit >= 0 ? '+' : ''}{formatCurrency(check.profit)}
                        </span>
                      </td>
                    )}
                    <td>
                      <span className={paymentMethodBadge[check.paymentMethod] ?? 'badge-gray'}>
                        {paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}
                      </span>
                    </td>
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
