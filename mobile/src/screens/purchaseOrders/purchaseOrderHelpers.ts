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
import { colors, getBadgeColors } from '../../theme';
import { formatDayKey } from '../../../../shared/utils/formatters';
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

/** Status → dark badge palette key — drives the dark-mode chip fill + text. */
const PO_STATUS_BADGE_KEY: Record<PurchaseOrderStatus, 'gray' | 'blue' | 'green' | 'red'> = {
  draft: 'gray',
  ordered: 'blue',
  received: 'green',
  cancelled: 'red',
};

/**
 * Theme-aware status metadata.
 *
 * LIGHT returns the byte-identical `PO_STATUS_META` above (the web-matched
 * pale-`[50]` chips — DO NOT change them). DARK swaps the pale fills + dark
 * `[600]/[700]` text for the established translucent dark-badge colours
 * (`badgeColorsDark` via `getBadgeColors('dark')`) so the status chips and the
 * icon-tile that reuses `meta.bg` don't glow on the near-black canvas. `label`
 * + `icon` are theme-independent and carried through unchanged.
 */
export function getPoStatusMeta(mode: 'light' | 'dark'): Record<PurchaseOrderStatus, PoStatusMeta> {
  if (mode === 'light') return PO_STATUS_META;
  const badges = getBadgeColors('dark');
  const out = {} as Record<PurchaseOrderStatus, PoStatusMeta>;
  (Object.keys(PO_STATUS_META) as PurchaseOrderStatus[]).forEach((status) => {
    const base = PO_STATUS_META[status];
    const badge = badges[PO_STATUS_BADGE_KEY[status]];
    out[status] = { ...base, bg: badge.bg, text: badge.text };
  });
  return out;
}

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

/**
 * `Date` → `"YYYY-MM-DD"` БЕЗ UTC-сдвига (иначе дата уезжает на день назад).
 * Ровно этот формат уходит на сервер в `receivedAt`: это КАЛЕНДАРНЫЙ ДЕНЬ,
 * который пользователь выбрал в пикере, а сервер трактует его в ПОЯСЕ
 * АВТОСЕРВИСА (tenants.timezone, миграция 157) — как и веб (`input[type=date]`).
 */
export function toSupplyDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `Date` → `"09.09.2026"` — подпись на кнопке выбора даты поставки. */
export function formatSupplyDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** Тот ли это календарный день (локальный), что и `b`. */
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Датирована ли поставка ЗАДНИМ ЧИСЛОМ с точки зрения СЕРВЕРА.
 *
 * Сравнивать надо не «дату устройства с датой устройства», а выбранный
 * календарный день с «сегодня» У АВТОСЕРВИСА (tenants.timezone, 157): владелец
 * из Владивостока, открывший приложение в Москве, иначе видел бы «задним
 * числом» у сегодняшней поставки и наоборот. Без пояса (`timeZone` не передан)
 * поведение прежнее — по времени устройства.
 */
export function isBackdatedSupply(d: Date, timeZone?: string | null): boolean {
  return toSupplyDateStr(d) !== formatDayKey(new Date(), timeZone);
}

/**
 * Дата поставки не может быть в будущем (сервер отвечает 400) — пикер обязан
 * отсечь это раньше. Сравнение по КАЛЕНДАРНОМУ ДНЮ, и «сегодня» — это сегодня
 * У АВТОСЕРВИСА: сервер считает потолок в поясе тенанта, и клиент, меривший
 * будущее по устройству, отвергал бы у владивостокского сервиса его же
 * сегодняшний день (или, наоборот, пропускал завтрашний). Ключи формата
 * 'YYYY-MM-DD' сравниваются лексикографически = хронологически.
 */
export function isFutureDay(d: Date, timeZone?: string | null): boolean {
  return toSupplyDateStr(d) > formatDayKey(new Date(), timeZone);
}

/** Outstanding (not-yet-received) quantity for a line. Never negative. */
export function outstandingQty(quantity: number, receivedQuantity: number): number {
  return Math.max(0, (quantity || 0) - (receivedQuantity || 0));
}

// ── Supplier request («Сформировать запрос») ─────────────────────────────────
// Plain-text message a manager sends to a supplier asking for current prices.
// Deliberately price-LESS and total-LESS: each line is «• <name> — <qty> шт»
// with a friendly header + footer. Works without any messaging API — the text
// is copied (share sheet) or handed to WhatsApp via a `whatsapp://send` deep
// link. Pure + RN-free so it unit-tests under the node jest env.

export interface SupplierRequestLine {
  /** Product name exactly as stored in the warehouse (snapshot is fine). */
  name: string;
  quantity: number;
}

/**
 * Build the supplier price-request text.
 *
 * @param lines        order positions (name + qty). Empty/blank names skipped.
 * @param supplierName optional — greets the supplier by name when present.
 */
export function buildSupplierRequestText(lines: SupplierRequestLine[], supplierName?: string | null): string {
  const greeting = supplierName && supplierName.trim() ? `Здравствуйте, ${supplierName.trim()}!` : 'Здравствуйте!';
  const header = `${greeting}\nПодскажите, пожалуйста, наличие и актуальные цены на позиции:`;
  const body = lines
    .filter((l) => l.name && l.name.trim())
    .map((l) => `• ${l.name.trim()} — ${Math.max(1, Math.round(l.quantity || 0))} шт`)
    .join('\n');
  const footer = 'Будем благодарны за счёт с ценами. Заранее спасибо!';
  return `${header}\n\n${body}\n\n${footer}`;
}

/**
 * Best-effort `whatsapp://send` deep link. Strips every non-digit from the
 * phone (so `+7 (900) 123-45-67` → `79001234567`); when no usable phone is
 * present the link carries only the prefilled text and WhatsApp opens the
 * contact picker. Works WITHOUT the WhatsApp Business API.
 */
export function buildWhatsappLink(text: string, phone?: string | null): string {
  const digits = (phone || '').replace(/\D/g, '');
  const encoded = encodeURIComponent(text);
  return digits ? `whatsapp://send?phone=${digits}&text=${encoded}` : `whatsapp://send?text=${encoded}`;
}
