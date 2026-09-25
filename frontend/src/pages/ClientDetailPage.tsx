import { useState, FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Pencil,
  Plus,
  Minus,
  Trash2,
  User,
  Phone,
  MessageSquare,
  Car,
  Calendar,
  FileText,
  ChevronDown,
  UserCheck,
  Coins,
  Gift,
  Wallet,
  Star,
  Tag,
  ShoppingBag,
  ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { clientsApi, carsApi, checksApi, installmentsApi, loyaltyApi, walletApi } from '../api/services';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DuplicateWarningDialog from '../components/DuplicateWarningDialog';
import EmptyState from '../components/EmptyState';
import QueryState from '../components/QueryState';
import PageHeader from '../components/PageHeader';
import PhoneInput from '../components/PhoneInput';
import ClientSearchAutocomplete from '../components/ClientSearchAutocomplete';
import CarFormModal, { EMPTY_CAR_FORM, type CarFormValues } from '../components/clients/CarFormModal';
import { VinLine, carVin, vinDuplicateError, type VinDuplicateInfo } from '../components/vin';
import { ErrorRow, MiniStat } from '../components/dashboard/shared';
import { useAuth } from '../contexts/AuthContext';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import { useVinEnabled } from '../hooks/useVinEnabled';
import { Badge, StatusPill } from '../ui/Badge';
import { Button, buttonClasses } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { Field } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Money } from '../ui/Money';
import { Skeleton, SkeletonCard } from '../ui/Skeleton';
import { Textarea } from '../ui/Textarea';
import { cn } from '../ui/cn';
import { focusRing, toneChip } from '../ui/tokens';
import {
  Client,
  Car as CarType,
  Check,
  InstallmentClientLedger,
  InstallmentPlan,
  ClientBonusSummary,
  BonusType,
  WalletSettings,
} from '../types';
import type { CreateCarRequest, UpdateCarRequest } from '../../../shared/api/types';
import { formatPhone } from '../../../shared/validation/phone';
import { formatDateShort, formatDateTime, paymentMethodLabels } from '../../../shared/utils/formatters';
import { apiErrorMessage, apiErrorStatus } from '../../../shared/utils/apiError';

/** Способ оплаты — нейтральная метка; отложенный чек — отдельный статус. */
function PaymentBadge({ method }: { method: string }) {
  return (
    <Badge outline size="sm">
      {paymentMethodLabels[method] ?? method}
    </Badge>
  );
}

// ---- Чеки по одному автомобилю (раскрывающаяся панель) ----
function CarChecksPanel({ carId }: { carId: string }) {
  const timeZone = useTenantTimezone();
  const {
    data: checksData,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<{ data: Check[] }>({
    queryKey: ['checks', { carId }],
    queryFn: async () => {
      const res = await checksApi.getAll({ carId });
      return res.data;
    },
    enabled: !!carId,
  });

  const checks: Check[] = checksData?.data || [];

  const columns: DataTableColumn<Check>[] = [
    {
      key: 'number',
      header: '№',
      primary: true,
      width: 96,
      render: (c) => (
        <span className="inline-flex items-center gap-2 tabular-nums">
          #{c.number}
          {c.isDeferred && (
            <StatusPill tone="warn" size="sm">
              Отложен
            </StatusPill>
          )}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Дата',
      width: 120,
      render: (c) => (
        <span className="whitespace-nowrap tabular-nums text-ink-3">
          {formatDateShort(c.date || c.createdAt, timeZone)}
        </span>
      ),
    },
    { key: 'payment', header: 'Оплата', hideBelow: 'sm', render: (c) => <PaymentBadge method={c.paymentMethod} /> },
    {
      key: 'master',
      header: 'Мастер',
      hideBelow: 'md',
      render: (c) =>
        c.master ? <span className="truncate">{c.master.fullName}</span> : <span className="text-ink-4">—</span>,
    },
    {
      key: 'total',
      header: 'Сумма',
      numeric: true,
      width: 120,
      render: (c) => <Money value={c.totalRevenue} className="font-semibold text-ink" />,
      footer: (rows) => <Money value={rows.reduce((s, c) => s + (c.totalRevenue || 0), 0)} />,
    },
  ];

  return (
    <DataTable
      bare
      dense
      caption="Чеки по автомобилю"
      columns={columns}
      rows={checks}
      rowKey={(c) => c.id}
      rowHref={(c) => `/checks/${c.id}`}
      rowLabel={(c) => `Открыть чек №${c.number}`}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isFetching={isFetching}
      skeletonRows={3}
      errorTitle="Не удалось загрузить чеки по автомобилю"
      emptyState={{ title: 'Чеков по этому автомобилю пока нет' }}
    />
  );
}

// ---- Рассрочка клиента ----
function ClientDebtSection({ clientId, clientName }: { clientId: string; clientName: string }) {
  const timeZone = useTenantTimezone();
  const {
    data: ledger,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<InstallmentClientLedger>({
    queryKey: ['installments', 'client', clientId],
    queryFn: async () => {
      const res = await installmentsApi.clientLedger(clientId);
      return res.data;
    },
    enabled: !!clientId,
  });

  const plans = ledger?.plans ?? [];
  const totalRemaining = ledger?.totalRemaining ?? 0;
  const recentPayments = (ledger?.payments ?? []).slice(0, 4);
  const hasOverdue = plans.some((p) => p.overdue);

  const statusBadge = (plan: InstallmentPlan) => {
    if (plan.status === 'closed')
      return (
        <StatusPill tone="ok" size="sm">
          Закрыта
        </StatusPill>
      );
    if (plan.overdue)
      return (
        <StatusPill tone="bad" size="sm">
          Просрочена
        </StatusPill>
      );
    return (
      <StatusPill tone="accent" size="sm">
        Открыта
      </StatusPill>
    );
  };

  const fmtDate = (d?: string | null) => {
    if (!d) return '—';
    const parts = d.slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : d;
  };

  return (
    <Card padding="none">
      <CardHeader
        dense
        icon={Coins}
        iconTone={hasOverdue ? 'bad' : totalRemaining > 0 ? 'warn' : 'neutral'}
        title="Рассрочка"
        subtitle={
          isLoading ? 'Загрузка…' : isError ? undefined : totalRemaining > 0 ? undefined : 'Нет активной рассрочки'
        }
        actions={
          plans.length > 0 ? (
            <Link to="/installments" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              Управлять
            </Link>
          ) : undefined
        }
      />
      <CardBody padding="sm">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : isError ? (
          <ErrorRow message="Не удалось загрузить рассрочку" onRetry={() => refetch()} loading={isFetching} />
        ) : plans.length === 0 ? (
          <p className="px-1 py-2 text-sm text-ink-3">У клиента {clientName} нет заказ-нарядов в рассрочку</p>
        ) : (
          <>
            {totalRemaining > 0 && (
              <MiniStat
                label="Остаток к оплате"
                value={<Money value={totalRemaining} />}
                tone="bad"
                className="mb-3 px-1"
              />
            )}
            <ul className="divide-y divide-line">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <Link
                    to="/installments"
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-surface-2',
                      focusRing,
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">
                          {plan.checkNumber ? `Заказ-наряд #${plan.checkNumber}` : 'Рассрочка'}
                        </span>
                        {statusBadge(plan)}
                      </span>
                      <span className="mt-0.5 block text-xs tabular-nums text-ink-3">
                        <Money value={plan.paid} /> из <Money value={plan.total} />
                        {plan.status === 'open' && plan.nextPaymentDate
                          ? ` · след. ${fmtDate(plan.nextPaymentDate)}`
                          : ''}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-right">
                      <span className="block text-2xs text-ink-3">Остаток</span>
                      <Money value={plan.remaining} className="text-sm font-semibold text-ink" />
                    </span>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>

            {recentPayments.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-1 px-1 text-xs font-semibold text-ink-3">Последние платежи</p>
                <ul className="divide-y divide-line">
                  {recentPayments.map((pm) => (
                    <li key={pm.id} className="flex items-center justify-between gap-3 px-1 py-2">
                      <span className="text-xs tabular-nums text-ink-3">
                        {formatDateTime(pm.paidAt, timeZone)}
                        {pm.createdByName ? ` · ${pm.createdByName}` : ''}
                      </span>
                      <Money value={pm.amount} signed colorize className="text-sm font-semibold" />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ---- Бонусы клиента ----
function ClientLoyaltySection({ clientId, clientName }: { clientId: string; clientName: string }) {
  const queryClient = useQueryClient();
  const timeZone = useTenantTimezone();
  const { hasPermission } = useAuth();
  // Ручная корректировка бонусов — backend POST /loyalty/adjust требует
  // settings_manage (волна Битрикс24; байпас superadmin/director — внутри
  // hasPermission, admin — по матрице роли).
  const canManage = hasPermission('settings_manage');

  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<BonusType>('accrual');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [downloadingPass, setDownloadingPass] = useState(false);

  const {
    data: summary,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<ClientBonusSummary>({
    queryKey: ['loyalty', 'client', clientId],
    queryFn: async () => {
      const res = await loyaltyApi.clientSummary(clientId);
      return res.data;
    },
    enabled: !!clientId,
  });

  // Apple Wallet config is owner-class gated server-side — only query it for
  // owner-class roles, otherwise the request would 403. The «Скачать карту»
  // button shows only once Wallet is fully configured.
  const { data: walletSettings } = useQuery<WalletSettings>({
    queryKey: ['wallet', 'settings'],
    queryFn: async () => (await walletApi.getSettings()).data,
    enabled: canManage,
    staleTime: 5 * 60 * 1000,
  });
  const walletConfigured = !!walletSettings?.configured;

  const handleDownloadPass = async () => {
    if (!clientId) return;
    setDownloadingPass(true);
    try {
      const res = await walletApi.getPass(clientId);
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeName = (clientName || 'client').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'client';
      link.download = `${safeName}.pkpass`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // getPass is a blob request, so an error body arrives as a Blob too — we
      // only need the HTTP status to give a sensible message. 422 = Wallet not
      // configured / disabled; 404 = client not in this tenant.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 422) {
        toast.error('Apple Wallet не настроен — включите его в «Интеграциях»');
      } else if (status === 404) {
        toast.error('Клиент не найден');
      } else {
        toast.error('Не удалось скачать карту');
      }
    } finally {
      setDownloadingPass(false);
    }
  };

  // Push the fresh summary into the cache (instant UI) + invalidate to refetch.
  const applySummary = (next: ClientBonusSummary) => {
    queryClient.setQueryData(['loyalty', 'client', clientId], next);
    queryClient.invalidateQueries({ queryKey: ['loyalty', 'client', clientId] });
  };

  const adjustMutation = useMutation({
    mutationFn: (data: { amount: number; type: BonusType; reason: string }) =>
      loyaltyApi.adjust({ clientId, amount: data.amount, type: data.type, reason: data.reason }),
    onSuccess: (res) => {
      applySummary(res.data);
      toast.success(mode === 'accrual' ? 'Бонусы начислены' : 'Бонусы списаны');
      closeModal();
    },
    onError: (err) => toast.error(apiErrorMessage(err) ?? 'Не удалось выполнить операцию'),
  });

  const openModal = (next: BonusType) => {
    setMode(next);
    setAmount('');
    setReason('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setAmount('');
    setReason('');
  };

  const balance = summary?.balance ?? 0;
  const ledger = summary?.ledger ?? [];
  const enabled = summary?.enabled ?? false;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Введите сумму больше нуля');
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error('Укажите причину корректировки');
      return;
    }
    if (mode === 'redemption' && value > balance) {
      toast.error('Сумма больше доступного баланса');
      return;
    }
    adjustMutation.mutate({ amount: value, type: mode, reason: trimmedReason });
  };

  return (
    <Card padding="none">
      <CardHeader
        dense
        icon={Gift}
        iconTone="neutral"
        title="Бонусы клиента"
        subtitle={
          isLoading ? 'Загрузка…' : isError ? undefined : enabled ? undefined : 'Программа лояльности отключена'
        }
        actions={
          canManage && !isError ? (
            <>
              <Button variant="secondary" size="sm" icon={Plus} onClick={() => openModal('accrual')}>
                Начислить
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={Minus}
                onClick={() => openModal('redemption')}
                disabled={balance <= 0}
              >
                Списать
              </Button>
              {walletConfigured && (
                <IconButton
                  label="Скачать карту лояльности для Apple Wallet"
                  icon={Wallet}
                  size="sm"
                  onClick={handleDownloadPass}
                  loading={downloadingPass}
                />
              )}
            </>
          ) : undefined
        }
      />
      <CardBody padding="sm">
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-12" />
          </div>
        ) : isError ? (
          <ErrorRow message="Не удалось загрузить бонусы клиента" onRetry={() => refetch()} loading={isFetching} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 px-1">
              <MiniStat label="Баланс" value={<Money value={balance} />} tone={balance > 0 ? 'accent' : 'neutral'} />
              <MiniStat label="Начислено" value={<Money value={summary?.totalAccrued ?? 0} />} size="sm" />
              <MiniStat label="Списано" value={<Money value={summary?.totalRedeemed ?? 0} />} size="sm" />
            </div>

            {ledger.length === 0 ? (
              <p className="mt-3 border-t border-line px-1 pt-3 text-sm text-ink-3">Бонусных операций пока нет</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border-t border-line">
                {ledger.map((entry) => {
                  const isAccrual = entry.type === 'accrual';
                  return (
                    <li key={entry.id} className="flex items-center gap-3 px-1 py-2.5">
                      <span
                        className={cn(
                          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                          isAccrual ? toneChip.ok : toneChip.neutral,
                        )}
                        aria-hidden="true"
                      >
                        {isAccrual ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {isAccrual ? 'Начисление' : 'Списание'}
                          {entry.reason && <span className="font-normal text-ink-3"> · {entry.reason}</span>}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-ink-3">
                          <span>{formatDateTime(entry.createdAt, timeZone)}</span>
                          {entry.createdByName && <span>· {entry.createdByName}</span>}
                          {entry.checkId && (
                            <Link
                              to={`/checks/${entry.checkId}`}
                              className={cn('font-medium text-accent-text hover:underline', focusRing)}
                            >
                              · Чек{entry.checkNumber ? ` #${entry.checkNumber}` : ''}
                            </Link>
                          )}
                        </span>
                      </span>
                      <Money
                        value={isAccrual ? entry.amount : -entry.amount}
                        signed
                        colorize
                        className="text-sm font-semibold"
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </CardBody>

      {/* Accrue / Redeem modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={mode === 'accrual' ? 'Начислить бонусы' : 'Списать бонусы'}
        description={
          <>
            Клиент: {clientName}
            {mode === 'redemption' && (
              <>
                {' '}
                · Доступно: <Money value={balance} className="font-medium text-ink" />
              </>
            )}
          </>
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={adjustMutation.isPending}>
              Отмена
            </Button>
            <Button type="submit" form="bonus-form" loading={adjustMutation.isPending}>
              {mode === 'accrual' ? 'Начислить' : 'Списать'}
            </Button>
          </>
        }
      >
        <form id="bonus-form" onSubmit={handleSubmit} className="space-y-4">
          <Field label="Сумма бонусов" htmlFor="bonus-amount" required>
            <Input
              id="bonus-amount"
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              rightSlot={<span className="text-sm text-ink-3">₽</span>}
              autoFocus
              required
            />
          </Field>
          <Field label="Причина" htmlFor="bonus-reason" required>
            <Input
              id="bonus-reason"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={mode === 'accrual' ? 'За что начисление' : 'За что списание'}
              required
            />
          </Field>
        </form>
      </Modal>
    </Card>
  );
}

// ---- Скелет карточки на время загрузки ----
function ClientDetailSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Загрузка карточки клиента">
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" className="h-10 w-10" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton variant="text" className="w-40" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
        <div className="space-y-5">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      </div>
    </div>
  );
}

// ---- Страница ----
export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const timeZone = useTenantTimezone();
  const vinEnabled = useVinEnabled();

  // ROLE/PERMISSION: editing an existing client profile (ФИО / телефон /
  // комментарий) requires `clients_edit`. Байпас superadmin/director — внутри
  // hasPermission; admin — по матрице роли из /auth/me (волна Битрикс24).
  // Creating a new client, attaching a car, adding to a check stay ungated.
  const canEditClient = hasPermission('clients_edit');

  // Client edit modal
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [clientComment, setClientComment] = useState('');

  // Car modal (общая форма CarFormModal)
  const [carModalOpen, setCarModalOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<CarType | null>(null);
  const [newOwner, setNewOwner] = useState<Client | null>(null);
  const [vinError, setVinError] = useState<VinDuplicateInfo | null>(null);
  // Значения формы на момент проверки дубля госномера — чтобы «Всё равно
  // создать» отправило ровно то, что человек заполнил.
  const [pendingCar, setPendingCar] = useState<CarFormValues | null>(null);

  // Delete car confirm
  const [deleteCarId, setDeleteCarId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Duplicate-by-plate warning
  const [duplicateCar, setDuplicateCar] = useState<{
    id: string;
    plateNumber: string;
    makeModel: string;
    clientId: string | null;
    client: { id: string; fullName: string; phone: string } | null;
  } | null>(null);
  const [carSubmitting, setCarSubmitting] = useState(false);

  // Expanded car (to show checks)
  const [expandedCarId, setExpandedCarId] = useState<string | null>(null);

  // Dedicated «Сменить владельца» flow (feature #9). Convenient per-car action,
  // separate from the owner-change field inside the car edit modal (which
  // stays working too). Both paths end in carsApi.
  const [reassignCar, setReassignCar] = useState<CarType | null>(null);
  const [reassignTarget, setReassignTarget] = useState<Client | null>(null);

  // Fetch client
  const {
    data: client,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Client>({
    queryKey: ['clients', id],
    queryFn: async () => {
      const res = await clientsApi.getById(id!);
      return res.data;
    },
    enabled: !!id,
  });

  // Fetch recent checks for this client
  const {
    data: checksData,
    isLoading: checksLoading,
    isError: checksError,
    refetch: refetchChecks,
    isFetching: checksFetching,
  } = useQuery<{ data: Check[] }>({
    queryKey: ['checks', { clientId: id, limit: 5 }],
    queryFn: async () => {
      const res = await checksApi.getAll({ clientId: id, limit: 5 });
      return res.data;
    },
    enabled: !!id,
  });

  // Client update mutation
  const updateClientMutation = useMutation({
    mutationFn: (data: { fullName: string; phone: string; comment?: string }) => clientsApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Клиент обновлён');
      setClientModalOpen(false);
    },
    // Глухой текст глотал реальную причину: 409 «этот номер уже занят» (в том
    // числе 161 — карточкой ДРУГОГО ФИЛИАЛА, куда навигировать некуда: сервер
    // намеренно не отдаёт ни имени, ни id) и 400 про пустое имя. Показываем
    // сообщение сервера — оно объясняет, что делать.
    onError: (err) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка при обновлении клиента', { duration: 8000 });
    },
  });

  /** 409 VIN_DUPLICATE — под полем VIN (форма остаётся открытой); остальное — тост. */
  const carWriteError = (err: unknown, fallback: string) => {
    const dup = vinDuplicateError(err);
    if (dup) {
      setVinError(dup);
      return;
    }
    toast.error(apiErrorMessage(err) ?? fallback);
  };

  // Car mutations
  const createCarMutation = useMutation({
    mutationFn: (data: CreateCarRequest) => carsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      toast.success('Автомобиль добавлен');
      closeCarModal();
    },
    onError: (err) => carWriteError(err, 'Ошибка при добавлении автомобиля'),
  });

  const updateCarMutation = useMutation({
    mutationFn: ({ carId, data }: { carId: string; data: UpdateCarRequest }) => carsApi.update(carId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      toast.success('Автомобиль обновлён');
      closeCarModal();
    },
    onError: (err) => carWriteError(err, 'Ошибка при обновлении автомобиля'),
  });

  const deleteCarMutation = useMutation({
    mutationFn: (carId: string) => carsApi.remove(carId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      toast.success('Автомобиль удалён');
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err) ?? 'Ошибка при удалении автомобиля');
    },
  });

  // Dedicated «Сменить владельца» mutation (feature #9). Reassigns the car AND
  // its full history (checks + derived debts / bonuses / installments) to the
  // picked client via transferOwner. Backend guards against a duplicate plate
  // under the TARGET client and answers 400 «У этого клиента уже есть авто с
  // таким номером» — we surface that message directly. We invalidate BOTH the
  // old owner (this page, `id`) and the new owner so the car + history vanish
  // here and appear under the new owner.
  const reassignCarMutation = useMutation({
    mutationFn: ({ carId, clientId }: { carId: string; clientId: string }) =>
      carsApi.transferOwner(carId, { clientId }),
    onSuccess: (res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['clients', vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      const moved = res.data?.movedChecks ?? 0;
      toast.success(moved > 0 ? `Владелец изменён — перенесено чеков: ${moved}` : 'Владелец автомобиля изменён');
      closeReassignModal();
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err) || 'Не удалось сменить владельца');
    },
  });

  // Client edit handlers
  const openClientEditModal = () => {
    if (!client) return;
    setFullName(client.fullName);
    setPhone(client.phone);
    setClientComment(client.comment || '');
    setClientModalOpen(true);
  };

  const handleClientSubmit = (e: FormEvent) => {
    e.preventDefault();
    updateClientMutation.mutate({
      fullName,
      phone,
      comment: clientComment || undefined,
    });
  };

  // Car handlers
  const openAddCarModal = () => {
    setEditingCar(null);
    setNewOwner(null);
    setVinError(null);
    setPendingCar(null);
    setCarModalOpen(true);
  };

  const openEditCarModal = (car: CarType) => {
    setEditingCar(car);
    setNewOwner(null);
    setVinError(null);
    setPendingCar(null);
    setCarModalOpen(true);
  };

  const closeCarModal = () => {
    setCarModalOpen(false);
    setEditingCar(null);
    setNewOwner(null);
    setVinError(null);
    setPendingCar(null);
  };

  // Reassign («Сменить владельца») handlers
  const openReassignModal = (car: CarType) => {
    setReassignCar(car);
    setReassignTarget(null);
  };

  const closeReassignModal = () => {
    setReassignCar(null);
    setReassignTarget(null);
  };

  const confirmReassign = () => {
    if (!reassignCar || !reassignTarget) return;
    reassignCarMutation.mutate({ carId: reassignCar.id, clientId: reassignTarget.id });
  };

  /** Тело create-запроса: VIN уходит только при включённой опции. */
  const createPayload = (values: CarFormValues): CreateCarRequest => ({
    plateNumber: values.plateNumber,
    makeModel: values.makeModel,
    comment: values.comment || undefined,
    clientId: id!,
    ...(vinEnabled && values.vin ? { vin: values.vin } : {}),
  });

  const handleCarSubmit = async (values: CarFormValues) => {
    setVinError(null);
    if (editingCar) {
      const payload: UpdateCarRequest = {
        plateNumber: values.plateNumber,
        makeModel: values.makeModel,
        comment: values.comment || undefined,
      };
      // Include clientId only if owner was changed
      if (newOwner) payload.clientId = newOwner.id;
      // Пустой VIN при включённой опции = очистить.
      if (vinEnabled) payload.vin = values.vin || null;
      updateCarMutation.mutate({ carId: editingCar.id, data: payload });
      return;
    }
    // Pre-create duplicate check by plate.
    setCarSubmitting(true);
    try {
      const res = await carsApi.lookupByPlate(values.plateNumber);
      const existing = res.data;
      if (existing) {
        setPendingCar(values);
        setDuplicateCar(existing);
        return;
      }
      createCarMutation.mutate(createPayload(values));
    } catch {
      createCarMutation.mutate(createPayload(values));
    } finally {
      setCarSubmitting(false);
    }
  };

  const handleCreateCarAnyway = () => {
    setDuplicateCar(null);
    if (!pendingCar) return;
    createCarMutation.mutate(createPayload(pendingCar));
  };

  const handleOpenExistingCar = () => {
    if (!duplicateCar) return;
    const ownerId = duplicateCar.clientId;
    setDuplicateCar(null);
    closeCarModal();
    if (ownerId && ownerId !== id) {
      navigate(`/clients/${ownerId}`);
    }
  };

  const handleDeleteCar = (carId: string) => {
    setDeleteCarId(carId);
    setConfirmOpen(true);
  };

  const confirmDeleteCar = () => {
    if (deleteCarId) {
      deleteCarMutation.mutate(deleteCarId);
      setDeleteCarId(null);
    }
  };

  const toggleCarExpand = (carId: string) => {
    setExpandedCarId((prev) => (prev === carId ? null : carId));
  };

  if (isLoading) return <ClientDetailSkeleton />;

  // 404 — карточки нет (удалена / чужой филиал); всё остальное — ошибка сети,
  // из которой есть выход «Повторить» (аудит: ошибка ≠ пусто).
  if (isError && apiErrorStatus(error) !== 404) {
    return (
      <QueryState
        isLoading={false}
        isError
        onRetry={() => refetch()}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить карточку клиента"
        minHeight="min-h-[40vh]"
      >
        {null}
      </QueryState>
    );
  }

  if (!client) {
    return (
      <EmptyState
        icon={User}
        title="Клиент не найден"
        description="Запрашиваемый клиент не существует или был удалён"
        action={{ label: 'К списку клиентов', onClick: () => navigate('/clients') }}
      />
    );
  }

  const recentChecks: Check[] = checksData?.data || [];
  const cars = client.cars ?? [];

  const recentColumns: DataTableColumn<Check>[] = [
    {
      key: 'number',
      header: '№',
      primary: true,
      width: 110,
      render: (c) => (
        <span className="inline-flex items-center gap-2 tabular-nums">
          #{c.number}
          {c.isDeferred && (
            <StatusPill tone="warn" size="sm">
              Отложен
            </StatusPill>
          )}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Дата',
      width: 130,
      render: (c) => (
        <span className="whitespace-nowrap tabular-nums text-ink-3">
          {formatDateTime(c.date || c.createdAt, timeZone)}
        </span>
      ),
    },
    {
      key: 'car',
      header: 'Автомобиль',
      hideBelow: 'md',
      render: (c) =>
        c.car ? (
          <span className="min-w-0">
            <span className="block truncate">{c.car.makeModel}</span>
            {c.car.plateNumber && <span className="block text-xs tabular-nums text-ink-3">{c.car.plateNumber}</span>}
          </span>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    { key: 'payment', header: 'Оплата', hideBelow: 'sm', render: (c) => <PaymentBadge method={c.paymentMethod} /> },
    {
      key: 'master',
      header: 'Мастер',
      hideBelow: 'lg',
      render: (c) =>
        c.master ? <span className="truncate">{c.master.fullName}</span> : <span className="text-ink-4">—</span>,
    },
    {
      key: 'comment',
      header: 'Комментарий',
      hideBelow: 'xl',
      truncate: true,
      width: 200,
      render: (c) =>
        c.comment ? (
          <span className="text-ink-3" title={c.comment}>
            {c.comment}
          </span>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    {
      key: 'discount',
      header: 'Скидка',
      numeric: true,
      hideBelow: 'lg',
      width: 100,
      render: (c) =>
        (c.discount ?? 0) > 0 ? (
          <Money value={-(c.discount ?? 0)} className="text-ink-3" />
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    {
      key: 'total',
      header: 'Сумма',
      numeric: true,
      width: 120,
      render: (c) => <Money value={c.totalRevenue} className="font-semibold text-ink" />,
      footer: (rows) => <Money value={rows.reduce((s, c) => s + (c.totalRevenue || 0), 0)} />,
    },
  ];

  const registeredAt = formatDateShort(client.createdAt, timeZone);
  const subtitleParts = [
    client.phone ? formatPhone(client.phone) : client.isRetail ? null : 'Без номера',
    `в базе с ${registeredAt}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-5">
      <PageHeader
        backTo="/clients"
        icon={client.isRetail ? ShoppingBag : User}
        title={client.fullName}
        subtitle={subtitleParts}
        meta={
          <>
            {client.isRetail && <Badge tone="neutral">Розничный</Badge>}
            {client.source && (
              <Badge outline icon={Tag}>
                {client.source}
              </Badge>
            )}
          </>
        }
        actions={
          canEditClient ? (
            <Button variant="secondary" icon={Pencil} onClick={openClientEditModal}>
              Редактировать
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:items-start">
        {/* ── Левая колонка: автомобили и чеки ── */}
        <div className="space-y-5 xl:col-span-2">
          <Card padding="none">
            <CardHeader
              icon={Car}
              title={`Автомобили${cars.length ? ` (${cars.length})` : ''}`}
              subtitle="Нажмите на автомобиль, чтобы увидеть чеки по нему"
              divider={false}
              actions={
                <Button icon={Plus} onClick={openAddCarModal}>
                  Добавить авто
                </Button>
              }
            />
            {cars.length === 0 ? (
              <div className="border-t border-line">
                <EmptyState
                  icon={Car}
                  title="Автомобилей пока нет"
                  description="Добавьте автомобиль клиента — по нему будут группироваться чеки"
                  compact
                />
              </div>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {cars.map((car) => {
                  const expanded = expandedCarId === car.id;
                  const vin = vinEnabled ? carVin(car) : null;
                  const panelId = `car-checks-${car.id}`;
                  return (
                    <li key={car.id}>
                      <div className="flex items-start gap-3 px-5 py-3">
                        <span
                          className={cn(
                            'mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
                            toneChip.neutral,
                          )}
                          aria-hidden="true"
                        >
                          <Car className="h-[18px] w-[18px]" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => toggleCarExpand(car.id)}
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            className={cn(
                              '-mx-1 flex max-w-full items-center gap-2 rounded-md px-1 py-0.5 text-left hover:text-accent-text',
                              focusRing,
                            )}
                          >
                            {car.plateNumber ? (
                              <span className="whitespace-nowrap font-semibold tabular-nums tracking-wide text-ink">
                                {car.plateNumber}
                              </span>
                            ) : (
                              <Badge outline size="sm">
                                Без номера
                              </Badge>
                            )}
                            <span className="truncate text-sm text-ink-2">{car.makeModel}</span>
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 flex-shrink-0 text-ink-4 transition-transform duration-150',
                                expanded && 'rotate-180',
                              )}
                              aria-hidden="true"
                            />
                          </button>
                          {vin && (
                            <div className="mt-0.5">
                              <VinLine vin={vin} />
                            </div>
                          )}
                          {car.comment && <p className="mt-0.5 text-xs text-ink-3">{car.comment}</p>}
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-0.5">
                          {canEditClient && (
                            <IconButton
                              label="Сменить владельца"
                              icon={UserCheck}
                              size="sm"
                              onClick={() => openReassignModal(car)}
                            />
                          )}
                          <IconButton
                            label="Редактировать"
                            icon={Pencil}
                            size="sm"
                            onClick={() => openEditCarModal(car)}
                          />
                          <IconButton
                            label="Удалить"
                            icon={Trash2}
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeleteCar(car.id)}
                          />
                        </div>
                      </div>

                      {expanded && (
                        <div id={panelId} className="border-t border-line bg-surface-2/60">
                          <CarChecksPanel carId={car.id} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card padding="none">
            <CardHeader
              icon={FileText}
              title="Последние чеки"
              subtitle="Пять последних заказ-нарядов клиента"
              divider={false}
            />
            <div className="border-t border-line">
              <DataTable
                bare
                caption="Последние чеки клиента"
                columns={recentColumns}
                rows={recentChecks}
                rowKey={(c) => c.id}
                rowHref={(c) => `/checks/${c.id}`}
                rowLabel={(c) => `Открыть чек №${c.number}`}
                isLoading={checksLoading}
                isError={checksError}
                onRetry={() => refetchChecks()}
                isFetching={checksFetching}
                skeletonRows={3}
                errorTitle="Не удалось загрузить чеки клиента"
                emptyState={{
                  icon: FileText,
                  title: 'Чеков пока нет',
                  description: 'У клиента ещё не было заказ-нарядов',
                }}
              />
            </div>
          </Card>
        </div>

        {/* ── Правая колонка: контакты, рассрочка, бонусы ── */}
        <div className="space-y-5">
          <Card padding="none">
            <CardHeader dense icon={User} iconTone="neutral" title="О клиенте" />
            <CardBody padding="sm">
              <dl className="space-y-3 px-1 text-sm">
                <div className="flex items-start gap-3">
                  <dt className="flex w-28 flex-shrink-0 items-center gap-1.5 text-ink-3">
                    <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                    Телефон
                  </dt>
                  <dd className="min-w-0 flex-1 text-ink">
                    {client.phone ? (
                      <a
                        href={`tel:+${client.phone.replace(/\D/g, '')}`}
                        className={cn('tabular-nums hover:text-accent-text', focusRing)}
                      >
                        {formatPhone(client.phone)}
                      </a>
                    ) : (
                      <span className="text-ink-3">{client.isRetail ? '—' : 'Без номера'}</span>
                    )}
                  </dd>
                </div>
                <div className="flex items-start gap-3">
                  <dt className="flex w-28 flex-shrink-0 items-center gap-1.5 text-ink-3">
                    <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                    Комментарий
                  </dt>
                  <dd className="min-w-0 flex-1 whitespace-pre-line text-ink">
                    {client.comment ? client.comment : <span className="text-ink-4">—</span>}
                  </dd>
                </div>
                {client.source && (
                  <div className="flex items-start gap-3">
                    <dt className="flex w-28 flex-shrink-0 items-center gap-1.5 text-ink-3">
                      <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                      Источник
                    </dt>
                    <dd className="min-w-0 flex-1 text-ink">{client.source}</dd>
                  </div>
                )}
                {typeof client.lastRating === 'number' && (
                  <div className="flex items-start gap-3">
                    <dt className="flex w-28 flex-shrink-0 items-center gap-1.5 text-ink-3">
                      <Star className="h-3.5 w-3.5" aria-hidden="true" />
                      Оценка
                    </dt>
                    <dd className="min-w-0 flex-1 text-ink">
                      <span className="tabular-nums">{client.lastRating} из 5</span>
                      {client.lastRatingAt && (
                        <span className="text-ink-3"> · {formatDateShort(client.lastRatingAt, timeZone)}</span>
                      )}
                    </dd>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <dt className="flex w-28 flex-shrink-0 items-center gap-1.5 text-ink-3">
                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                    Добавлен
                  </dt>
                  <dd className="min-w-0 flex-1 tabular-nums text-ink">{registeredAt}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <ClientDebtSection clientId={id!} clientName={client.fullName} />
          <ClientLoyaltySection clientId={id!} clientName={client.fullName} />
        </div>
      </div>

      {/* Client Edit Modal */}
      <Modal
        isOpen={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        title="Редактировать клиента"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setClientModalOpen(false)}
              disabled={updateClientMutation.isPending}
            >
              Отмена
            </Button>
            <Button type="submit" form="client-edit-form" loading={updateClientMutation.isPending}>
              Сохранить
            </Button>
          </>
        }
      >
        <form id="client-edit-form" onSubmit={handleClientSubmit} className="space-y-4">
          <Field label="ФИО" htmlFor="client-edit-name" required>
            <Input
              id="client-edit-name"
              name="fullName"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Введите ФИО клиента"
              required
            />
          </Field>

          <Field label="Телефон" htmlFor="client-edit-phone" required>
            <PhoneInput
              id="client-edit-phone"
              name="phone"
              autoComplete="tel"
              value={phone}
              onChange={setPhone}
              placeholder="+7 (___) ___-__-__"
              required
            />
          </Field>

          <Field label="Комментарий" htmlFor="client-edit-comment">
            <Textarea
              id="client-edit-comment"
              name="comment"
              value={clientComment}
              onChange={(e) => setClientComment(e.target.value)}
              rows={3}
              placeholder="Необязательно"
            />
          </Field>
        </form>
      </Modal>

      {/* Car Modal — общая форма с VIN */}
      <CarFormModal
        isOpen={carModalOpen}
        onClose={closeCarModal}
        title={editingCar ? 'Редактировать автомобиль' : 'Добавить автомобиль'}
        description={editingCar ? undefined : `Владелец: ${client.fullName}`}
        initial={
          editingCar
            ? {
                plateNumber: editingCar.plateNumber,
                makeModel: editingCar.makeModel,
                vin: carVin(editingCar) ?? '',
                comment: editingCar.comment || '',
              }
            : EMPTY_CAR_FORM
        }
        vinEnabled={vinEnabled}
        submitting={createCarMutation.isPending || updateCarMutation.isPending || carSubmitting}
        submitLabel={editingCar ? 'Сохранить' : 'Добавить'}
        vinError={vinError}
        currentClientId={id}
        onSubmit={handleCarSubmit}
        extra={
          editingCar ? (
            <div className="border-t border-line pt-4">
              <p className="mb-1.5 text-sm font-medium text-ink-2">Сменить владельца</p>
              <p className="mb-2 text-xs text-ink-3">
                Текущий владелец: <span className="font-medium text-ink-2">{client.fullName}</span>
              </p>
              <ClientSearchAutocomplete selectedClient={newOwner} onSelect={setNewOwner} excludeClientId={id} />
              {newOwner && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-warn-text">
                  <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Автомобиль будет перенесён к клиенту: {newOwner.fullName}
                </p>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Delete Car Confirm */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmDeleteCar}
        title="Удалить автомобиль"
        message="Вы уверены, что хотите удалить этот автомобиль? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />

      {/* Duplicate-by-plate warning */}
      <DuplicateWarningDialog
        isOpen={!!duplicateCar}
        onClose={() => setDuplicateCar(null)}
        onCreateAnyway={handleCreateCarAnyway}
        onOpenExisting={handleOpenExistingCar}
        title="Такой автомобиль уже есть"
        description={
          duplicateCar?.clientId === id
            ? `Госномер ${duplicateCar?.plateNumber} уже привязан к этому клиенту. Создать дубликат?`
            : `Госномер ${duplicateCar?.plateNumber || pendingCar?.plateNumber || ''} уже привязан к другому клиенту. Откройте его карточку, чтобы изменить данные.`
        }
        existingLabel={duplicateCar?.makeModel || ''}
        existingSubtitle={
          duplicateCar?.client
            ? `Клиент: ${duplicateCar.client.fullName} · ${formatPhone(duplicateCar.client.phone)}`
            : duplicateCar?.plateNumber
        }
        openExistingLabel={duplicateCar?.clientId === id ? 'Закрыть' : 'Открыть владельца'}
      />

      {/* Dedicated «Сменить владельца» modal (feature #9) */}
      <Modal
        isOpen={!!reassignCar}
        onClose={closeReassignModal}
        title="Сменить владельца"
        description={reassignCar ? `${reassignCar.plateNumber || 'Без номера'} · ${reassignCar.makeModel}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={closeReassignModal} disabled={reassignCarMutation.isPending}>
              Отмена
            </Button>
            <Button onClick={confirmReassign} disabled={!reassignTarget} loading={reassignCarMutation.isPending}>
              Сменить владельца
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-ink-3">
            Текущий владелец: <span className="font-medium text-ink-2">{client.fullName}</span>
          </p>
          <div>
            <p className="label">Новый владелец</p>
            <ClientSearchAutocomplete
              selectedClient={reassignTarget}
              onSelect={setReassignTarget}
              excludeClientId={id}
            />
          </div>

          {reassignTarget && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-xs text-warn-text">
              <UserCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span>
                Авто и вся его история (чеки, долги, бонусы) будут перенесены клиенту{' '}
                <span className="font-semibold">{reassignTarget.fullName}</span>.
              </span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
