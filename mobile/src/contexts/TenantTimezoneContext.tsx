import { useQuery } from '@tanstack/react-query';

import { myCompanyApi } from '../api/services';
import type { Tenant } from '../../../shared/types';
import { DEFAULT_TIMEZONE, timezoneOption } from '../../../shared/utils/formatters';
import { useAuth } from './AuthContext';

/**
 * Часовой пояс АВТОСЕРВИСА для экранов, где показывается ВРЕМЯ операции
 * (журнал чеков, деталка чека, кассовая смена, движение денег, звонки, смены).
 *
 * ЗАЧЕМ. Сервер считает бизнес-сутки по tenants.timezone (миграция 157), а
 * клиент до сих пор рисовал время устройства. Владелец из Владивостока,
 * улетевший в Москву, видел чек «в 12:40» вместо «в 19:40» — время на экране
 * расходилось с тем днём, в который сервер этот чек посчитал.
 *
 * ОТКУДА БЕРЁТСЯ ПОЯС. Из профиля (`user.tenant.timezone`), который приезжает с
 * /auth/login и /auth/me — доступен ЛЮБОЙ роли. Специально не через
 * GET /my-company: тот закрыт ключом company_manage, и мастер получил бы 403.
 *
 * Кэш ['my-company'] важнее профиля, если он уже прогрет: владелец, только что
 * сменивший пояс в «Настройках компании», видит новое время сразу, не дожидаясь
 * обновления сессии. `enabled: false` — этот хук НИЧЕГО не запрашивает, только
 * подписывается на чужой кэш; у мастера он пуст, и хук молча берёт профиль.
 *
 * Неизвестное/пустое значение → Europe/Moscow, ровно как трактует его сервер
 * (normalizeTimezone), поэтому экран не может остаться без пояса.
 */
export function useTenantTimezone(): string {
  const { user } = useAuth();
  const { data: company } = useQuery<Tenant>({
    queryKey: ['my-company'],
    // queryFn обязателен по контракту react-query, но при enabled: false он не
    // вызывается ни разу — хук только читает кэш, который прогревают экраны с
    // правом company_manage.
    queryFn: async () => (await myCompanyApi.get()).data,
    enabled: false,
  });
  const raw = company?.timezone || user?.tenant?.timezone || DEFAULT_TIMEZONE;
  return timezoneOption(raw).id;
}
