import { History, Trash2 } from 'lucide-react';

import type { ManagerLedger, ManagerSettlement } from '../../types';
import { Badge } from '../../ui/Badge';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { IconButton } from '../../ui/IconButton';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { cn } from '../../ui/cn';
import { formatDateRu } from './adminUi';
import { MoneyExact, formatRubExact } from './MoneyExact';

type LedgerPayment = ManagerLedger['payments'][number];

type FeedRow =
  | { kind: 'payment'; key: string; at: string; payment: LedgerPayment }
  | { kind: 'settlement'; key: string; at: string; settlement: ManagerSettlement };

/** Окна ленты: сервер принимает 1..36 месяцев (по умолчанию 12). */
export const LEDGER_MONTH_OPTIONS = [3, 12, 36] as const;
export const LEDGER_DEFAULT_MONTHS = 12;

/** Платежи и расчёты одной лентой, новые сверху: у платежа берём момент проведения, у расчёта — дату расчёта. */
function buildFeed(ledger: ManagerLedger | undefined): FeedRow[] {
  if (!ledger) return [];
  const rows: FeedRow[] = [
    ...ledger.payments.map((payment) => ({
      kind: 'payment' as const,
      key: `payment-${payment.id}`,
      at: payment.createdAt,
      payment,
    })),
    ...ledger.settlements.map((settlement) => ({
      kind: 'settlement' as const,
      key: `settlement-${settlement.id}`,
      at: settlement.settledOn,
      settlement,
    })),
  ];
  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export interface ManagerLedgerFeedProps {
  ledger: ManagerLedger | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  months: number;
  onMonthsChange: (months: number) => void;
  caption: string;
  /** Только у суперадмина: удаление внесённого расчёта. */
  onRemoveSettlement?: (settlement: ManagerSettlement) => void;
}

/** Лента расчётов менеджера: платные продления с долей владельца и внесённые расчёты. Баланс считает сервер за всё время. */
export default function ManagerLedgerFeed({
  ledger,
  isLoading,
  isError,
  isFetching,
  onRetry,
  months,
  onMonthsChange,
  caption,
  onRemoveSettlement,
}: ManagerLedgerFeedProps) {
  const rows = buildFeed(ledger);

  const columns: DataTableColumn<FeedRow>[] = [
    {
      key: 'date',
      header: 'Дата',
      width: 120,
      render: (r) => (
        <span className="whitespace-nowrap tabular-nums text-ink-2">{formatDateRu(r.at, 'd MMM yyyy')}</span>
      ),
    },
    {
      key: 'operation',
      header: 'Операция',
      render: (r) => {
        if (r.kind === 'settlement') {
          return (
            <span className="flex min-w-0 flex-col items-start gap-1">
              <Badge tone={r.settlement.amount > 0 ? 'info' : 'warn'} size="sm">
                {r.settlement.amount > 0 ? 'Расчёт с владельцем' : 'Корректировка'}
              </Badge>
              <span className="text-xs text-ink-3 [overflow-wrap:anywhere]">
                {r.settlement.note || 'Без комментария'}
              </span>
            </span>
          );
        }
        const p = r.payment;
        return (
          <span className="flex min-w-0 flex-col items-start gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone={p.isFree ? 'neutral' : 'ok'} size="sm">
                {p.isFree ? 'Бесплатный период' : 'Оплата'}
              </Badge>
              <span className="font-medium text-ink [overflow-wrap:anywhere]">{p.tenantName}</span>
            </span>
            <span className="text-xs text-ink-3">
              {p.planName ?? 'Тариф не указан'}
              {p.periodTo ? ` · до ${formatDateRu(p.periodTo, 'd MMM yyyy')}` : ''}
            </span>
          </span>
        );
      },
    },
    {
      key: 'balance',
      header: 'Изменение баланса',
      numeric: true,
      render: (r) => {
        if (r.kind === 'settlement') {
          // Внесённые деньги уменьшают долг менеджера, корректировка со знаком «−» — увеличивает.
          const delta = -r.settlement.amount;
          return (
            <MoneyExact
              value={delta}
              signed
              className={cn('font-semibold', delta < 0 ? 'text-ok-text' : 'text-bad-text')}
            />
          );
        }
        const p = r.payment;
        // Бесплатный период и платёж без снимка доли (ownerShareAmount = null) баланс не двигают.
        if (p.isFree || p.ownerShareAmount === null) return <span className="text-ink-3">—</span>;
        return (
          <span className="block">
            <MoneyExact value={p.ownerShareAmount} signed className="font-semibold text-ink" />
            <span className="block whitespace-nowrap text-xs font-normal text-ink-3">
              из {formatRubExact(p.amount)}
              {p.ownerSharePercent !== null ? ` · ${p.ownerSharePercent} %` : ''}
            </span>
          </span>
        );
      },
    },
  ];

  if (onRemoveSettlement) {
    columns.push({
      key: 'actions',
      header: '',
      interactive: true,
      width: 48,
      render: (r) =>
        r.kind === 'settlement' ? (
          <IconButton
            label={`Удалить расчёт от ${formatDateRu(r.settlement.settledOn, 'd MMM yyyy')}`}
            icon={Trash2}
            variant="danger"
            size="sm"
            onClick={() => onRemoveSettlement(r.settlement)}
          />
        ) : null,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-3">Новые сверху. Баланс считается за всё время, лента — за выбранный период.</p>
        <SegmentedControl
          size="sm"
          aria-label="Период ленты"
          value={String(months)}
          onChange={(v) => onMonthsChange(Number(v))}
          options={LEDGER_MONTH_OPTIONS.map((m) => ({ value: String(m), label: `${m} мес.` }))}
        />
      </div>
      <DataTable
        caption={caption}
        rows={rows}
        rowKey={(r) => r.key}
        columns={columns}
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить расчёты"
        emptyState={{
          icon: History,
          title: 'За этот период операций нет',
          description: 'Здесь появятся платные продления с долей владельца и внесённые расчёты.',
        }}
      />
    </div>
  );
}
