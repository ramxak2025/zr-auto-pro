import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react';

import { managerApi } from '../../api/services';
import PageHeader from '../../components/PageHeader';
import { ErrorRow } from '../../components/admin/adminUi';
import ManagerBalanceTiles from '../../components/admin/ManagerBalanceTiles';
import ManagerLedgerFeed, { LEDGER_DEFAULT_MONTHS } from '../../components/admin/ManagerLedgerFeed';
import { managerKeys } from '../../components/admin/managerQueryKeys';
import { useManagerSummary } from '../../components/admin/useManagerSummary';

/*
 * «Расчёты» менеджера: баланс перед владельцем платформы и лента платных продлений с долей владельца
 * и внесённых расчётов. Только чтение — расчёты вносит владелец платформы.
 */

export default function ManagerLedgerPage() {
  const [months, setMonths] = useState(LEDGER_DEFAULT_MONTHS);

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    isFetching: summaryFetching,
    refetch: refetchSummary,
  } = useManagerSummary();

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: managerKeys.ledger(months),
    queryFn: () => managerApi.ledger({ months }),
    select: (res) => res.data,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Расчёты" icon={Scale} subtitle="Оплаты ваших клиентов, доля владельца и внесённые расчёты" />

      {summaryError && !summary ? (
        <ErrorRow message="Не удалось загрузить баланс" onRetry={() => refetchSummary()} loading={summaryFetching} />
      ) : (
        <ManagerBalanceTiles summary={summary} viewer="manager" loading={summaryLoading} />
      )}

      <ManagerLedgerFeed
        ledger={data}
        isLoading={isLoading}
        isError={isError}
        isFetching={isFetching}
        onRetry={() => refetch()}
        months={months}
        onMonthsChange={setMonths}
        caption="Расчёты с владельцем платформы"
      />
    </div>
  );
}
