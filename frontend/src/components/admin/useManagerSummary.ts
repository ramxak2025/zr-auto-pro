import { useQuery } from '@tanstack/react-query';

import { managerApi } from '../../api/services';
import { managerKeys } from './managerQueryKeys';

/** Сводка менеджера: одна на весь кабинет — обзор, расчёты, лимит пробного и моя доля для форм и модалок. */
export function useManagerSummary() {
  return useQuery({
    queryKey: managerKeys.summary,
    queryFn: () => managerApi.summary(),
    select: (res) => res.data,
  });
}
