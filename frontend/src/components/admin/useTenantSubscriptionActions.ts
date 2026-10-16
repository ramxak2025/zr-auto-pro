import { useMemo, useRef } from 'react';
import { createManagerCabinetApi, createTenantsApi } from '../../../../shared/api/createServices';
import { createSessionBoundClient } from '../../api/axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { managerApi, tenantsApi } from '../../api/services';
import type { ExtendSubscriptionRequest } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { readStoredToken, sessionTakeoverError, writeSessionToken } from '../../utils/sessionToken';
import { apiErrorMessage } from './apiError';
import { adminManagerKeys, managerKeys } from './managerQueryKeys';

/**
 * Действия над подпиской автосервиса, общие для карточки суперадмина и менеджера.
 * Режим выбирает API (`/tenants/:id/*` или `/manager/tenants/:id/*`) и набор инвалидируемых ключей;
 * закрытие модалок остаётся за страницей — через `mutate(vars, { onSuccess })`.
 */
export function useTenantSubscriptionActions(tenantId: string | undefined, mode: 'superadmin' | 'manager') {
  const queryClient = useQueryClient();
  const { refreshUser, token } = useAuth();
  const renewalApi = useMemo(
    () =>
      mode === 'manager'
        ? createManagerCabinetApi(createSessionBoundClient(token))
        : createTenantsApi(createSessionBoundClient(token)),
    [mode, token],
  );
  const owner = `${token}:${mode}:${tenantId}`;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const ownsRenewal = () => ownerRef.current === owner && readStoredToken() === token;
  const isManager = mode === 'manager';
  // Страницы вызывают действия только после загрузки карточки, пустой id — лишь страховка от `undefined`.
  const id = tenantId ?? '';

  const invalidate = () => {
    if (isManager) {
      queryClient.invalidateQueries({ queryKey: managerKeys.tenant(id) });
      queryClient.invalidateQueries({ queryKey: managerKeys.cabinet(id) });
      queryClient.invalidateQueries({ queryKey: managerKeys.tenantsAll });
      queryClient.invalidateQueries({ queryKey: managerKeys.summary });
      queryClient.invalidateQueries({ queryKey: managerKeys.ledgerAll });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
    queryClient.invalidateQueries({ queryKey: ['tenant-cabinet', tenantId] });
    queryClient.invalidateQueries({ queryKey: ['tenants'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    // Платное продление с галочкой «получил менеджер» меняет его баланс и ленту расчётов.
    queryClient.invalidateQueries({ queryKey: adminManagerKeys.list });
    queryClient.invalidateQueries({ queryKey: adminManagerKeys.detailAll });
    queryClient.invalidateQueries({ queryKey: adminManagerKeys.ledgerAll });
  };

  const extend = useMutation({
    mutationFn: async (request: ExtendSubscriptionRequest) => {
      const response = await renewalApi.extend(id, request);
      if (!ownsRenewal()) throw sessionTakeoverError();
      return response;
    },
    onSuccess: (_res, request) => {
      if (!ownsRenewal()) return;
      invalidate();
      toast.success(request.type === 'paid' ? 'Подписка продлена (оплачено)' : 'Подписка продлена (бесплатно)');
    },
    onError: (err) => {
      if (ownsRenewal()) toast.error(apiErrorMessage(err, 'Не удалось продлить подписку'));
    },
  });

  const assignPlan = useMutation({
    mutationFn: (planId: string) =>
      isManager ? managerApi.assignPlan(id, { planId }) : tenantsApi.assignPlan(id, planId),
    onSuccess: () => {
      invalidate();
      toast.success('Тариф назначен');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Не удалось назначить тариф')),
  });

  // Приостановка форсит is_active=false на сервере; срок подписки не трогается — возобновление возвращает доступ.
  const suspend = useMutation({
    mutationFn: (reason: string | undefined) =>
      isManager ? managerApi.suspend(id, reason ? { reason } : undefined) : tenantsApi.suspend(id, reason),
    onSuccess: () => {
      invalidate();
      toast.success('Автосервис приостановлен');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Не удалось приостановить')),
  });

  const unsuspend = useMutation({
    mutationFn: () => (isManager ? managerApi.unsuspend(id) : tenantsApi.unsuspend(id)),
    onSuccess: () => {
      invalidate();
      toast.success('Работа автосервиса возобновлена');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Не удалось возобновить')),
  });

  const impersonate = useMutation({
    mutationFn: () => (isManager ? managerApi.impersonate(id) : tenantsApi.impersonate(id)),
    onSuccess: async (res) => {
      const { token } = res.data;
      // Подмена сессии на владельца: чистим кэш кабинета (платформенные данные не должны просочиться
      // в сессию владельца), пишем короткоживущий токен директора и перезагружаемся в приложение автосервиса.
      await queryClient.cancelQueries().catch(() => {});
      queryClient.clear();
      // Через writeSessionToken, а не напрямую в localStorage: вкладка обязана запомнить, каким токеном
      // она теперь живёт (167), иначе заслон «сессия обновлена в другой вкладке» заблокирует её же вход.
      writeSessionToken(token);
      await refreshUser();
      toast.success('Вход выполнен от имени владельца');
      window.location.href = '/dashboard';
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Не удалось войти как владелец')),
  });

  // Только кабинет менеджера: пароль владельца сам менеджер задаёт и передаёт.
  const resetOwnerPassword = useMutation({
    mutationFn: (password: string) => managerApi.resetOwnerPassword(id, { password }),
    onSuccess: () => toast.success('Пароль владельца изменён'),
    onError: (err) => toast.error(apiErrorMessage(err, 'Не удалось сбросить пароль')),
  });

  return { invalidate, extend, assignPlan, suspend, unsuspend, impersonate, resetOwnerPassword };
}
