import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Wallet, Gift } from 'lucide-react';

import type { SubscriptionPeriodKind } from '../types';

interface Props {
  /** 'paid' | 'free' | null — from tenant.currentPeriodKind / cabinet.subscription. */
  kind: SubscriptionPeriodKind | null | undefined;
  /** The date the current period runs until (subscriptionEnd). */
  until?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * 122 — «оплачено до …» / «бесплатно до …» pill for the superadmin cabinet.
 * Renders nothing when the period kind is unknown (legacy payloads / never
 * extended through the ledger path). Paid = revenue → emerald; free = never
 * revenue → neutral slate.
 */
export default function SubscriptionPeriodBadge({ kind, until, size = 'md', className = '' }: Props) {
  if (!kind) return null;

  const paid = kind === 'paid';
  const label = paid ? 'Оплачено до' : 'Бесплатно до';
  const dateStr = until ? format(parseISO(until), 'd MMM yyyy', { locale: ru }) : null;
  const Icon = paid ? Wallet : Gift;

  const tone = paid ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : 'bg-slate-100 text-slate-600 ring-slate-200';
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ring-1 ${tone} ${pad} ${className}`}>
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span className="tabular-nums">
        {label}
        {dateStr ? ` ${dateStr}` : ''}
      </span>
    </span>
  );
}
