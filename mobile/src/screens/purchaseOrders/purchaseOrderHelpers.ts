/**
 * Shared presentation helpers for the «Заказы поставщикам» (purchase orders)
 * screens — status metadata, money + date formatting. Kept platform-agnostic
 * (no react-native imports beyond the colour palette) so the three screens
 * (list / create / detail) read identically.
 *
 * Status flow (backend `purchase-orders/`):
 *   draft → ordered → received   (or → cancelled at draft/ordered)
 * Receiving credits product stock server-side; received is terminal.
 */
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import type { PurchaseOrderStatus } from '../../../../shared/types';

export interface PoStatusMeta {
  label: string;
  /** Pale chip fill. */
  bg: string;
  /** Chip text + icon tint. */
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
}

/** Single source of truth for status colour + label across all three screens. */
export const PO_STATUS_META: Record<PurchaseOrderStatus, PoStatusMeta> = {
  draft: { label: 'Черновик', bg: colors.gray[100], text: colors.gray[600], icon: 'create-outline' },
  ordered: { label: 'Заказан', bg: colors.blue[50], text: colors.blue[600], icon: 'paper-plane-outline' },
  received: { label: 'Получен', bg: colors.green[50], text: colors.green[700], icon: 'checkmark-done-outline' },
  cancelled: { label: 'Отменён', bg: colors.red[50], text: colors.red[600], icon: 'close-circle-outline' },
};

/** Order used for the list status-filter chips. */
export const PO_STATUS_ORDER: PurchaseOrderStatus[] = ['draft', 'ordered', 'received', 'cancelled'];

/** `12345.6` → `"12 346 ₽"` — same thousands-separator idiom as the rest of the app. */
export function formatMoney(v: number): string {
  return (
    Math.round(v || 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

const MONTHS_SHORT = ['янв', 'февр', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'];

/** ISO → `"27 июн 2026"`. Empty string for nullish / invalid input. */
export function formatPoDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** Outstanding (not-yet-received) quantity for a line. Never negative. */
export function outstandingQty(quantity: number, receivedQuantity: number): number {
  return Math.max(0, (quantity || 0) - (receivedQuantity || 0));
}
