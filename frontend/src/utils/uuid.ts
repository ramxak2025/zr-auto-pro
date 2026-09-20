/**
 * UUID v4 для клиента — с фолбэком, потому что `crypto.randomUUID` есть не везде.
 *
 * `crypto.randomUUID()` появился в iOS Safari 15.4 / Chrome 92 и, сверх того,
 * доступен ТОЛЬКО в secure context: на `http://`-origin или по «голому» IP
 * (локалка, стенд) его нет даже в свежем браузере. Голый вызов в теле
 * компонента поэтому кидает `TypeError: crypto.randomUUID is not a function`
 * прямо во время рендера — React разматывает дерево до корневого
 * ErrorBoundary, и вместо экрана человек видит карточку ошибки.
 *
 * Формат фолбэка — настоящая UUID v4 (hex с версией и вариантом): бэкенд
 * валидирует idempotency-ключи по этой форме и на произвольную строку
 * отвечает 400. Зеркалит `mobile/src/utils/offlineCheckQueue.ts::uuidV4FromRandom`.
 */
export function newUuid(): string {
  const cryptoObj = typeof crypto !== 'undefined' ? (crypto as { randomUUID?: () => string }) : undefined;
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
