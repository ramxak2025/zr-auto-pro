/**
 * Format a number as Russian currency: "1 234 ₽"
 */
export function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} \u20BD`;
}

/**
 * Format a date string to DD.MM.YYYY
 */
export function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Format a date string to DD.MM.YY HH:mm
 */
export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(2);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Get a time-based greeting in Russian.
 */
export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}

/**
 * Payment method labels in Russian.
 */
export const paymentMethodLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал/Карта',
};

/**
 * Role labels in Russian.
 */
export const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
};

/**
 * Check if subscription has expired.
 */
export function isSubscriptionExpired(subscriptionEnd?: string | null): boolean {
  if (!subscriptionEnd) return false;
  return new Date(subscriptionEnd) < new Date();
}
