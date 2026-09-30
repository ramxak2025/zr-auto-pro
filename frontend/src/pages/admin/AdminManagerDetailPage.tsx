import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  ChevronDown,
  Pencil,
  ScrollText,
  User as UserIcon,
  UserCog,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { adminApi, adminManagersApi } from '../../api/services';
import type { AuditLogEntry, ManagerSettlement, PlatformManager, Tenant } from '../../types';
import { formatPhone } from '../../../../shared/validation/phone';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';
import QueryState from '../../components/QueryState';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { DataTable, type DataTableColumn } from '../../ui/DataTable';
import { Skeleton } from '../../ui/Skeleton';
import { TabPanel, Tabs, type TabItem } from '../../ui/Tabs';
import { formatDateRu } from '../../components/admin/adminUi';
import { apiErrorMessage, apiErrorStatus } from '../../components/admin/apiError';
import { auditActionLabel, auditActionTone } from '../../components/admin/auditActions';
import EditManagerModal from '../../components/admin/EditManagerModal';
import ManagerBalanceTiles from '../../components/admin/ManagerBalanceTiles';
import ManagerLedgerFeed, { LEDGER_DEFAULT_MONTHS } from '../../components/admin/ManagerLedgerFeed';
import { balanceTone, formatRubExact } from '../../components/admin/MoneyExact';
import { adminManagerKeys } from '../../components/admin/managerQueryKeys';
import { formatPercent } from '../../components/admin/numberInput';
import SettlementModal from '../../components/admin/SettlementModal';
import TenantsTable from '../../components/admin/TenantsTable';
import TransferManagerModal from '../../components/admin/TransferManagerModal';
import { useTransferTenantManager } from '../../components/admin/useTransferTenantManager';

/*
 * Карточка менеджера (суперадмин): баланс перед владельцем, клиенты с передачей другому менеджеру,
 * расчёты (платежи с долей владельца + внесённые деньги) и журнал его действий.
 */

type TabKey = 'clients' | 'ledger' | 'journal';

const TAB_KEYS: TabKey[] = ['clients', 'ledger', 'journal'];
const TAB_ID_PREFIX = 'manager-tabs';

const isTabKey = (value: string | null): value is TabKey => TAB_KEYS.includes(value as TabKey);

/** Короткая подпись баланса для шапки: полная расшифровка — в первой плитке. */
function headerBalanceLabel(balance: number): string {
  if (balance > 0) return `Долг ${formatRubExact(balance)}`;
  if (balance < 0) return `Владелец должен ${formatRubExact(-balance)}`;
  return 'Расчёты закрыты';
}

export default function AdminManagerDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'clients';
  // Вкладка живёт в URL (переживает F5); «Клиенты» — по умолчанию, поэтому без параметра.
  const setTab = (next: TabKey) => setParams(next === 'clients' ? {} : { tab: next }, { replace: true });

  const [settlementOpen, setSettlementOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [transferTenant, setTransferTenant] = useState<Tenant | null>(null);
  const transferMutation = useTransferTenantManager();

  const {
    data: manager,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: adminManagerKeys.detail(id),
    queryFn: () => adminManagersApi.get(id),
    select: (res) => res.data,
    enabled: !!id,
    // 404 — ожидаемый исход для чужой/удалённой ссылки: повторять запрос незачем.
    retry: (failureCount, err) => apiErrorStatus(err) !== 404 && failureCount < 1,
  });

  // Loading → скелет; сбой сети → ошибка с «Повторить»; 404 — «не найден».
  if (isLoading || isError || !manager) {
    const notFound = (isError && apiErrorStatus(error) === 404) || (!isLoading && !isError);
    return (
      <div className="space-y-5">
        <PageHeader title="Менеджер" icon={UserCog} backTo="/admin/managers" />
        {isLoading ? (
          <div className="space-y-5" aria-busy="true">
            <Card padding="md">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="mt-4 h-16 w-full" />
            </Card>
            <Card padding="md">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-4 h-32 w-full" />
            </Card>
          </div>
        ) : notFound ? (
          <Card padding="md">
            <EmptyState
              icon={UserCog}
              title="Менеджер не найден"
              description="Возможно, ссылка устарела."
              action={{ label: 'К списку менеджеров', onClick: () => navigate('/admin/managers') }}
            />
          </Card>
        ) : (
          <Card padding="md">
            <QueryState
              isLoading={false}
              isError
              onRetry={() => refetch()}
              isFetching={isFetching}
              errorTitle="Не удалось загрузить менеджера"
            >
              {null}
            </QueryState>
          </Card>
        )}
      </div>
    );
  }

  const tabItems: TabItem<TabKey>[] = [
    { key: 'clients', label: 'Клиенты', count: manager.tenants.length },
    { key: 'ledger', label: 'Расчёты' },
    { key: 'journal', label: 'Журнал' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={manager.fullName}
        icon={UserCog}
        backTo="/admin/managers"
        subtitle={`${formatPhone(manager.phone)} · доля владельца ${formatPercent(manager.ownerSharePercent)} %`}
        meta={
          <>
            {!manager.isActive && (
              <Badge size="sm" tone="neutral">
                Отключён
              </Badge>
            )}
            <Badge size="sm" tone={balanceTone(manager.balance)}>
              {headerBalanceLabel(manager.balance)}
            </Badge>
          </>
        }
        actions={
          <>
            <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>
              Редактировать
            </Button>
            <Button icon={Banknote} onClick={() => setSettlementOpen(true)}>
              Внести расчёт
            </Button>
          </>
        }
      />

      {manager.note && <p className="text-sm text-ink-2 [overflow-wrap:anywhere]">Заметка: {manager.note}</p>}

      <ManagerBalanceTiles summary={manager.summary} viewer="owner" />

      <Tabs
        aria-label="Разделы карточки менеджера"
        idPrefix={TAB_ID_PREFIX}
        items={tabItems}
        value={tab}
        onChange={setTab}
      />

      <TabPanel idPrefix={TAB_ID_PREFIX} tabKey="clients" active={tab === 'clients'}>
        <TenantsTable
          rows={manager.tenants}
          rowHref={(t) => `/admin/tenants/${t.id}`}
          caption="Автосервисы менеджера"
          isLoading={false}
          isError={false}
          onRetry={() => refetch()}
          errorTitle="Не удалось загрузить автосервисы"
          emptyState={{
            icon: Building2,
            title: 'У менеджера пока нет автосервисов',
            description:
              'Они появятся здесь, когда менеджер заведёт клиента или вы передадите его из карточки автосервиса.',
          }}
          actionColumn={{
            key: 'transfer',
            header: '',
            align: 'right',
            interactive: true,
            render: (t) => (
              <Button
                variant="ghost"
                size="sm"
                icon={ArrowLeftRight}
                aria-label={`Передать автосервис «${t.name}» другому менеджеру`}
                onClick={() => setTransferTenant(t)}
              >
                Передать другому
              </Button>
            ),
          }}
        />
      </TabPanel>

      <TabPanel idPrefix={TAB_ID_PREFIX} tabKey="ledger" active={tab === 'ledger'}>
        <ManagerLedgerTab managerId={manager.id} />
      </TabPanel>

      <TabPanel idPrefix={TAB_ID_PREFIX} tabKey="journal" active={tab === 'journal'}>
        <ManagerJournalTab manager={manager} />
      </TabPanel>

      <SettlementModal
        isOpen={settlementOpen}
        onClose={() => setSettlementOpen(false)}
        managerId={manager.id}
        managerName={manager.fullName}
        balance={manager.balance}
      />
      <EditManagerModal isOpen={editOpen} onClose={() => setEditOpen(false)} manager={manager} />
      <TransferManagerModal
        isOpen={!!transferTenant}
        onClose={() => setTransferTenant(null)}
        tenantName={transferTenant?.name ?? ''}
        currentManagerId={manager.id}
        isPending={transferMutation.isPending}
        onSubmit={(managerId) => {
          if (!transferTenant) return;
          transferMutation.mutate(
            { tenantId: transferTenant.id, managerId },
            { onSuccess: () => setTransferTenant(null) },
          );
        }}
      />
    </div>
  );
}

// ----------- Вкладка «Расчёты» -----------

function ManagerLedgerTab({ managerId }: { managerId: string }) {
  const queryClient = useQueryClient();
  const [months, setMonths] = useState<number>(LEDGER_DEFAULT_MONTHS);
  const [toRemove, setToRemove] = useState<ManagerSettlement | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: adminManagerKeys.ledger(managerId, months),
    queryFn: () => adminManagersApi.ledger(managerId, { months }),
    select: (res) => res.data,
  });

  const removeMutation = useMutation({
    mutationFn: (settlementId: string) => adminManagersApi.removeSettlement(managerId, settlementId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.detail(managerId) });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.ledgerAll });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.audit(managerId) });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.list });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-log'] });
      toast.success('Расчёт удалён');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Не удалось удалить расчёт')),
  });

  return (
    <>
      <ManagerLedgerFeed
        ledger={data}
        isLoading={isLoading}
        isError={isError}
        isFetching={isFetching}
        onRetry={() => refetch()}
        months={months}
        onMonthsChange={setMonths}
        caption="Платежи и расчёты менеджера"
        onRemoveSettlement={setToRemove}
      />
      <ConfirmDialog
        isOpen={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={() => toRemove && removeMutation.mutate(toRemove.id)}
        title="Удалить расчёт?"
        message={
          toRemove
            ? `Расчёт ${formatRubExact(toRemove.amount)} от ${formatDateRu(toRemove.settledOn, 'd MMMM yyyy')} будет удалён, баланс менеджера пересчитается.`
            : ''
        }
        confirmText="Удалить"
        variant="danger"
        loading={removeMutation.isPending}
      />
    </>
  );
}

// ----------- Вкладка «Журнал» -----------

const JOURNAL_PAGE_SIZE = 50;
/** Сколько записей менеджера хотим увидеть сразу: журнал общий, его записи разбросаны по страницам. */
const JOURNAL_TARGET_ROWS = 20;
/** Сколько страниц подгружаем сами, пока не наберём записей; дальше — только по «Показать ещё». */
const JOURNAL_AUTO_PAGES = 6;

/** Запись касается менеджера: он объект действия, исполнитель или упомянут в деталях (например, при передаче клиента). */
function mentionsManager(entry: AuditLogEntry, manager: Pick<PlatformManager, 'id' | 'fullName'>): boolean {
  if (entry.targetId === manager.id || entry.actorName === manager.fullName) return true;
  return Object.values(entry.detail ?? {}).some((v) => v === manager.id || v === manager.fullName);
}

function ManagerJournalTab({ manager }: { manager: Pick<PlatformManager, 'id' | 'fullName'> }) {
  // У журнала платформы нет фильтра по исполнителю: листаем общий журнал и отбираем записи менеджера на клиенте.
  const { data, isLoading, isError, isFetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: adminManagerKeys.audit(manager.id),
      queryFn: async ({ pageParam }) => {
        const res = await adminApi.listAuditLog({ limit: JOURNAL_PAGE_SIZE, offset: pageParam });
        return res.data;
      },
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) =>
        lastPage.length === JOURNAL_PAGE_SIZE ? allPages.length * JOURNAL_PAGE_SIZE : undefined,
      // Действия менеджера пишутся из других экранов — при каждом открытии вкладки берём свежие данные.
      staleTime: 0,
    });

  const pagesLoaded = data?.pages.length ?? 0;
  const rows = useMemo(
    () => (data?.pages ?? []).flat().filter((entry) => mentionsManager(entry, manager)),
    [data, manager],
  );

  useEffect(() => {
    if (isError || isFetching || !hasNextPage) return;
    if (rows.length >= JOURNAL_TARGET_ROWS || pagesLoaded >= JOURNAL_AUTO_PAGES) return;
    fetchNextPage();
  }, [isError, isFetching, hasNextPage, rows.length, pagesLoaded, fetchNextPage]);

  const columns: DataTableColumn<AuditLogEntry>[] = [
    {
      key: 'action',
      header: 'Действие',
      render: (e) => <Badge tone={auditActionTone(e.action)}>{auditActionLabel(e.action)}</Badge>,
    },
    {
      key: 'actor',
      header: 'Кто',
      hideBelow: 'sm',
      render: (e) => (
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <UserIcon className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" />
          {e.actorName || 'Система'}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Объект',
      hideBelow: 'md',
      render: (e) =>
        e.targetName || e.targetType ? (
          <span className="text-ink-2">
            {e.targetName || e.targetId}
            {e.targetType && <span className="ml-1.5 text-xs text-ink-3">({e.targetType})</span>}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: 'when',
      header: 'Когда',
      width: 170,
      render: (e) => <span className="whitespace-nowrap tabular-nums text-ink-2">{formatDateRu(e.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        caption="Журнал действий менеджера"
        rows={rows}
        rowKey={(e) => e.id}
        columns={columns}
        // Пока догружаем страницы и своих записей ещё нет — скелет, а не «Журнал пуст».
        isLoading={isLoading || (rows.length === 0 && isFetchingNextPage)}
        isError={isError}
        onRetry={() => refetch()}
        isFetching={isFetching && !isFetchingNextPage}
        errorTitle="Не удалось загрузить журнал"
        emptyState={{
          icon: ScrollText,
          title: 'Действий менеджера пока нет',
          description: hasNextPage
            ? 'В загруженной части журнала записей менеджера нет — догрузите историю.'
            : 'Здесь появятся его действия: заведённые автосервисы, продления, внесённые расчёты.',
        }}
      />

      {/* Догружаем историю страницами по 50 */}
      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="secondary" icon={ChevronDown} onClick={() => fetchNextPage()} loading={isFetchingNextPage}>
            Показать ещё
          </Button>
        </div>
      )}
    </div>
  );
}
