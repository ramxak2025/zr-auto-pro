import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  Package,
  Users,
  Receipt,
  Lock,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Wallet,
  ShieldAlert,
  AlertTriangle,
  PackageMinus,
  Undo2,
  Recycle,
} from 'lucide-react';
import { format, startOfMonth } from 'date-fns';

import { reportsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { formatMoney } from '../../../shared/utils/formatters';
import DatePeriodPicker from '../components/DatePeriodPicker';
import LoadingSpinner from '../components/LoadingSpinner';
import { FinancialReport } from '../types';

export default function ReportsPage() {
  const { hasPermission } = useAuth();

  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);

  const canView = hasPermission('financial_reports');

  const { data: report, isLoading } = useQuery({
    queryKey: ['financial-report', dateFrom, dateTo],
    queryFn: () => reportsApi.getFinancial({ dateFrom, dateTo }),
    select: (res) => res.data as FinancialReport,
    enabled: canView,
  });

  // Defect + write-off + return-to-supplier aggregates for the period.
  const { data: defectStats } = useQuery({
    queryKey: ['defect-writeoff-report', dateFrom, dateTo],
    queryFn: () => reportsApi.defectWriteoff({ from: dateFrom, to: dateTo }),
    select: (res) => res.data,
    enabled: canView,
  });

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 p-4 bg-gray-100 rounded-full">
          <Lock className="w-10 h-10 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Доступ ограничен</h2>
        <p className="text-gray-500 max-w-sm">
          У вас нет прав для просмотра финансовых отчетов. Обратитесь к администратору.
        </p>
      </div>
    );
  }

  // Calculate margin percentage
  const marginPct = report && report.revenue > 0 ? ((report.netProfit / report.revenue) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100">
          <BarChart3 className="h-5 w-5 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Финансовые отчёты</h1>
          <p className="text-xs text-gray-400">Анализ прибыли и расходов</p>
        </div>
      </div>

      {/* Date picker */}
      <DatePeriodPicker
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(from, to) => {
          setDateFrom(from);
          setDateTo(to);
        }}
      />

      {isLoading ? (
        <LoadingSpinner />
      ) : !report ? (
        <div className="text-center py-12 text-gray-500">Не удалось загрузить данные</div>
      ) : (
        <div className="space-y-4">
          {/* Hero: Net Profit */}
          <div
            className={`relative overflow-hidden rounded-2xl p-5 ${
              report.netProfit >= 0
                ? 'bg-gradient-to-br from-emerald-500 to-emerald-700'
                : 'bg-gradient-to-br from-red-500 to-red-700'
            }`}
          >
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-1">
                {report.netProfit >= 0 ? (
                  <ArrowUpRight className="h-4 w-4 text-white/70" />
                ) : (
                  <ArrowDownRight className="h-4 w-4 text-white/70" />
                )}
                <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">Чистая прибыль</span>
              </div>
              <p className="text-3xl font-bold text-white tracking-tight">{formatMoney(report.netProfit)}</p>
              <p className="text-sm text-white/60 mt-1">Маржа {marginPct}%</p>
            </div>
            <div className="absolute right-4 top-4 opacity-10">
              {report.netProfit >= 0 ? (
                <TrendingUp className="h-24 w-24 text-white" />
              ) : (
                <TrendingDown className="h-24 w-24 text-white" />
              )}
            </div>
          </div>

          {/* KPI row — fills desktop width */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                </div>
                <span className="text-xs font-medium text-gray-500">Выручка</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{formatMoney(report.revenue)}</p>
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </div>
                <span className="text-xs font-medium text-gray-500">Валовая прибыль</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{formatMoney(report.grossProfit)}</p>
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50">
                  <Receipt className="h-4 w-4 text-primary-600" />
                </div>
                <span className="text-xs font-medium text-gray-500">Количество чеков</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xl font-bold text-gray-900">{report.checkCount}</p>
                {report.checkCount > 0 && report.revenue > 0 && (
                  <p className="text-[11px] text-gray-400">
                    Ср. чек: {formatMoney(report.revenue / report.checkCount)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Expenses + write-offs — two columns on desktop */}
          <div className={`grid grid-cols-1 gap-4 lg:items-start ${defectStats ? 'lg:grid-cols-2' : ''}`}>
            {/* Expenses breakdown */}
            <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Расходы</p>
              </div>

              <div className="divide-y divide-gray-50">
                {/* Product cost */}
                <div className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50">
                      <Package className="h-4 w-4 text-orange-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Себестоимость товаров</p>
                      {report.revenue > 0 && (
                        <p className="text-[11px] text-gray-400">
                          {((report.productCost / report.revenue) * 100).toFixed(1)}% от выручки
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-bold text-gray-900">{formatMoney(report.productCost)}</p>
                </div>

                {/* Salaries */}
                <div className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50">
                      <Users className="h-4 w-4 text-violet-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Зарплаты мастерам</p>
                      {report.revenue > 0 && (
                        <p className="text-[11px] text-gray-400">
                          {((report.salaries / report.revenue) * 100).toFixed(1)}% от выручки
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-bold text-gray-900">{formatMoney(report.salaries)}</p>
                </div>

                {/* Warranty loss — «по гарантии» work = parts cost + master's labor
                    payout. Already subtracted from netProfit server-side; surfaced
                    here so the owner sees WHY net profit is lower. */}
                {(report.warrantyLoss ?? 0) > 0 && (
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50">
                        <ShieldAlert className="h-4 w-4 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Убыток по гарантии</p>
                        <p className="text-[11px] text-gray-400">Запчасти + оплата мастеру по гарантийным работам</p>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-gray-900">{formatMoney(report.warrantyLoss ?? 0)}</p>
                  </div>
                )}

                {/* Other expenses (director) */}
                {((report as any).otherExpenses ?? 0) > 0 && (
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50">
                        <Wallet className="h-4 w-4 text-rose-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Прочие расходы</p>
                        {report.revenue > 0 && (
                          <p className="text-[11px] text-gray-400">
                            {(((report as any).otherExpenses / report.revenue) * 100).toFixed(1)}% от выручки
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-bold text-gray-900">{formatMoney((report as any).otherExpenses)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Defect + write-offs section */}
            {defectStats && (
              <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Брак и списания</p>
                </div>
                <div className="grid grid-cols-2 gap-3 p-4">
                  {/* Defect */}
                  <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                      </div>
                      <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">В браке</p>
                    </div>
                    <p className="text-base font-bold text-amber-900">{formatMoney(defectStats.defectValue)}</p>
                    <p className="text-[11px] text-amber-600 mt-0.5">{defectStats.defectQty} шт</p>
                  </div>

                  {/* Returned to supplier */}
                  <div className="rounded-xl bg-rose-50 border border-rose-100 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100">
                        <Undo2 className="h-3.5 w-3.5 text-rose-600" />
                      </div>
                      <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider">
                        Возврат поставщику
                      </p>
                    </div>
                    <p className="text-base font-bold text-rose-900">
                      {formatMoney(defectStats.returnedToSupplierValue)}
                    </p>
                    <p className="text-[11px] text-rose-600 mt-0.5">{defectStats.returnedToSupplierQty} шт</p>
                  </div>

                  {/* Writeoff (as expense) */}
                  <div className="rounded-xl bg-red-50 border border-red-100 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100">
                        <PackageMinus className="h-3.5 w-3.5 text-red-600" />
                      </div>
                      <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wider">
                        Списано как расход
                      </p>
                    </div>
                    <p className="text-base font-bold text-red-900">{formatMoney(defectStats.writeoffExpensedValue)}</p>
                    <p className="text-[11px] text-red-600 mt-0.5">{defectStats.writeoffExpensedQty} шт</p>
                  </div>

                  {/* Writeoff (no expense) */}
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-200">
                        <Recycle className="h-3.5 w-3.5 text-gray-600" />
                      </div>
                      <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">
                        Списано без расхода
                      </p>
                    </div>
                    <p className="text-base font-bold text-gray-900">
                      {formatMoney(defectStats.writeoffValue - defectStats.writeoffExpensedValue)}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {defectStats.writeoffQty - defectStats.writeoffExpensedQty} шт
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
