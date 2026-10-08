import { BadRequestException } from '@nestjs/common';
import { dayStartMsInZone, zonedDateKey } from '../common/timezone';

// ── Дата поставки (159 + пояс тенанта 157) ───────────────────────────────────
// Календарный «день поставки» считается в ПОЯСЕ АВТОСЕРВИСА (tenants.timezone),
// а не по фиксированному московскому сдвигу, который стоял здесь раньше. Для
// владивостокского сервиса «вчера» из пикера уезжало на сутки: с 00:00 до 09:00
// по местному времени МСК-день ещё вчерашний, и «сегодня» отвергалось как
// будущее. Идиома один-в-один с checks.service.ts (правка даты продажи чека):
// пояс читается ОДИН раз на операцию (getTenantTimezone кеширует) и передаётся
// вниз параметром, вся арифметика живёт в common/timezone.ts.
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Не глубже 3 лет — защита от опечатки года (2026 → 1026 и т.п.). */
const SUPPLY_DATE_MAX_PAST_MS = 3 * 365 * DAY_MS;

/** Календарный день (yyyy-MM-dd) момента `ts` в поясе тенанта. */
const tenantDayOf = (ts: number, tz: string): string => zonedDateKey(new Date(ts), tz);

/** UTC-timestamp начала местного дня `yyyy-MM-dd`. NaN на кривом дне. */
const tenantDayStartMs = (day: string, tz: string): number => dayStartMsInZone(tz, day);

/**
 * Нормализовать присланную дату поставки в ISO.
 *   • пусто (undefined / null / '') → null — «датировать текущим моментом»
 *     (поведение до 159, обратная совместимость);
 *   • 'YYYY-MM-DD' (веб `input[type=date]` и мобильный пикер) → этот МЕСТНЫЙ
 *     день со ВРЕМЕНЕМ СУТОК от `anchorTs`: у приёмки это «сейчас»
 *     (сегодняшняя дата ⇒ ровно текущий момент), у смены даты — время
 *     исходной приёмки, чтобы позиция документа внутри дня не прыгала;
 *   • полный ISO — как есть, по миллисекундам.
 *
 * Границы (требование владельца): будущее запрещено — потолок «конец сегодня»
 * по МЕСТНОМУ времени; глубже 3 лет — тоже 400, чтобы опечатка не улетела в
 * 1970.
 */
export function resolveSupplyDate(raw: unknown, anchorTs: number, tz: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;

  const rawStr = String(raw).trim();
  let ts: number;
  if (DATE_ONLY_RE.test(rawStr)) {
    const dayStart = tenantDayStartMs(rawStr, tz);
    if (!Number.isFinite(dayStart)) {
      throw new BadRequestException({ message: 'Некорректная дата поставки' });
    }
    ts = dayStart + (anchorTs - tenantDayStartMs(tenantDayOf(anchorTs, tz), tz));
  } else {
    ts = new Date(rawStr).getTime();
  }
  if (!Number.isFinite(ts)) {
    throw new BadRequestException({ message: 'Некорректная дата поставки' });
  }

  const now = Date.now();
  // Потолок — конец СЕГОДНЯШНЕГО местного дня: «сегодня» в любое время суток
  // проходит, завтра и дальше — нет.
  if (ts >= tenantDayStartMs(tenantDayOf(now, tz), tz) + DAY_MS) {
    throw new BadRequestException({ message: 'Дата поставки не может быть в будущем' });
  }
  if (ts < now - SUPPLY_DATE_MAX_PAST_MS) {
    throw new BadRequestException({ message: 'Дата поставки не может быть старше 3 лет' });
  }
  return new Date(ts).toISOString();
}

/** Задним ли числом датирована поставка (день раньше сегодняшнего у тенанта). */
export const isBackdated = (iso: string | null, tz: string): boolean =>
  !!iso && tenantDayOf(new Date(iso).getTime(), tz) < tenantDayOf(Date.now(), tz);
