import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Wallet, Gift } from 'lucide-react';

import type { SubscriptionPeriodKind } from '../types';
import { Badge } from '../ui/Badge';

interface Props {
  /** 'paid' | 'free' | null — from tenant.currentPeriodKind / cabinet.subscription. */
  kind: SubscriptionPeriodKind | null | undefined;
  /** The date the current period runs until (subscriptionEnd). */
  until?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * 122 — «оплачено до …» / «бесплатно до …» для кабинета суперадмина.
 * Ничего не рендерит, когда вид периода неизвестен (legacy-payload / тенант
 * ни разу не продлевался через реестр). Платный период = деньги пришли → ok;
 * бесплатный — никогда не выручка → нейтральный.
 */
export default function SubscriptionPeriodBadge({ kind, until, size = 'md', className = '' }: Props) {
  if (!kind) return null;

  const paid = kind === 'paid';
  const label = paid ? 'Оплачено до' : 'Бесплатно до';
  const dateStr = until ? format(parseISO(until), 'd MMM yyyy', { locale: ru }) : null;

  return (
    <Badge tone={paid ? 'ok' : 'neutral'} icon={paid ? Wallet : Gift} size={size} className={className}>
      <span className="tabular-nums">
        {label}
        {dateStr ? ` ${dateStr}` : ''}
      </span>
    </Badge>
  );
}
