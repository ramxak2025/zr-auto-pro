import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { adminManagersApi } from '../../api/services';
import { apiErrorMessage } from './apiError';
import { adminManagerKeys } from './managerQueryKeys';

/** Передача автосервиса другому менеджеру / снятие с менеджера (суперадмин). Долг по прошлым платежам остаётся за прежним. */
export function useTransferTenantManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, managerId }: { tenantId: string; managerId: string | null }) =>
      adminManagersApi.transferTenant(tenantId, { managerId }),
    onSuccess: (res, { tenantId }) => {
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.list });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.detailAll });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-log'] });
      const name = res.data.managerName;
      toast.success(res.data.managerId && name ? `Клиент передан менеджеру ${name}` : 'Клиент снят с менеджера');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Не удалось передать клиента')),
  });
}
