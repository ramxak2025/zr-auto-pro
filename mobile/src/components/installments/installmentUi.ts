/**
 * Shared helpers for the «Рассрочка» (installments) UI — money / date
 * formatting and the open|overdue|closed status chip palette. Colocated so the
 * list, the dashboard widget, the client-card section and the detail screen all
 * render plans identically. Pure functions only (no JSX) — safe to import from
 * anywhere.
 */
import { colors, getBadgeColors } from '../../theme';
import type { InstallmentPlan } from '../../../../shared/types';

/** Integer-rubles money: "12 500 ₽". Strips the kopeck tail by rounding. */
export function formatInstallmentMoney(v: number): string {
  return (
    Math.round(Math.abs(v || 0))
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

const RU_MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Local-date → 'YYYY-MM-DD'. Built from LOCAL components so the next-payment
 *  date never drifts a day across the UTC boundary (the backend slices the
 *  string straight to a date). */
export function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' (or ISO) → "30 июн 2026". Empty string for nullish input. */
export function formatYmdHuman(ymd?: string | null): string {
  if (!ymd) return '';
  const datePart = String(ymd).slice(0, 10);
  const [y, m, d] = datePart.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return '';
  return `${d} ${RU_MONTHS_SHORT[m - 1] ?? ''} ${y}`;
}

/** A 'YYYY-MM-DD' string back to a local Date (noon to dodge DST edges). */
export function ymdToDate(ymd?: string | null): Date {
  const datePart = ymd ? String(ymd).slice(0, 10) : '';
  const [y, m, d] = datePart.split('-').map((s) => parseInt(s, 10));
  if (y && m && d) return new Date(y, m - 1, d, 12, 0, 0, 0);
  return new Date();
}

/**
 * Human "due" label from the plan's server-computed `dueInDays`
 * (negative = overdue by N, 0 = today, positive = in N days). Closed plans
 * return ''. Plans without a scheduled date return 'Без даты'.
 */
export function dueLabel(plan: Pick<InstallmentPlan, 'status' | 'nextPaymentDate' | 'dueInDays'>): string {
  if (plan.status === 'closed') return '';
  if (!plan.nextPaymentDate) return 'Без даты';
  const n = plan.dueInDays;
  if (n == null) return formatYmdHuman(plan.nextPaymentDate);
  if (n < 0) return `Просрочено на ${pluralDays(Math.abs(n))}`;
  if (n === 0) return 'Платёж сегодня';
  if (n === 1) return 'Платёж завтра';
  return `Через ${pluralDays(n)}`;
}

/** RU pluralisation for "день / дня / дней". */
export function pluralDays(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word = 'дней';
  if (mod10 === 1 && mod100 !== 11) word = 'день';
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) word = 'дня';
  return `${abs} ${word}`;
}

export interface StatusChip {
  label: string;
  bg: string;
  text: string;
}

/** open (green) / overdue (red) / closed (gray) chip palette, theme-aware. */
export function statusChip(plan: Pick<InstallmentPlan, 'status' | 'overdue'>, mode: 'light' | 'dark'): StatusChip {
  const badge = getBadgeColors(mode);
  if (plan.status === 'closed') {
    return { label: 'Закрыта', bg: badge.gray.bg, text: badge.gray.text };
  }
  if (plan.overdue) {
    return { label: 'Просрочена', bg: badge.red.bg, text: badge.red.text };
  }
  return { label: 'Открыта', bg: badge.green.bg, text: badge.green.text };
}

/** Accent colour for the remaining-amount figure (red when owed, green paid). */
export function remainingColor(plan: Pick<InstallmentPlan, 'remaining' | 'overdue'>): string {
  if ((plan.remaining || 0) <= 0) return colors.green[600];
  return plan.overdue ? colors.red[600] : colors.amber[600];
}

// ── Contact / reminder helpers ─────────────────────────────────────────────
// Shared by the client card, the plan detail (manual reminders) and anywhere
// else we need to call / WhatsApp a client or build the reminder text. Pure.

/** Strip everything but digits — for tel: / whatsapp deep links. */
export function rawPhoneDigits(phone?: string | null): string {
  return (phone || '').replace(/[^\d]/g, '');
}

/** `tel:+<digits>` (keeps a single leading + so iOS recognises the format). */
export function telHref(phone?: string | null): string {
  const digits = rawPhoneDigits(phone);
  return `tel:${digits.length > 0 ? '+' + digits : ''}`;
}

/**
 * WhatsApp deep link that opens the chat with NO prefilled text — the owner
 * types (or pastes the copied reminder) themselves. Native `whatsapp://send`
 * avoids the wa.me web bounce.
 */
export function whatsappHref(phone?: string | null): string {
  return `whatsapp://send?phone=${rawPhoneDigits(phone)}`;
}

/** Default RU reminder template. Placeholders: {clientName} {amount} {date}. */
export const DEFAULT_REMINDER_TEMPLATE = 'Здравствуйте, {clientName}! Напоминаем, у вас оплата {amount} до {date}.';

/**
 * Fill a reminder template with a plan's values. {amount} → the outstanding
 * remainder, {date} → the next-payment date (human), {clientName} → the client.
 * Used by the «Скопировать» action so the owner can paste it into WhatsApp.
 */
export function buildReminderText(
  template: string | null | undefined,
  plan: Pick<InstallmentPlan, 'clientName' | 'remaining' | 'nextPaymentDate'>,
): string {
  const tpl = template && template.trim() ? template : DEFAULT_REMINDER_TEMPLATE;
  return tpl
    .replace(/\{clientName\}/g, plan.clientName || 'клиент')
    .replace(/\{amount\}/g, formatInstallmentMoney(plan.remaining))
    .replace(/\{date\}/g, plan.nextPaymentDate ? formatYmdHuman(plan.nextPaymentDate) : 'ближайшее время');
}
