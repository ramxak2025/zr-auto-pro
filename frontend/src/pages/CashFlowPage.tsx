import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wallet, Banknote, CreditCard, ShieldAlert, Users, CalendarClock, Coins, PiggyBank, Undo2 } from 'lucide-react';
import { format, startOfMonth } from 'date-fns';
import { ru } from 'date-fns/locale';

import { reportsApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import DatePeriodPicker from '../components/DatePeriodPicker';
import PageHeader from '../components/PageHeader';
import QueryState from '../components/QueryState';
import type { User } from '../../../shared/types';
import { formatMoney } from '../../../shared/utils/formatters';

interface CashFlowDay {
  date: string;
  cash: number;
  card: number;
  // «Гарантия» — отпускная стоимость гарантийных работ (справочно, НЕ в total).
  warranty: number;
  // Реальный УБЫТОК по гарантии (запчасти + выплата мастеру). НЕ входит в оборот
  // (total). Опционально: старый бэкенд не шлёт — рендерим только при числе > 0.
  warrantyLoss?: number;
  total: number;
  // Долг по чекам в рассрочку (входит в оборот: cash + card + warranty +
  // installmentDebt = total) и погашения рассрочки по дате платежа (в оборот
  // НЕ входят — деньги за прошлые продажи). installmentPaidCash/Card (119) —
  // разбивка погашений по способу оплаты (installmentPaid = Cash + Card).
  // Опциональны: старый бэкенд их не шлёт, рендерим только когда поле пришло
  // числом.
  installmentDebt?: number;
  installmentPaid?: number;
  installmentPaidCash?: number;
  installmentPaidCard?: number;
  // «Касса за день» — реально принятые деньги (нал + карта + погашения
  // рассрочки). Опционально: старый бэкенд не шлёт.
  received?: number;
  // Возвраты по дате ФАКТИЧЕСКОГО возврата — информационно: деньги уже вычтены
  // из дня продажи, в total НЕ входят и из cash/card дня возврата не вычитаются.
  refunds?: number;
}

interface CashFlowData {
  days: CashFlowDay[];
  totals: {
    cash: number;
    card: number;
    warranty: number;
    warrantyLoss?: number;
    total: number;
    installmentDebt?: number;
    installmentPaid?: number;
    installmentPaidCash?: number;
    installmentPaidCard?: number;
    received?: number;
    refunds?: number;
  };
}

// days[].date теперь приходит строкой 'YYYY-MM-DD' (to_char по МСК); slice(0,10) —
// страховка от закешированного старого формата (полный ISO). Парсим по локальным
// компонентам, чтобы `new Date('YYYY-MM-DD')` (UTC-полночь) не уводил день назад
// в таймзонах западнее UTC.
function parseDay(date: string): Date {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

export default function CashFlowPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const { hasPermission } = useAuth();
  // Охват «свои vs все»: без `cashflow_view_all` сервер отдаёт только
  // собственные операции и игнорирует masterId — селектор мастера прячем
  // (нечего выбирать). Байпас superadmin/director — внутри hasPermission;
  // admin — по матрице роли из /auth/me (волна Битрикс24).
  const canFilterByMaster = hasPermission('cashflow_view_all');

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [masterId, setMasterId] = useState('');

  const { data: mastersData } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters();
      return res.data;
    },
    enabled: canFilterByMaster,
  });

  const {
    data: cashFlow,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['cashflow', dateFrom, dateTo, masterId],
    queryFn: () => reportsApi.getCashFlow({ dateFrom, dateTo, ...(masterId ? { masterId } : {}) }),
    select: (res) => res.data as CashFlowData,
  });

  const days = cashFlow?.days || [];
  const totals: CashFlowData['totals'] = cashFlow?.totals || { cash: 0, card: 0, warranty: 0, total: 0 };

  // Показываем корзину рассрочки только когда бэкенд её прислал и она ненулевая —
  // у сервисов без рассрочки страница выглядит как раньше.
  const hasInstallmentDebt = typeof totals.installmentDebt === 'number' && totals.installmentDebt > 0;
  const hasInstallmentPaid = typeof totals.installmentPaid === 'number' && totals.installmentPaid > 0;
  // «Гарантия (убыток)» — показываем только когда бэкенд прислал ненулевой
  // warrantyLoss. Это ЗАТРАТА (запчасти + выплата мастеру), НЕ часть оборота:
  // тождество кассы теперь cash + card + installmentDebt = total (без гарантии).
  const hasWarrantyLoss = typeof totals.warrantyLoss === 'number' && totals.warrantyLoss > 0;
  // «Касса» (received) — показываем всегда, когда бэкенд прислал поле: это
  // главная цифра «сколько денег реально пришло». Возвраты — информационная
  // строка (уже вычтены из дня продажи).
  const hasReceived = typeof totals.received === 'number';
  const hasRefunds = typeof totals.refunds === 'number' && totals.refunds > 0;

  // Разбивка погашений по способу оплаты (119) — подпись «в т.ч. наличными /
  // картой» только когда бэкенд прислал поля и часть ненулевая.
  const installmentPaidParts: string[] = [];
  if (typeof totals.installmentPaidCash === 'number' && totals.installmentPaidCash > 0) {
    installmentPaidParts.push(`наличными ${formatMoney(totals.installmentPaidCash)}`);
  }
  if (typeof totals.installmentPaidCard === 'number' && totals.installmentPaidCard > 0) {
    installmentPaidParts.push(`картой ${formatMoney(totals.installmentPaidCard)}`);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader title="Движение денег" icon={Wallet} />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <DatePeriodPicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
        />
        {canFilterByMaster && mastersData && mastersData.length > 0 && (
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-400" />
            <select
              value={masterId}
              onChange={(e) => setMasterId(e.target.value)}
              aria-label="Фильтр по мастеру"
              className="input py-2 pr-8 min-w-[180px]"
            >
              <option value="">Все мастера</option>
              {mastersData.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Banknote className="w-4 h-4 text-green-500" />
            <div className="stat-label">Наличные</div>
          </div>
          <div className="stat-value tabular-nums text-green-600">{formatMoney(totals.cash)}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-4 h-4 text-blue-500" />
            <div className="stat-label">Карта</div>
          </div>
          <div className="stat-value tabular-nums text-blue-600">{formatMoney(totals.card)}</div>
        </div>
        {hasInstallmentDebt && (
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock className="w-4 h-4 text-violet-500" />
              <div className="stat-label">Рассрочка (долг)</div>
            </div>
            <div className="stat-value tabular-nums text-violet-600">{formatMoney(totals.installmentDebt ?? 0)}</div>
          </div>
        )}
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-gray-700" />
            <div className="stat-label">Итого</div>
          </div>
          <div className="stat-value tabular-nums text-gray-900">{formatMoney(totals.total)}</div>
          <p className="text-[11px] text-gray-500 mt-0.5">Оборот (без гарантии)</p>
        </div>
        {hasReceived && (
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <PiggyBank className="w-4 h-4 text-emerald-500" />
              <div className="stat-label">Касса</div>
            </div>
            <div className="stat-value tabular-nums text-emerald-600">{formatMoney(totals.received ?? 0)}</div>
            <p className="text-[11px] text-gray-500 mt-0.5">Реально принято: нал + карта + погашения рассрочки</p>
          </div>
        )}
        {hasRefunds && (
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <Undo2 className="w-4 h-4 text-rose-500" />
              <div className="stat-label">Возвраты</div>
            </div>
            <div className="stat-value tabular-nums text-rose-600">{formatMoney(totals.refunds ?? 0)}</div>
            <p className="text-[11px] text-gray-500 mt-0.5">Уже вычтены из дня продажи — справочно</p>
          </div>
        )}
        {hasWarrantyLoss && (
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="w-4 h-4 text-red-500" />
              <div className="stat-label">Гарантия (убыток)</div>
            </div>
            <div className="stat-value tabular-nums text-red-600">-{formatMoney(totals.warrantyLoss ?? 0)}</div>
            <p className="text-[11px] text-gray-500 mt-0.5">Не входит в оборот — запчасти + оплата мастеру</p>
          </div>
        )}
        {hasInstallmentPaid && (
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <Coins className="w-4 h-4 text-teal-500" />
              <div className="stat-label">Погашения рассрочки</div>
            </div>
            <div className="stat-value tabular-nums text-teal-600">+{formatMoney(totals.installmentPaid ?? 0)}</div>
            <p className="text-[11px] text-gray-500 mt-0.5">Не входит в оборот — оплата прошлых продаж</p>
            {installmentPaidParts.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-0.5">в т.ч. {installmentPaidParts.join(' · ')}</p>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={days.length === 0}
        empty={{
          icon: Wallet,
          title: 'Нет данных',
          description: 'За выбранный период нет движения денежных средств',
        }}
        minHeight="min-h-[30vh]"
      >
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {days.map((day) => (
              <div key={day.date} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-900 text-sm">
                    {format(parseDay(day.date), 'dd MMM yyyy', { locale: ru })}
                  </span>
                  <span className="font-bold text-gray-900 text-sm">{formatMoney(day.total)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {day.cash > 0 && (
                    <span className="text-green-600">
                      <Banknote className="w-3 h-3 inline mr-0.5" />
                      {formatMoney(day.cash)}
                    </span>
                  )}
                  {day.card > 0 && (
                    <span className="text-blue-600">
                      <CreditCard className="w-3 h-3 inline mr-0.5" />
                      {formatMoney(day.card)}
                    </span>
                  )}
                  {(day.warrantyLoss ?? 0) > 0 && (
                    <span className="text-red-600">
                      <ShieldAlert className="w-3 h-3 inline mr-0.5" />-{formatMoney(day.warrantyLoss ?? 0)}
                    </span>
                  )}
                  {(day.installmentDebt ?? 0) > 0 && (
                    <span className="text-violet-600">
                      <CalendarClock className="w-3 h-3 inline mr-0.5" />
                      {formatMoney(day.installmentDebt ?? 0)}
                    </span>
                  )}
                  {(day.installmentPaid ?? 0) > 0 && (
                    <span className="text-teal-600">
                      <Coins className="w-3 h-3 inline mr-0.5" />+{formatMoney(day.installmentPaid ?? 0)}
                    </span>
                  )}
                </div>
                {typeof day.received === 'number' && (
                  <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
                    <span className="text-gray-500">Касса за день</span>
                    <span className="font-semibold text-emerald-600 tabular-nums">{formatMoney(day.received)}</span>
                  </div>
                )}
                {(day.refunds ?? 0) > 0 && (
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-gray-500">Возвраты (уже вычтены из дня продажи)</span>
                    <span className="text-rose-600 tabular-nums">{formatMoney(day.refunds ?? 0)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table — dense, full-width with weekday + share-of-period */}
          <div className="hidden md:block table-container overflow-y-auto md:max-h-[calc(100vh-20rem)]">
            <table className="table">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Дата</th>
                  <th>День недели</th>
                  <th className="text-right">Наличные</th>
                  <th className="text-right">Карта</th>
                  {hasInstallmentDebt && <th className="text-right">Рассрочка (долг)</th>}
                  <th className="text-right">Итого</th>
                  {hasWarrantyLoss && <th className="text-right">Гарантия (убыток)</th>}
                  {hasInstallmentPaid && <th className="text-right">Погашено</th>}
                  {hasReceived && <th className="text-right">Касса за день</th>}
                  {hasRefunds && (
                    <th className="text-right" title="Уже вычтены из дня продажи — справочно">
                      Возвраты
                    </th>
                  )}
                  <th className="w-[22%]">Доля периода</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <td className="font-medium text-gray-900 whitespace-nowrap">
                      {format(parseDay(day.date), 'dd MMM yyyy', { locale: ru })}
                    </td>
                    <td className="capitalize text-gray-500 whitespace-nowrap">
                      {format(parseDay(day.date), 'EEEE', { locale: ru })}
                    </td>
                    <td className="text-right tabular-nums text-green-600">
                      {day.cash > 0 ? formatMoney(day.cash) : '\u2014'}
                    </td>
                    <td className="text-right tabular-nums text-blue-600">
                      {day.card > 0 ? formatMoney(day.card) : '\u2014'}
                    </td>
                    {hasInstallmentDebt && (
                      <td className="text-right tabular-nums text-violet-600">
                        {(day.installmentDebt ?? 0) > 0 ? formatMoney(day.installmentDebt ?? 0) : '\u2014'}
                      </td>
                    )}
                    <td className="text-right tabular-nums font-semibold text-gray-900">{formatMoney(day.total)}</td>
                    {hasWarrantyLoss && (
                      <td className="text-right tabular-nums text-red-600">
                        {(day.warrantyLoss ?? 0) > 0 ? `-${formatMoney(day.warrantyLoss ?? 0)}` : '\u2014'}
                      </td>
                    )}
                    {hasInstallmentPaid && (
                      <td className="text-right tabular-nums text-teal-600">
                        {(day.installmentPaid ?? 0) > 0 ? `+${formatMoney(day.installmentPaid ?? 0)}` : '\u2014'}
                      </td>
                    )}
                    {hasReceived && (
                      <td className="text-right tabular-nums font-semibold text-emerald-600">
                        {formatMoney(day.received ?? 0)}
                      </td>
                    )}
                    {hasRefunds && (
                      <td className="text-right tabular-nums text-rose-600">
                        {(day.refunds ?? 0) > 0 ? formatMoney(day.refunds ?? 0) : '\u2014'}
                      </td>
                    )}
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary-500"
                            style={{
                              width: `${
                                totals.total > 0
                                  ? Math.max(Math.round((day.total / totals.total) * 100), day.total > 0 ? 4 : 0)
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <span className="w-9 text-right text-xs font-medium tabular-nums text-gray-500">
                          {totals.total > 0 ? Math.round((day.total / totals.total) * 100) : 0}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 [&>td]:sticky [&>td]:bottom-0 [&>td]:z-10 [&>td]:bg-gray-50">
                  <td className="font-bold text-gray-900">Итого</td>
                  <td className="text-gray-500">{days.length} дн.</td>
                  <td className="text-right tabular-nums font-bold text-green-600">{formatMoney(totals.cash)}</td>
                  <td className="text-right tabular-nums font-bold text-blue-600">{formatMoney(totals.card)}</td>
                  {hasInstallmentDebt && (
                    <td className="text-right tabular-nums font-bold text-violet-600">
                      {formatMoney(totals.installmentDebt ?? 0)}
                    </td>
                  )}
                  <td className="text-right tabular-nums font-bold text-gray-900">{formatMoney(totals.total)}</td>
                  {hasWarrantyLoss && (
                    <td className="text-right tabular-nums font-bold text-red-600">
                      -{formatMoney(totals.warrantyLoss ?? 0)}
                    </td>
                  )}
                  {hasInstallmentPaid && (
                    <td className="text-right tabular-nums font-bold text-teal-600">
                      +{formatMoney(totals.installmentPaid ?? 0)}
                    </td>
                  )}
                  {hasReceived && (
                    <td className="text-right tabular-nums font-bold text-emerald-600">
                      {formatMoney(totals.received ?? 0)}
                    </td>
                  )}
                  {hasRefunds && (
                    <td className="text-right tabular-nums font-bold text-rose-600">
                      {formatMoney(totals.refunds ?? 0)}
                    </td>
                  )}
                  <td className="text-right tabular-nums font-bold text-gray-900">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      </QueryState>
    </div>
  );
}
