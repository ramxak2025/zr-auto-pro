/**
 * Опция «VIN-код автомобиля» тенанта (171, 2026-09-25).
 *
 * ПРИЗНАК — `user.tenant.vinEnabled === true` (спека, раздел 4): приезжает в
 * профиле с /auth/login и /auth/me ЛЮБОЙ роли, как и часовой пояс (см.
 * `useTenantTimezone` в contexts/TenantTimezoneContext.tsx — тот же приём).
 * Пока опция выключена, в UI нет НИ ОДНОГО упоминания VIN: поле у машины,
 * режим поиска в Кассе, плейсхолдеры — всё рендерится только при true.
 *
 * ОТКУДА ЧИТАЕМ (по убыванию свежести):
 *   1. кэш ['my-company'] (GET /my-company, ключ company_manage) — если в нём
 *      есть boolean-флаг: карточка «Автомобили» в настройках компании пишет
 *      сюда тумблер сразу (optimistic) и после ответа сервера, поэтому
 *      владелец без перелогина видит поле VIN в формах и сегмент «VIN» в Кассе;
 *   2. профиль `user.tenant.vinEnabled` — единственный источник у мастера;
 *      после переключения тумблера настройки зовут refreshUser(), и он тоже
 *      обновляется.
 *
 * Кэш ['vin-settings'] (GET/PATCH /vin/settings) хук НЕ читает: это снимок
 * экрана настроек, он живёт своей жизнью (staleTime, откаты optimistic) и,
 * оказавшись «свежее» профиля, перекрывал бы серверную правду.
 *
 * Хук сам НИЧЕГО не запрашивает (`enabled: false`) — только подписан на чужой
 * кэш; у мастера он пуст, и хук молча берёт профиль. Легаси-payload без поля
 * → false, ровно как трактует его сервер.
 */
import { useQuery } from '@tanstack/react-query';

import { myCompanyApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { Tenant } from '../../../shared/types';

/** Ключ кэша настроек VIN — карточка «Автомобили» в настройках компании. */
export const VIN_SETTINGS_KEY = ['vin-settings'] as const;

/** Чистое правило приоритета источников — вынесено ради теста. */
export function resolveVinEnabled(input: {
  company?: Pick<Tenant, 'vinEnabled'> | null;
  tenant?: Pick<Tenant, 'vinEnabled'> | null;
}): boolean {
  if (input.company && typeof input.company.vinEnabled === 'boolean') return input.company.vinEnabled;
  return input.tenant?.vinEnabled === true;
}

export function useVinEnabled(): boolean {
  const { user } = useAuth();
  const { data: company } = useQuery<Tenant>({
    queryKey: ['my-company'],
    // queryFn обязателен по контракту react-query, но при enabled: false не
    // вызывается — хук только читает кэш, который пишут настройки компании.
    queryFn: async () => (await myCompanyApi.get()).data,
    enabled: false,
  });
  return resolveVinEnabled({ company, tenant: user?.tenant });
}
