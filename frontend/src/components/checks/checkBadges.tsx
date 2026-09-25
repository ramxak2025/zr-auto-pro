import { ShieldAlert } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import type { Tone } from '../../ui/tokens';
import type { Check } from '../../types';
import { paymentMethodLabels } from '../../../../shared/utils/formatters';

/**
 * Единые метки чека для Журнала, Розницы, Доски и деталки — чтобы одно и то же
 * состояние не кодировалось на каждой странице своим цветом. Тон только по
 * смыслу (DESIGN_SYSTEM.md, §1.3): деньги пришли — ok, ждёт — warn, возврат — bad.
 */

const paymentTone: Record<string, Tone> = {
  cash: 'ok',
  card: 'accent',
  cash_card: 'neutral',
  warranty: 'warn',
  installment: 'info',
};

/** Способ оплаты; гарантийный чек показывается как «Гарантия» независимо от способа. */
export function PaymentBadge({
  check,
  size = 'md',
}: {
  check: Pick<Check, 'paymentMethod' | 'isWarranty'>;
  size?: 'sm' | 'md';
}) {
  if (check.isWarranty) {
    return (
      <Badge tone="warn" size={size} icon={ShieldAlert}>
        Гарантия
      </Badge>
    );
  }
  return (
    <Badge tone={paymentTone[check.paymentMethod] ?? 'neutral'} size={size}>
      {paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}
    </Badge>
  );
}

/** Состояние чека — один бейдж: Возврат › Отложен › Проведён. */
export function CheckStatusBadge({
  check,
  size = 'md',
}: {
  check: Pick<Check, 'isReturned' | 'isDeferred'>;
  size?: 'sm' | 'md';
}) {
  if (check.isReturned) {
    return (
      <Badge tone="bad" size={size} dot>
        Возврат
      </Badge>
    );
  }
  if (check.isDeferred) {
    return (
      <Badge tone="warn" size={size} dot>
        Отложен
      </Badge>
    );
  }
  return (
    <Badge tone="ok" size={size} dot>
      Проведён
    </Badge>
  );
}

/** Госномер — контурная моноширинная метка (как в отложенных чеках на Главной). */
export function PlateBadge({
  plate,
  size = 'sm',
  className,
}: {
  plate: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Badge outline size={size} translate="no" className={`font-mono tracking-wide ${className ?? ''}`}>
      {plate}
    </Badge>
  );
}
