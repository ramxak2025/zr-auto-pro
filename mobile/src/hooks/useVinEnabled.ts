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
 *   1. кэш ['vin-settings'] (GET/PATCH /vin/settings, ключ company_manage) —
 *      его пишет карточка «Автомобили» в настройках компании: владелец
 *      переключил тумблер и тут же, без перелогина, видит поле VIN в формах
 *      и сегмент «VIN» в Кассе;
 *   2. кэш ['my-company'] (GET /my-company, тоже company_manage) — если прогрет;
 *   3. профиль `user.tenant.vinEnabled` — единственный источник у мастера.
 *
 * Хук сам НИЧЕГО не запрашивает (`enabled: false`) — только подписан на чужие
 * кэши; у мастера они пусты, и он молча берёт профиль. Легаси-payload без поля
 * → false, ровно как трактует его сервер.
 */
import { useQuery } from '@tanstack/react-query';

import { myCompanyApi, vinApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { Tenant, VinSettings } from '../../../shared/types';

/** Ключ кэша настроек VIN — единый для хука и карточки в настройках компании. */
export const VIN_SETTINGS_KEY = ['vin-settings'] as const;

/** Чистое правило приоритета источников — вынесено ради теста. */
export function resolveVinEnabled(input: {
  settings?: Pick<VinSettings, 'enabled'> | null;
  company?: Pick<Tenant, 'vinEnabled'> | null;
  tenant?: Pick<Tenant, 'vinEnabled'> | null;
}): boolean {
  if (input.settings) return input.settings.enabled === true;
  if (input.company && typeof input.company.vinEnabled === 'boolean') return input.company.vinEnabled;
  return input.tenant?.vinEnabled === true;
}

export function useVinEnabled(): boolean {
  const { user } = useAuth();
  const { data: settings } = useQuery<VinSettings>({
    queryKey: VIN_SETTINGS_KEY,
    // queryFn обязателен по контракту react-query, но при enabled: false не
    // вызывается — хук только читает кэш, который пишут настройки компании.
    queryFn: async () => (await vinApi.getSettings()).data,
    enabled: false,
  });
  const { data: company } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
    enabled: false,
  });
  return resolveVinEnabled({ settings, company, tenant: user?.tenant });
}
