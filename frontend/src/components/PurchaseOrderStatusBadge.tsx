import type { PurchaseOrderStatus } from '../types';
import { Badge } from '../ui/Badge';
import type { Tone } from '../ui/tokens';

interface StatusMeta {
  label: string;
  /** Семантический тон по смыслу: получено — деньги/товар пришли, отменён — плохо, заказано — активно. */
  tone: Tone;
}

export const PO_STATUS_META: Record<PurchaseOrderStatus, StatusMeta> = {
  draft: { label: 'Черновик', tone: 'neutral' },
  ordered: { label: 'Заказано', tone: 'accent' },
  received: { label: 'Получено', tone: 'ok' },
  cancelled: { label: 'Отменён', tone: 'bad' },
};

export default function PurchaseOrderStatusBadge({
  status,
  size = 'md',
}: {
  status: PurchaseOrderStatus;
  size?: 'sm' | 'md';
}) {
  const meta = PO_STATUS_META[status] ?? PO_STATUS_META.draft;
  return (
    <Badge tone={meta.tone} size={size} dot>
      {meta.label}
    </Badge>
  );
}
