import { useQuery } from '@tanstack/react-query';

import { myCompanyApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import type { Tenant } from '../../../shared/types';

/**
 * Включена ли у автосервиса опция «VIN-код автомобиля» (171, 2026-09-25).
 *
 * Пока она выключена, в интерфейсе НЕТ ни одного упоминания VIN: ни поля в
 * формах авто, ни колонки, ни режима поиска. Признак приезжает в
 * `user.tenant.vinEnabled` с /auth/login и /auth/me — доступен ЛЮБОЙ роли
 * (мастеру в Кассе он тоже нужен), а не через GET /my-company, который закрыт
 * ключом company_manage.
 *
 * Кэш ['my-company'] важнее профиля, если он прогрет: владелец, только что
 * включивший опцию в «Настройках компании», видит поле VIN сразу, не дожидаясь
 * обновления сессии. `enabled: false` — хук ничего не запрашивает, только
 * подписывается на чужой кэш (та же схема, что у useTenantTimezone).
 *
 * Зеркало mobile/src/hooks/useVinEnabled.ts — держать в синхроне.
 */
export function useVinEnabled(): boolean {
  const { user } = useAuth();
  const { data: company } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
    enabled: false,
  });
  if (company && typeof company.vinEnabled === 'boolean') return company.vinEnabled;
  return user?.tenant?.vinEnabled === true;
}
