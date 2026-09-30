import { useQuery } from '@tanstack/react-query';

import { adminManagersApi } from '../../api/services';
import type { PlatformManager } from '../../types';
import { adminManagerKeys } from './managerQueryKeys';

/** Список менеджеров с балансом и цифрами за месяц — один запрос на таблицу, фильтры и выпадающие списки. */
export function useAdminManagers(enabled = true) {
  return useQuery({
    queryKey: adminManagerKeys.list,
    queryFn: () => adminManagersApi.list(),
    select: (res) => res.data as PlatformManager[],
    enabled,
  });
}
