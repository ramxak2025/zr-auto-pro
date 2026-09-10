import { getZonedParts, zonedDateKey, zonedMidnight } from './timezone';

/**
 * Окно «прошлого периода» для сравнения на дашборде.
 * --------------------------------------------------------------------------
 * ЗАЧЕМ. Владелец 9 сентября видел «оборот −68 % к прошлому месяцу»: 1–9
 * сентября сравнивались с ПОЛНЫМ августом (1–31). В начале месяца такая дельта
 * всегда сильно отрицательная и не значит ничего — сравнивались отрезки разной
 * длины. Правильное сравнение — «на ту же дату»: 1–9 сентября против 1–9
 * августа.
 *
 * ПОЧЕМУ НА СЕРВЕРЕ. Отрезок обязан считаться в поясе автосервиса
 * (tenants.timezone, миграция 157) — клиент знает только пояс устройства, и
 * владелец во Владивостоке, открывший приложение в 01:00, получил бы обрезку по
 * вчерашнему дню. Плюс расчёт один на три клиента (iOS / Android / web), а не
 * три расходящиеся копии.
 *
 * ЧТО НЕ МЕНЯЕТСЯ. Обрезка по дню применяется ТОЛЬКО к месяцу. Неделя, день и
 * год и раньше сравнивались равными отрезками (прошлая неделя целиком,
 * вчерашний день целиком, прошлый год целиком) — их семантику мы не трогаем,
 * иначе поедут уже работающие экраны.
 */

/** Периоды дашборда, для которых считается сравнение. */
export type ComparePeriod = 'today' | 'week' | 'month' | 'year';

/** Родительный падеж — для подписи с числом («к 9 августа»). */
const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** Дательный падеж — для подписи без числа («к августу»). */
const MONTHS_DATIVE = [
  'январю',
  'февралю',
  'марту',
  'апрелю',
  'маю',
  'июню',
  'июлю',
  'августу',
  'сентябрю',
  'октябрю',
  'ноябрю',
  'декабрю',
];

/** Сколько дней в календарном месяце (monthIndex 0-based, как у Date.UTC). */
function daysInMonth(year: number, monthIndex: number): number {
  // День 0 следующего месяца = последний день искомого; арифметика в UTC,
  // потому что число дней в месяце от пояса не зависит.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Окно сравнения: границы-инстанты + местные даты + готовая подпись. */
export interface PeriodComparison {
  /** Начало окна — местная полночь как UTC-инстант (включительно). */
  from: Date;
  /**
   * Конец окна ВКЛЮЧИТЕЛЬНО — за секунду до следующей местной полуночи.
   * Та же форма, что у верхних границ в checks/reports (`date <= $n`).
   */
  to: Date;
  /** Местная календарная дата начала, 'YYYY-MM-DD'. */
  fromKey: string;
  /** Местная календарная дата конца, 'YYYY-MM-DD'. */
  toKey: string;
  /**
   * true — окно обрезано по тому же дню месяца, что прожит в текущем периоде
   * (месяц-к-дате против месяца-к-той-же-дате). false — сравнивается целый
   * период (закрытый месяц, неделя, год, вчерашний день).
   */
  truncated: boolean;
  /** Подпись для чипа дельты: «к 9 августа», «к августу», «к прошлой неделе». */
  label: string;
}

/**
 * Окно прошлого периода, сопоставимое с текущим.
 *
 * `currentFrom` / `currentTo` — уже посчитанные границы ПОКАЗЫВАЕМОГО окна
 * (местная полночь и «секунда до следующей полуночи»). Хелпер не пересчитывает
 * их сам сознательно: границы текущего окна живут в вызывающем коде (там же,
 * где ось графика), и второй, отдельно написанный расчёт рано или поздно
 * разъехался бы с первым на границе месяца.
 *
 * Возвращает null, если окно ещё не началось (навигация в будущий месяц):
 * сравнивать нечего, и честнее показать прочерк, чем дельту к первому дню
 * прошлого месяца.
 */
export function previousComparableWindow(args: {
  tz: string;
  period: ComparePeriod;
  currentFrom: Date;
  currentTo: Date;
  now?: Date;
}): PeriodComparison | null {
  const { tz, period, currentFrom, currentTo } = args;
  const now = args.now ?? new Date();

  // Окно в будущем — сравнивать не с чем.
  if (now.getTime() < currentFrom.getTime()) return null;

  // Верхняя граница прошлого окна для непрерывных периодов — ровно секунда до
  // начала текущего: прошлая неделя/год/вчера примыкают к показываемому окну.
  const justBeforeCurrent = new Date(currentFrom.getTime() - 1000);
  const parts = getZonedParts(currentFrom, tz);
  const y = parts.year;
  const mIdx = parts.month - 1; // 0-based, как у Date.UTC
  const d = parts.day;

  if (period === 'today') {
    const from = zonedMidnight(tz, y, mIdx, d - 1);
    const p = getZonedParts(from, tz);
    return {
      from,
      to: justBeforeCurrent,
      fromKey: zonedDateKey(from, tz),
      toKey: zonedDateKey(justBeforeCurrent, tz),
      truncated: false,
      label: `к ${p.day} ${MONTHS_GENITIVE[p.month - 1]}`,
    };
  }

  if (period === 'week') {
    const from = zonedMidnight(tz, y, mIdx, d - 7);
    return {
      from,
      to: justBeforeCurrent,
      fromKey: zonedDateKey(from, tz),
      toKey: zonedDateKey(justBeforeCurrent, tz),
      truncated: false,
      label: 'к предыдущей неделе',
    };
  }

  if (period === 'year') {
    const from = zonedMidnight(tz, y - 1, 0, 1);
    return {
      from,
      to: justBeforeCurrent,
      fromKey: zonedDateKey(from, tz),
      toKey: zonedDateKey(justBeforeCurrent, tz),
      truncated: false,
      label: `к ${y - 1} году`,
    };
  }

  // ── month: обрезаем прошлый месяц по тому же дню ──────────────────────────
  // Сколько дней текущего месяца уже прожито. Закрытый месяц (навигация назад)
  // прожит целиком — тогда сравниваем месяц с месяцем, как раньше.
  const finished = now.getTime() > currentTo.getTime();
  const elapsedDays = finished ? daysInMonth(y, mIdx) : getZonedParts(now, tz).day;

  const from = zonedMidnight(tz, y, mIdx - 1, 1);
  const prevParts = getZonedParts(from, tz);
  const prevY = prevParts.year;
  const prevMIdx = prevParts.month - 1;
  const prevLength = daysInMonth(prevY, prevMIdx);
  // 31 марта против февраля: 31-го числа в феврале нет — берём февраль до конца
  // включительно. Тот же клэмп закрывает 29/30 марта и 31 мая против апреля.
  const cutDay = Math.min(elapsedDays, prevLength);
  const truncated = cutDay < prevLength;
  // Верхняя граница = конец cutDay-го дня прошлого месяца. Для необрезанного
  // месяца это ровно секунда до начала текущего — совпадает с прежним `< $monthStart`.
  const to = new Date(zonedMidnight(tz, prevY, prevMIdx, cutDay + 1).getTime() - 1000);

  return {
    from,
    to,
    fromKey: zonedDateKey(from, tz),
    toKey: zonedDateKey(to, tz),
    truncated,
    label: truncated ? `к ${cutDay} ${MONTHS_GENITIVE[prevMIdx]}` : `к ${MONTHS_DATIVE[prevMIdx]}`,
  };
}
