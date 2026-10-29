import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowRightLeft,
  Banknote,
  CalendarClock,
  Coins,
  CreditCard,
  Landmark,
  PiggyBank,
  ShieldAlert,
  Undo2,
  Wallet,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { reportsApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import DatePeriodPicker from '../components/DatePeriodPicker';
import PageHeader from '../components/PageHeader';
import QueryState from '../components/QueryState';
import MonthPager from '../components/reports/MonthPager';
import { patchParams, readPeriod } from '../components/reports/periodParams';
import { numericColumnSizing } from '../components/reports/tableWidths';
import type { User } from '../../../shared/types';
import { formatMoney } from '../../../shared/utils/formatters';
import { StatCard } from '../ui/StatCard';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Money } from '../ui/Money';
import { Select } from '../ui/Select';
import { Toolbar } from '../ui/Toolbar';
import { SkeletonCard } from '../ui/Skeleton';
import { cn } from '../ui/cn';

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
  // 155 — инкассации за день (из кассы + из сейфа), справочно. Опционально:
  // старый бэкенд не шлёт.
  collections?: number;
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
    /** 155 — инкассации за период, справочно. */
    collections?: number;
  };
  /**
   * 155 — текущие остатки «кошельков» тенанта: drawer — касса (размен последней
   * закрытой смены либо живой expected открытой), safe — сейф. Absent на
   * старом бэкенде / без права.
   */
  wallets?: { drawer: number; safe: number };
}

// days[].date теперь приходит строкой 'YYYY-MM-DD' (to_char по МСК); slice(0,10) —
// страховка от закешированного старого формата (полный ISO). Парсим по локальным
// компонентам, чтобы `new Date('YYYY-MM-DD')` (UTC-полночь) не уводил день назад
// в таймзонах западнее UTC.
function parseDay(date: string): Date {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/** Сумма или прочерк, если нулевая (таблица по дням не должна пестрить нулями). */
function amountOrDash(value: number | undefined, className?: string, prefix = '') {
  if (!value || value <= 0) return <span className="text-ink-3">—</span>;
  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {formatMoney(value)}
    </span>
  );
}

/**
 * Движение денег по дням: KPI за период и таблица с итогами. Период и мастер —
 * в URL; запрос и ключ ['cashflow', from, to, masterId] прежние. Второстепенные
 * колонки прячутся на узких экранах вместо дублирующих карточек.
 */
export default function CashFlowPage() {
  // Дефолтный период — текущий месяц ПО КАЛЕНДАРЮ АВТОСЕРВИСА (157): движение
  // денег сервер режет сутками тенанта, и «месяц» по часам браузера в ночь на
  // 1-е число просил у сервера уже следующий месяц.
  const { today, monthStart } = useTenantCalendar();
  const { hasPermission } = useAuth();
  // Охват «свои vs все»: без `cashflow_view_all` сервер отдаёт только
  // собственные операции и игнорирует masterId — селектор мастера прячем
  // (нечего выбирать). Байпас superadmin/director — внутри hasPermission;
  // admin — по матрице роли из /auth/me (волна Битрикс24).
  const canFilterByMaster = hasPermission('cashflow_view_all');

  const [params, setParams] = useSearchParams();
  const period = readPeriod(params, { from: monthStart, to: today });
  const dateFrom = period.from;
  const dateTo = period.to;
  const masterId = params.get('masterId') ?? '';
  const update = (patch: Record<string, string | null | undefined>) =>
    setParams(patchParams(params, patch), { replace: true });

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
  // 155 — инкассации (из кассы + из сейфа) — справочная строка, показываем
  // только когда бэкенд прислал ненулевой итог за период.
  const hasCollections = typeof totals.collections === 'number' && totals.collections > 0;
  // 155 — остатки «кошельков» (касса / сейф) — карточки при наличии в ответе.
  const wallets = cashFlow?.wallets;

  // Разбивка погашений по способу оплаты (119) — подпись «в т.ч. наличными /
  // картой» только когда бэкенд прислал поля и часть ненулевая.
  const installmentPaidParts: string[] = [];
  if (typeof totals.installmentPaidCash === 'number' && totals.installmentPaidCash > 0) {
    installmentPaidParts.push(`наличными ${formatMoney(totals.installmentPaidCash)}`);
  }
  if (typeof totals.installmentPaidCard === 'number' && totals.installmentPaidCard > 0) {
    installmentPaidParts.push(`картой ${formatMoney(totals.installmentPaidCard)}`);
  }

  const share = (day: CashFlowDay) => (totals.total > 0 ? Math.round((day.total / totals.total) * 100) : 0);

  const columns: DataTableColumn<CashFlowDay>[] = [
    {
      key: 'date',
      header: 'Дата',
      primary: true,
      sortable: true,
      render: (day) => (
        <span className="block whitespace-nowrap">
          <span className="font-medium text-ink">{format(parseDay(day.date), 'dd MMM yyyy', { locale: ru })}</span>
          <span className="block text-2xs capitalize text-ink-3 md:hidden">
            {format(parseDay(day.date), 'EEEE', { locale: ru })}
          </span>
        </span>
      ),
      footer: 'Итого',
    },
    {
      key: 'weekday',
      header: 'День недели',
      hideBelow: 'md',
      render: (day) => (
        <span className="capitalize text-ink-2">{format(parseDay(day.date), 'EEEE', { locale: ru })}</span>
      ),
      footer: <span className="font-normal text-ink-3">{days.length} дн.</span>,
    },
    {
      key: 'cash',
      header: 'Наличные',
      numeric: true,
      ...numericColumnSizing('Наличные'),
      sortable: true,
      hideBelow: 'sm',
      render: (day) => amountOrDash(day.cash),
      footer: <Money value={totals.cash} />,
    },
    {
      key: 'card',
      header: 'Карта',
      numeric: true,
      ...numericColumnSizing('Карта'),
      sortable: true,
      hideBelow: 'sm',
      render: (day) => amountOrDash(day.card),
      footer: <Money value={totals.card} />,
    },
  ];
  if (hasInstallmentDebt) {
    columns.push({
      key: 'installmentDebt',
      header: 'Рассрочка (долг)',
      numeric: true,
      ...numericColumnSizing('Рассрочка (долг)'),
      hideBelow: 'md',
      render: (day) => amountOrDash(day.installmentDebt),
      footer: <Money value={totals.installmentDebt ?? 0} />,
    });
  }
  columns.push({
    key: 'total',
    header: 'Итого',
    numeric: true,
    ...numericColumnSizing('Итого'),
    sortable: true,
    render: (day) => <Money value={day.total} className="font-semibold text-ink" />,
    footer: <Money value={totals.total} />,
  });
  if (hasWarrantyLoss) {
    columns.push({
      key: 'warrantyLoss',
      header: 'Гарантия (убыток)',
      numeric: true,
      ...numericColumnSizing('Гарантия (убыток)'),
      hideBelow: 'md',
      render: (day) => amountOrDash(day.warrantyLoss, 'text-bad-text', '−'),
      footer: <Money value={-(totals.warrantyLoss ?? 0)} className="text-bad-text" />,
    });
  }
  if (hasInstallmentPaid) {
    columns.push({
      key: 'installmentPaid',
      header: 'Погашено',
      numeric: true,
      ...numericColumnSizing('Погашено'),
      hideBelow: 'md',
      render: (day) => amountOrDash(day.installmentPaid, undefined, '+'),
      footer: <Money value={totals.installmentPaid ?? 0} signed />,
    });
  }
  if (hasReceived) {
    columns.push({
      key: 'received',
      header: 'Касса за день',
      numeric: true,
      ...numericColumnSizing('Касса за день'),
      sortable: true,
      render: (day) => <Money value={day.received ?? 0} className="font-semibold text-ok-text" />,
      footer: <Money value={totals.received ?? 0} className="text-ok-text" />,
    });
  }
  if (hasRefunds) {
    columns.push({
      key: 'refunds',
      header: <abbr title="Уже вычтены из дня продажи — справочно">Возвраты</abbr>,
      numeric: true,
      ...numericColumnSizing('Возвраты'),
      hideBelow: 'md',
      render: (day) => amountOrDash(day.refunds, 'text-ink-2'),
      footer: <Money value={totals.refunds ?? 0} />,
    });
  }
  if (hasCollections) {
    columns.push({
      key: 'collections',
      header: <abbr title="Изъято из кассы и сейфа — справочно">Инкассации</abbr>,
      numeric: true,
      ...numericColumnSizing('Инкассации'),
      hideBelow: 'md',
      render: (day) => amountOrDash(day.collections, 'text-ink-2', '−'),
      footer: <Money value={-(totals.collections ?? 0)} />,
    });
  }
  columns.push({
    key: 'share',
    header: 'Доля периода',
    hideBelow: 'lg',
    width: '18%',
    sortValue: (day) => day.total,
    render: (day) => (
      <span className="flex items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.max(share(day), day.total > 0 ? 3 : 0)}%` }}
          />
        </span>
        <span className="w-9 text-right text-xs tabular-nums text-ink-3">{share(day)}%</span>
      </span>
    ),
    footer: <span className="block text-right">100%</span>,
  });

  const kpiLoading = isLoading && !cashFlow;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Движение денег"
        icon={ArrowRightLeft}
        subtitle="Касса по дням: наличные, карта, рассрочка, погашения"
      />

      <Toolbar>
        <MonthPager from={dateFrom} to={dateTo} todayKey={today} onChange={(from, to) => update({ from, to })} />
        <DatePeriodPicker dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => update({ from, to })} />
        {canFilterByMaster && mastersData && mastersData.length > 0 && (
          <Select
            aria-label="Мастер"
            placeholder="Все мастера"
            options={mastersData.map((m) => ({ value: m.id, label: m.fullName }))}
            value={masterId}
            onChange={(e) => update({ masterId: e.target.value })}
            className="w-52"
          />
        )}
      </Toolbar>

      {kpiLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} lines={1} />
          ))}
        </div>
      ) : (
        !isError && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            <StatCard compact label="Наличные" value={formatMoney(totals.cash)} icon={Banknote} />
            <StatCard compact label="Карта" value={formatMoney(totals.card)} icon={CreditCard} />
            {hasInstallmentDebt && (
              <StatCard
                compact
                label="Рассрочка (долг)"
                value={formatMoney(totals.installmentDebt ?? 0)}
                hint="Выдано в долг — входит в оборот"
                icon={CalendarClock}
                tone="warn"
              />
            )}
            <StatCard compact label="Оборот" value={formatMoney(totals.total)} hint="Без гарантии" icon={Wallet} />
            {hasReceived && (
              <StatCard
                compact
                label="Касса за период"
                value={formatMoney(totals.received ?? 0)}
                hint="Реально принято: нал + карта + погашения"
                icon={PiggyBank}
                tone="ok"
              />
            )}
            {hasRefunds && (
              <StatCard
                compact
                label="Возвраты"
                value={formatMoney(totals.refunds ?? 0)}
                hint="Уже вычтены из дня продажи — справочно"
                icon={Undo2}
              />
            )}
            {hasWarrantyLoss && (
              <StatCard
                compact
                label="Гарантия (убыток)"
                value={<Money value={-(totals.warrantyLoss ?? 0)} className="text-bad-text" />}
                hint="Не входит в оборот — запчасти + оплата мастеру"
                icon={ShieldAlert}
                tone="bad"
              />
            )}
            {hasInstallmentPaid && (
              <StatCard
                compact
                label="Погашения рассрочки"
                value={<Money value={totals.installmentPaid ?? 0} signed />}
                hint={
                  installmentPaidParts.length > 0
                    ? `в т.ч. ${installmentPaidParts.join(' · ')}`
                    : 'Не входит в оборот — оплата прошлых продаж'
                }
                icon={Coins}
              />
            )}
            {hasCollections && (
              <StatCard
                compact
                label="Инкассации"
                value={<Money value={-(totals.collections ?? 0)} />}
                hint="Изъято из кассы и сейфа за период"
                icon={ArrowDownToLine}
              />
            )}
            {wallets && (
              <>
                <StatCard compact label="В кассе сейчас" value={formatMoney(wallets.drawer)} icon={Wallet} />
                <StatCard compact label="В сейфе сейчас" value={formatMoney(wallets.safe)} icon={Landmark} />
              </>
            )}
          </div>
        )
      )}

      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        isEmpty={days.length === 0}
        empty={{
          icon: Wallet,
          title: 'За период движения денег нет',
          description: 'Проведённых чеков и платежей за выбранные дни не было',
        }}
        errorTitle="Не удалось загрузить движение денег"
        loader={<DataTable<CashFlowDay> columns={columns} rows={[]} rowKey={(d) => d.date} isLoading />}
        minHeight="min-h-[30vh]"
      >
        <DataTable<CashFlowDay>
          columns={columns}
          rows={days}
          rowKey={(d) => d.date}
          caption="Движение денег по дням"
          className="overflow-x-auto"
        />
      </QueryState>
    </div>
  );
}
