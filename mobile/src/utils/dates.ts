/**
 * Локальные date-only хелперы.
 *
 * ВАЖНО: `new Date().toISOString().slice(0, 10)` отдаёт дату в UTC. Для
 * России (UTC+3…UTC+12) это значит, что после местной полуночи и до
 * UTC-полуночи "сегодня" считается ВЧЕРАШНИМ днём — «Звонки сегодня»,
 * финансовые периоды отчётов и login-prefetch попадали не в тот день.
 * Все date-only строки для запросов собираем из ЛОКАЛЬНЫХ компонентов.
 */

/** YYYY-MM-DD в локальной временной зоне устройства. */
export const toLocalISODate = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
