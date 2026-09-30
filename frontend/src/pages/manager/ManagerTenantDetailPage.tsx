import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  CreditCard,
  Info,
  KeyRound,
  LogIn,
  MapPin,
  PauseCircle,
  Phone,
  PlayCircle,
  StickyNote,
} from 'lucide-react';

import { managerApi } from '../../api/services';
import { formatMoney } from '../../../../shared/utils/formatters';
import { formatPhone } from '../../../../shared/validation/phone';
import PageHeader from '../../components/PageHeader';
import QueryState from '../../components/QueryState';
import EmptyState from '../../components/EmptyState';
import SubscriptionPeriodBadge from '../../components/SubscriptionPeriodBadge';
import { Button } from '../../ui/Button';
import { Card, CardHeader } from '../../ui/Card';
import { DropdownMenu, type MenuEntry } from '../../ui/DropdownMenu';
import { Skeleton } from '../../ui/Skeleton';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { InfoRow, TenantStatusBadges, formatDateRu, isTenantExpired } from '../../components/admin/adminUi';
import AssignPlanModal from '../../components/admin/AssignPlanModal';
import ExtendModal from '../../components/admin/ExtendModal';
import ResetOwnerPasswordModal from '../../components/admin/ResetOwnerPasswordModal';
import TenantSubscriptionCard from '../../components/admin/TenantSubscriptionCard';
import { ImpersonateDialog, SuspendModal, UnsuspendDialog } from '../../components/admin/TenantLifecycleDialogs';
import { apiErrorStatus } from '../../components/admin/apiError';
import { managerKeys } from '../../components/admin/managerQueryKeys';
import { useManagerSummary } from '../../components/admin/useManagerSummary';
import { useTenantSubscriptionActions } from '../../components/admin/useTenantSubscriptionActions';

/*
 * Карточка автосервиса менеджера: подписка, продление, тариф, приостановка, вход как владелец и сброс
 * пароля владельца. Удаления, реквизитов, сотрудников и точек здесь нет — это зона владельца платформы.
 */

const BACK_TO = '/manager/tenants';

// Чужой или несуществующий автосервис сервер отдаёт как 403/404 — повтор запроса его не «починит».
const isUnavailable = (err: unknown) => {
  const status = apiErrorStatus(err);
  return status === 403 || status === 404;
};

export default function ManagerTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tenantId = id ?? '';
  const navigate = useNavigate();

  // Окно «Продлить» живёт в URL: кнопка «Продлить» на обзоре ведёт сразу в него, F5 и «Назад» его сохраняют.
  const [params, setParams] = useSearchParams();
  const extendModalOpen = params.get('extend') === '1';
  const setExtendModalOpen = (open: boolean) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (open) next.set('extend', '1');
        else next.delete('extend');
        return next;
      },
      { replace: true },
    );

  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [unsuspendConfirm, setUnsuspendConfirm] = useState(false);
  const [impersonateConfirm, setImpersonateConfirm] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);

  const {
    data: tenant,
    error,
    isLoading,
    isPlaceholderData,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: managerKeys.tenant(tenantId),
    queryFn: () => managerApi.tenant(tenantId),
    select: (res) => res.data,
    enabled: !!tenantId,
    retry: (failureCount, err) => !isUnavailable(err) && failureCount < 1,
  });

  const {
    data: cabinet,
    isPlaceholderData: cabinetPlaceholder,
    isError: cabinetError,
    isFetching: cabinetFetching,
    refetch: refetchCabinet,
  } = useQuery({
    queryKey: managerKeys.cabinet(tenantId),
    queryFn: () => managerApi.cabinet(tenantId),
    select: (res) => res.data,
    enabled: !!tenantId,
    staleTime: 60_000,
  });

  // Лимит бесплатного продления и моя доля владельцу — для формы «Продлить».
  const { data: summary } = useManagerSummary();

  const { extend, assignPlan, suspend, unsuspend, impersonate, resetOwnerPassword } = useTenantSubscriptionActions(
    tenantId,
    'manager',
  );

  // Переход между двумя карточками не должен показывать данные прежнего автосервиса под чужим адресом:
  // глобальный placeholderData тянет предыдущий ответ, а рядом стоят денежные действия.
  if (isLoading || isPlaceholderData) {
    return (
      <div className="space-y-5">
        <PageHeader title="Автосервис" icon={Building2} backTo={BACK_TO} />
        <div className="space-y-5" aria-busy="true">
          <Card padding="md">
            <Skeleton className="h-6 w-1/3" />
            <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <Skeleton variant="text" className="w-20" />
                  <Skeleton className="mt-2 h-5 w-24" />
                </div>
              ))}
            </div>
          </Card>
          <Card padding="md">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-4 h-32 w-full" />
          </Card>
        </div>
      </div>
    );
  }

  // Сбой сети — ошибка с «Повторить»; «не найден» только для 403/404 и пустого ответа.
  if (isError && !tenant && !isUnavailable(error)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Автосервис" icon={Building2} backTo={BACK_TO} />
        <Card padding="md">
          <QueryState
            isLoading={false}
            isError
            onRetry={refetch}
            isFetching={isFetching}
            errorTitle="Не удалось загрузить автосервис"
          >
            {null}
          </QueryState>
        </Card>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-5">
        <PageHeader title="Автосервис" icon={Building2} backTo={BACK_TO} />
        <Card padding="md">
          <EmptyState
            icon={Building2}
            title="Автосервис не найден или недоступен"
            description="Он мог быть закреплён за другим менеджером или удалён."
            action={{ label: 'К моим автосервисам', onClick: () => navigate(BACK_TO) }}
          />
        </Card>
      </div>
    );
  }

  const subCabinet = cabinetPlaceholder ? undefined : cabinet;
  const subStatus = subCabinet?.subscription;
  // Приостановка форсит isActive=false: до ответа кабинета опираемся на отметку самого автосервиса.
  const isSuspended = subStatus ? subStatus.status === 'suspended' : !!tenant.suspendedAt;

  const moreItems: MenuEntry[] = [
    { key: 'impersonate', label: 'Войти как владелец', icon: LogIn, onSelect: () => setImpersonateConfirm(true) },
    {
      key: 'reset-password',
      label: 'Сбросить пароль владельца',
      icon: KeyRound,
      onSelect: () => setResetPasswordOpen(true),
    },
    { type: 'separator', key: 'sep' },
    isSuspended
      ? { key: 'unsuspend', label: 'Возобновить работу', icon: PlayCircle, onSelect: () => setUnsuspendConfirm(true) }
      : {
          key: 'suspend',
          label: 'Приостановить',
          icon: PauseCircle,
          danger: true,
          onSelect: () => setSuspendModalOpen(true),
        },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={tenant.name}
        icon={Building2}
        backTo={BACK_TO}
        subtitle={
          tenant.plan?.name
            ? `Тариф «${tenant.plan.name}» · ${formatMoney(tenant.monthlyPrice)}/мес`
            : 'Тариф не назначен'
        }
        meta={
          <>
            <TenantStatusBadges tenant={tenant} size="sm" />
            <SubscriptionPeriodBadge
              kind={subStatus?.currentPeriodKind ?? tenant.currentPeriodKind}
              until={subStatus?.subscriptionEnd ?? tenant.subscriptionEnd}
              size="sm"
            />
          </>
        }
        actions={
          <>
            <Button icon={CalendarPlus} onClick={() => setExtendModalOpen(true)}>
              Продлить
            </Button>
            <Button variant="secondary" icon={CreditCard} onClick={() => setPlanModalOpen(true)}>
              Тариф
            </Button>
            <DropdownMenu
              aria-label="Ещё действия"
              items={moreItems}
              trigger={
                <Button variant="secondary" iconRight={ChevronDown}>
                  Ещё
                </Button>
              }
            />
          </>
        }
      />

      {isSuspended && (
        <div
          className="flex items-start gap-3 rounded-xl border border-bad/20 bg-bad-soft px-4 py-3 text-sm text-bad-text"
          role="status"
        >
          <PauseCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-bad" aria-hidden="true" />
          <div>
            <p className="font-medium">
              Работа приостановлена
              {subStatus?.suspendedAt ? ` ${formatDateRu(subStatus.suspendedAt, 'd MMMM yyyy')}` : ''}
            </p>
            {subStatus?.suspendedReason && <p className="mt-0.5">Причина: {subStatus.suspendedReason}</p>}
            <p className="mt-0.5 text-bad-text/80">Сотрудники не могут войти в приложение до возобновления.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
        <TenantSubscriptionCard
          cabinet={subCabinet}
          isError={cabinetError}
          isFetching={cabinetFetching}
          onRetry={() => refetchCabinet()}
          className="xl:col-span-2"
        />

        <Card padding="none">
          <CardHeader icon={Info} iconTone="neutral" title="Информация" />
          <div className="space-y-3 px-5 py-4">
            <InfoRow icon={Phone} label="Телефон">
              {tenant.phone ? (
                <a
                  href={`tel:${tenant.phone}`}
                  className={cn('rounded tabular-nums hover:text-accent-text', focusRing)}
                >
                  {formatPhone(tenant.phone)}
                </a>
              ) : (
                '—'
              )}
            </InfoRow>
            <InfoRow icon={MapPin} label="Адрес">
              {tenant.address || '—'}
            </InfoRow>
            <InfoRow icon={CalendarDays} label="Подписка до">
              <span className="text-ink-3">Подписка до: </span>
              {tenant.subscriptionEnd ? (
                <span
                  className={cn('tabular-nums', isTenantExpired(tenant) ? 'font-medium text-bad-text' : 'text-ink-2')}
                >
                  {formatDateRu(tenant.subscriptionEnd, 'd MMM yyyy')}
                </span>
              ) : (
                <span className="text-ink-3">не указано</span>
              )}
            </InfoRow>
            {tenant.subscriptionNote && (
              <InfoRow icon={StickyNote} label="Примечание">
                {tenant.subscriptionNote}
              </InfoRow>
            )}
          </div>
        </Card>
      </div>

      {/* Продление: платное несёт долю владельца, бесплатное ограничено лимитом менеджера */}
      <ExtendModal
        isOpen={extendModalOpen}
        onClose={() => setExtendModalOpen(false)}
        mode="manager"
        subscriptionEnd={subStatus?.subscriptionEnd ?? tenant.subscriptionEnd}
        planPrice={subStatus?.planPrice ?? tenant.monthlyPrice}
        currentPeriodKind={subStatus?.currentPeriodKind ?? tenant.currentPeriodKind}
        maxFreeDays={summary?.maxFreeDays}
        ownerSharePercent={summary?.ownerSharePercent}
        isPending={extend.isPending}
        onSubmit={(request) => extend.mutate(request, { onSuccess: () => setExtendModalOpen(false) })}
      />

      <AssignPlanModal
        isOpen={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        mode="manager"
        currentPlanId={subStatus?.planId ?? tenant.planId ?? null}
        isPending={assignPlan.isPending}
        onSubmit={(planId) => assignPlan.mutate(planId, { onSuccess: () => setPlanModalOpen(false) })}
      />

      <SuspendModal
        isOpen={suspendModalOpen}
        onClose={() => setSuspendModalOpen(false)}
        tenantName={tenant.name}
        isPending={suspend.isPending}
        onSubmit={(reason) => suspend.mutate(reason, { onSuccess: () => setSuspendModalOpen(false) })}
      />

      <UnsuspendDialog
        isOpen={unsuspendConfirm}
        onClose={() => setUnsuspendConfirm(false)}
        tenantName={tenant.name}
        onConfirm={() => unsuspend.mutate()}
      />

      <ImpersonateDialog
        isOpen={impersonateConfirm}
        onClose={() => setImpersonateConfirm(false)}
        mode="manager"
        tenantName={tenant.name}
        onConfirm={() => impersonate.mutate()}
      />

      <ResetOwnerPasswordModal
        isOpen={resetPasswordOpen}
        onClose={() => setResetPasswordOpen(false)}
        tenantName={tenant.name}
        isPending={resetOwnerPassword.isPending}
        onSubmit={(password) => resetOwnerPassword.mutate(password, { onSuccess: () => setResetPasswordOpen(false) })}
      />
    </div>
  );
}
