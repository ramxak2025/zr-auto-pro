import type { AttentionBucketId } from '../types';
export const ATTENTION_LABELS: Record<AttentionBucketId, string> = {
  bookings: 'Заявки на запись',
  deferred: 'Отложенные чеки',
  'purchase-orders': 'Заказы к приёмке',
  'low-stock': 'Товары на исходе',
  installments: 'Просроченные рассрочки',
};
export const ATTENTION_LINKS: Record<AttentionBucketId, string> = {
  bookings: '/bookings?tab=requests&status=pending',
  deferred: '/checks?isDeferred=true',
  'purchase-orders': '/purchase-orders?status=ordered',
  'low-stock': '/products?lowStock=true',
  installments: '/installments?status=overdue',
};
export const EARNINGS_EXPLANATION = 'С учётом премий, мотивации и штрафов. Выплаты и авансы не вычитаются';
export const earningsMoney = (amount: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
