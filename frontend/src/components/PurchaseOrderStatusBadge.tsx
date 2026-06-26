import type { PurchaseOrderStatus } from '../types';

interface StatusMeta {
  label: string;
  className: string;
}

export const PO_STATUS_META: Record<PurchaseOrderStatus, StatusMeta> = {
  draft: { label: 'Черновик', className: 'bg-gray-100 text-gray-600' },
  ordered: { label: 'Заказано', className: 'bg-blue-50 text-blue-700' },
  received: { label: 'Получено', className: 'bg-green-50 text-green-700' },
  cancelled: { label: 'Отменён', className: 'bg-red-50 text-red-700' },
};

export default function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const meta = PO_STATUS_META[status] ?? PO_STATUS_META.draft;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
