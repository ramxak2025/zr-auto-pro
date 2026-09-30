import { Banknote, Landmark, PiggyBank, Receipt, Scale, Wallet } from 'lucide-react';

import type { ManagerSummary } from '../../types';
import { StatCard } from '../../ui/StatCard';
import { SkeletonCard } from '../../ui/Skeleton';
import { balanceCaption, balanceTone, formatRubExact } from './MoneyExact';

export interface ManagerBalanceTilesProps {
  summary?: ManagerSummary;
  /** Кто смотрит: от этого зависит подпись под балансом («Менеджер должен владельцу» / «Вы должны владельцу»). */
  viewer: 'owner' | 'manager';
  loading?: boolean;
}

/** Плитки денег менеджера: баланс перед владельцем, оплаты и доля владельца за месяц и за всё время, внесённые расчёты. */
export default function ManagerBalanceTiles({ summary, viewer, loading = false }: ManagerBalanceTilesProps) {
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} lines={1} className="p-4" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <StatCard
        compact
        label={viewer === 'owner' ? 'Баланс менеджера' : 'Долг владельцу'}
        value={formatRubExact(summary.balance)}
        hint={balanceCaption(summary.balance, viewer)}
        icon={Scale}
        tone={balanceTone(summary.balance)}
        className="col-span-2 lg:col-span-1"
      />
      <StatCard
        compact
        label="Оплаты за месяц"
        value={formatRubExact(summary.paidThisMonth)}
        hint="платные продления"
        icon={Wallet}
      />
      <StatCard
        compact
        label="Доля владельца за месяц"
        value={formatRubExact(summary.ownerShareThisMonth)}
        hint={`текущая доля ${summary.ownerSharePercent} %`}
        icon={Landmark}
      />
      <StatCard compact label="Оплаты за всё время" value={formatRubExact(summary.paidTotal)} icon={Receipt} />
      <StatCard
        compact
        label="Доля владельца за всё время"
        value={formatRubExact(summary.ownerShareTotal)}
        icon={PiggyBank}
      />
      <StatCard
        compact
        label="Внесено расчётами"
        value={formatRubExact(summary.settledTotal)}
        hint="передано владельцу"
        icon={Banknote}
      />
    </div>
  );
}
