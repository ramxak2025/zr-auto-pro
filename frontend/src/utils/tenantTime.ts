/**
 * Отображение времени операций в поясе АВТОСЕРВИСА (tenants.timezone, 157).
 *
 * ПРОБЛЕМА. Веб форматирует даты через date-fns `format`, а он умеет читать
 * только ЛОКАЛЬНОЕ время браузера (getHours/getDate). Сервер же относит чек,
 * смену и звонок к бизнес-суткам тенанта. Бухгалтер, открывший админку из
 * другого региона, видел у чека чужое время и чужой день.
 *
 * РЕШЕНИЕ БЕЗ НОВОЙ ЗАВИСИМОСТИ (`date-fns-tz` в проект не тянем). `zoned`
 * возвращает ДРУГОЙ инстант — такой, у которого локальные геттеры браузера
 * дают настенное время нужного пояса. Дальше `format(zoned(d, tz), …)`
 * печатает ровно то, что видит владелец у себя.
 *
 * ОГРАНИЧЕНИЯ, о которых важно помнить:
 *   • результат — ТОЛЬКО ДЛЯ ПОКАЗА. Его нельзя отправлять на сервер,
 *     сравнивать с `Date.now()` или вычитать из другой даты;
 *   • если в поясе БРАУЗЕРА в этот момент перевод часов и полученное настенное
 *     время не существует, движок сдвинет его на час. Российские пояса часы не
 *     переводят, поэтому для нашего продукта это теоретический край;
 *   • Intl с неизвестным поясом бросает — тогда возвращаем исходную дату, то
 *     есть прежнее поведение (время браузера), а не сломанный экран.
 */

/** Кеш форматтеров: их создание дорогое, а зовём мы их на каждую ячейку. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
    return f;
  } catch {
    return null;
  }
}

/**
 * Дата, локальные геттеры которой равны настенному времени пояса `timeZone`.
 * Только для передачи в date-fns `format` — см. ограничения выше.
 */
export function zoned(value: string | Date, timeZone?: string | null): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (!timeZone || Number.isNaN(d.getTime())) return d;
  const formatter = getFormatter(timeZone);
  if (!formatter) return d;
  try {
    const parts = formatter.formatToParts(d);
    const get = (type: Intl.DateTimeFormatPartTypes): number => {
      const p = parts.find((x) => x.type === type);
      return p ? parseInt(p.value, 10) : NaN;
    };
    const year = get('year');
    const month = get('month');
    const day = get('day');
    // Часть сборок ICU отдаёт 24 вместо 0 для полуночи — иначе сутки уехали бы.
    const hour = get('hour') % 24;
    const minute = get('minute');
    const second = get('second');
    if ([year, month, day, hour, minute, second].some((n) => Number.isNaN(n))) return d;
    const shifted = new Date(year, month - 1, day, hour, minute, second, d.getMilliseconds());
    return Number.isNaN(shifted.getTime()) ? d : shifted;
  } catch {
    return d;
  }
}
