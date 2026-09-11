import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfWeek, startOfMonth, endOfMonth } from 'date-fns';

import { myCompanyApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { Tenant } from '../../../shared/types';
import { DEFAULT_TIMEZONE, formatDayKey, timezoneOption } from '../../../shared/utils/formatters';

/**
 * Часовой пояс АВТОСЕРВИСА для экранов, где показывается ВРЕМЯ операции
 * (журнал чеков, деталка чека, кассовая смена, движение денег, звонки, смены).
 *
 * ЗАЧЕМ. Сервер считает бизнес-сутки по tenants.timezone (миграция 157), а
 * браузер рисовал время своей машины. Бухгалтер, открывший админку из другого
 * региона, видел чек «в 12:40» вместо «в 19:40» — время на экране расходилось с
 * тем днём, в который сервер этот чек посчитал.
 *
 * ОТКУДА БЕРЁТСЯ ПОЯС. Из профиля (`user.tenant.timezone`), который приезжает с
 * /auth/login и /auth/me — доступен ЛЮБОЙ роли. Специально не через
 * GET /my-company: тот закрыт ключом company_manage, и мастер получил бы 403.
 *
 * Кэш ['my-company'] важнее профиля, если он уже прогрет: владелец, только что
 * сменивший пояс в «Настройках компании», видит новое время сразу, не дожидаясь
 * обновления сессии. `enabled: false` — хук НИЧЕГО не запрашивает, только
 * подписывается на чужой кэш.
 *
 * Зеркало mobile/src/contexts/TenantTimezoneContext.tsx — держать в синхроне.
 */
export function useTenantTimezone(): string {
  const { user } = useAuth();
  const { data: company } = useQuery<Tenant>({
    queryKey: ['my-company'],
    // queryFn обязателен по контракту react-query, но при enabled: false он не
    // вызывается ни разу.
    queryFn: async () => (await myCompanyApi.get()).data,
    enabled: false,
  });
  const raw = company?.timezone || user?.tenant?.timezone || DEFAULT_TIMEZONE;
  return timezoneOption(raw).id;
}

/**
 * 'YYYY-MM-DD' → Date локальной полуночи. Над ним дальше делается ТОЛЬКО
 * календарная арифметика (начало недели/месяца), поэтому пояс машины на
 * результат не влияет — влияет лишь то, какой календарный день мы взяли за
 * «сегодня». `new Date('YYYY-MM-DD')` тут не годится: он разбирает строку как
 * UTC-полночь и западнее Гринвича уводит день назад.
 */
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/** Календарные опоры автосервиса. Все поля — 'YYYY-MM-DD', кроме month ('YYYY-MM'). */
export interface TenantCalendar {
  /** Пояс автосервиса — тот же, что отдаёт useTenantTimezone. */
  timeZone: string;
  /** Сегодня по календарю АВТОСЕРВИСА. */
  today: string;
  /** Понедельник текущей недели автосервиса. */
  weekStart: string;
  /** Первое число текущего месяца автосервиса. */
  monthStart: string;
  /** Последнее число текущего месяца автосервиса. */
  monthEnd: string;
  /** Текущий месяц автосервиса как 'YYYY-MM' (ключ зарплатного периода). */
  month: string;
}

/**
 * КАЛЕНДАРЬ АВТОСЕРВИСА — один источник «сегодня / эта неделя / этот месяц»
 * для всех страниц, которые отправляют dateFrom/dateTo на сервер.
 *
 * ЗАЧЕМ. Сервер режет бизнес-сутки поясом тенанта (миграция 157,
 * common/timezone.ts), а страницы считали границы периодов часами БРАУЗЕРА.
 * Расхождение вылезает у любого, кто открыл админку из другого региона:
 * владелец из Владивостока в 08:00 своего утра (в Москве ещё 01:00) видел
 * «Сегодня» как ЗАВТРАШНИЙ для сервера день — пустую кассу и пустые расходы; в
 * ночь на 1-е число «Месяц» просил уже новый месяц, пока сервер был в старом.
 *
 * Считаем один раз на рендер и мемоизируем по поясу: строки-ключи попадают в
 * queryKey, и новый объект на каждый рендер дёргал бы запросы впустую.
 */
export function useTenantCalendar(): TenantCalendar {
  const timeZone = useTenantTimezone();
  const today = formatDayKey(new Date(), timeZone);
  return useMemo(() => {
    const day = parseDayKey(today);
    return {
      timeZone,
      today,
      weekStart: format(startOfWeek(day, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      monthStart: format(startOfMonth(day), 'yyyy-MM-dd'),
      monthEnd: format(endOfMonth(day), 'yyyy-MM-dd'),
      month: today.slice(0, 7),
    };
  }, [timeZone, today]);
}
