import { useState, useEffect, useRef, FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Edit2,
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
  ChevronUp,
  ChevronRight,
  Search,
  UserCheck,
  Loader2,
  Clock,
  Percent,
  TrendingUp,
  Coins,
  Gift,
  Wallet,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { clientsApi, carsApi, checksApi, installmentsApi, loyaltyApi, walletApi } from '../api/services';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DuplicateWarningDialog from '../components/DuplicateWarningDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import PhoneInput from '../components/PhoneInput';
import { useAuth } from '../contexts/AuthContext';
import {
  Client,
  Car as CarType,
  Check,
  InstallmentClientLedger,
  InstallmentPlan,
  ClientBonusSummary,
  BonusType,
  UserRole,
  WalletSettings,
} from '../types';
import { formatPhone } from '../../../shared/validation/phone';

const formatMoney = (amount: number) => amount.toLocaleString('ru-RU') + ' ₽';

// ---- Car Checks Expandable Panel ----
function CarChecksPanel({ carId }: { carId: string }) {
  const navigate = useNavigate();

  const { data: checksData, isLoading } = useQuery<{ data: Check[] }>({
    queryKey: ['checks', { carId }],
    queryFn: async () => {
      const res = await checksApi.getAll({ carId });
      return res.data;
    },
    enabled: !!carId,
  });

  const checks: Check[] = checksData?.data || [];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('ru-RU') + ' \u20BD';
  };

  const paymentLabel = (method: string) => {
    switch (method) {
      case 'cash':
        return 'Наличные';
      case 'card':
        return 'Карта';
      case 'warranty':
        return 'Гарантия';
      case 'cash_card':
        return 'Нал + Карта';
      case 'installment':
        return 'Рассрочка';
      default:
        return method;
    }
  };

  const paymentBadge = (method: string) => {
    switch (method) {
      case 'cash':
        return 'badge-success';
      case 'card':
        return 'badge-info';
      case 'warranty':
        return 'badge-warning';
      default:
        return 'badge-default';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        <span className="ml-2 text-sm text-gray-500">Загрузка чеков...</span>
      </div>
    );
  }

  if (checks.length === 0) {
    return <div className="py-4 text-center text-sm text-gray-400">Нет чеков для этого автомобиля</div>;
  }

  return (
    <div className="space-y-2 py-1">
      {checks.map((check) => (
        <div
          key={check.id}
          onClick={() => navigate(`/checks/${check.id}`)}
          className={`rounded-xl border shadow-sm overflow-hidden active:scale-[0.99] transition-all cursor-pointer ${
            check.isDeferred ? 'bg-red-50/50 border-red-200' : 'bg-white border-gray-100'
          }`}
        >
          <div className="px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-gray-900">#{check.number}</span>
                {check.isDeferred && (
                  <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                    Отложен
                  </span>
                )}
                <span className={paymentBadge(check.paymentMethod)}>{paymentLabel(check.paymentMethod)}</span>
              </div>
              <span className="text-sm font-bold text-gray-900 flex-shrink-0">
                {formatCurrency(check.totalRevenue)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
              <span>{formatDate(check.date || check.createdAt)}</span>
              {check.master && <span>{check.master.fullName}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Client Search Autocomplete for owner change ----
function ClientSearchAutocomplete({
  selectedClient,
  onSelect,
  excludeClientId,
}: {
  selectedClient: Client | null;
  onSelect: (client: Client | null) => void;
  excludeClientId?: string;
}) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: clientsData, isLoading } = useQuery<{ data: Client[] }>({
    queryKey: ['clients', { search, limit: 10 }],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search, limit: 10 });
      return res.data;
    },
    enabled: search.length >= 1,
  });

  const clients: Client[] = (clientsData?.data || []).filter((c) => c.id !== excludeClientId);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (client: Client) => {
    onSelect(client);
    setSearch('');
    setIsOpen(false);
  };

  const handleClear = () => {
    onSelect(null);
    setSearch('');
  };

  if (selectedClient) {
    return (
      <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-xl border border-primary-200">
        <div className="p-1.5 bg-white rounded-lg">
          <UserCheck className="w-4 h-4 text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{selectedClient.fullName}</p>
          <p className="text-xs text-gray-500">{formatPhone(selectedClient.phone)}</p>
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
        >
          Сбросить
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (search.length >= 1) setIsOpen(true);
          }}
          className="input pl-9"
          placeholder="Поиск клиента по имени или телефону..."
        />
      </div>

      {isOpen && search.length >= 1 && (
        <div className="absolute z-50 w-full mt-1 bg-white rounded-xl shadow-lg border border-gray-200 max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
              <span className="ml-2 text-sm text-gray-500">Поиск...</span>
            </div>
          ) : clients.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-400">Клиенты не найдены</div>
          ) : (
            clients.map((client) => (
              <button
                key={client.id}
                type="button"
                onClick={() => handleSelect(client)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors first:rounded-t-xl last:rounded-b-xl"
              >
                <div className="p-1.5 bg-gray-100 rounded-lg">
                  <User className="w-4 h-4 text-gray-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{client.fullName}</p>
                  <p className="text-xs text-gray-500">{formatPhone(client.phone)}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---- Client Installments Section (Рассрочка) ----
function ClientDebtSection({ clientId, clientName }: { clientId: string; clientName: string }) {
  const navigate = useNavigate();

  const { data: ledger, isLoading } = useQuery<InstallmentClientLedger>({
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

  const statusBadge = (plan: InstallmentPlan) => {
    if (plan.status === 'closed') return <span className="badge-green">Закрыта</span>;
    if (plan.overdue) return <span className="badge-red">Просрочена</span>;
    return <span className="badge-blue">Открыта</span>;
  };

  const fmtDate = (d?: string | null) => {
    if (!d) return '—';
    const parts = d.slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : d;
  };

  return (
    <div className="card p-6 mb-6">
      {/* Header + outstanding balance + manage link */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-50 rounded-lg">
            <Coins className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Рассрочка</h2>
            {isLoading ? (
              <p className="text-sm text-gray-400">Загрузка…</p>
            ) : totalRemaining > 0 ? (
              <p className="text-sm">
                <span className="text-gray-500">Остаток: </span>
                <span className="font-bold text-rose-600">{formatMoney(totalRemaining)}</span>
              </p>
            ) : (
              <p className="text-sm font-medium text-gray-500">Нет активной рассрочки</p>
            )}
          </div>
        </div>

        {plans.length > 0 && (
          <button type="button" onClick={() => navigate('/installments')} className="btn-secondary btn-sm">
            Управлять
          </button>
        )}
      </div>

      {/* Plans */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        </div>
      ) : plans.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">У клиента {clientName} нет заказ-нарядов в рассрочку</p>
      ) : (
        <div className="space-y-2.5">
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => navigate('/installments')}
              className="w-full flex items-center gap-3 rounded-xl border border-gray-200 px-3.5 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900">
                    {plan.checkNumber ? `Заказ-наряд #${plan.checkNumber}` : 'Рассрочка'}
                  </p>
                  {statusBadge(plan)}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatMoney(plan.paid)} из {formatMoney(plan.total)}
                  {plan.status === 'open' && plan.nextPaymentDate ? ` · след. ${fmtDate(plan.nextPaymentDate)}` : ''}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[11px] text-gray-400">Остаток</p>
                <p className="text-sm font-bold text-gray-900">{formatMoney(plan.remaining)}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Recent payments across the client's plans */}
      {recentPayments.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Последние платежи</p>
          <div className="divide-y divide-gray-100">
            {recentPayments.map((pm) => (
              <div key={pm.id} className="flex items-center justify-between gap-3 py-2">
                <p className="text-xs text-gray-400">
                  {format(new Date(pm.paidAt), 'dd.MM.yy HH:mm', { locale: ru })}
                  {pm.createdByName ? ` · ${pm.createdByName}` : ''}
                </p>
                <span className="text-sm font-bold text-green-600 whitespace-nowrap">{formatMoney(pm.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Client Loyalty / Bonus Section ----
function ClientLoyaltySection({ clientId, clientName }: { clientId: string; clientName: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  const canManage = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<BonusType>('accrual');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [downloadingPass, setDownloadingPass] = useState(false);

  const { data: summary, isLoading } = useQuery<ClientBonusSummary>({
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
    onError: () => toast.error('Не удалось выполнить операцию'),
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
    <div className="card p-6 mb-6">
      {/* Header + balance + actions */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-50 rounded-lg">
            <Gift className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">Бонусы клиента</h2>
              {!isLoading && !enabled && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                  Программа отключена
                </span>
              )}
            </div>
            {isLoading ? (
              <p className="text-sm text-gray-400">Загрузка…</p>
            ) : (
              <p className="text-sm">
                <span className="text-gray-500">Баланс: </span>
                <span className="font-bold text-violet-600">{formatMoney(balance)}</span>
              </p>
            )}
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => openModal('accrual')} className="btn-secondary btn-sm">
              <Plus className="w-4 h-4" />
              Начислить
            </button>
            <button
              type="button"
              onClick={() => openModal('redemption')}
              disabled={balance <= 0}
              className="btn-secondary btn-sm disabled:opacity-50"
            >
              <Minus className="w-4 h-4" />
              Списать
            </button>
            {walletConfigured && (
              <button
                type="button"
                onClick={handleDownloadPass}
                disabled={downloadingPass}
                className="btn-ghost btn-sm disabled:opacity-50"
                title="Скачать карту лояльности для Apple Wallet (.pkpass)"
              >
                {downloadingPass ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                Скачать карту
              </button>
            )}
          </div>
        )}
      </div>

      {/* Totals */}
      {!isLoading && (summary?.totalAccrued || summary?.totalRedeemed) ? (
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-green-600" />
            <span className="text-xs text-gray-500">Начислено всего:</span>
            <span className="text-xs font-bold text-green-600">{formatMoney(summary?.totalAccrued ?? 0)}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-orange-50 px-3 py-1.5">
            <Coins className="w-3.5 h-3.5 text-orange-600" />
            <span className="text-xs text-gray-500">Списано всего:</span>
            <span className="text-xs font-bold text-orange-600">{formatMoney(summary?.totalRedeemed ?? 0)}</span>
          </div>
        </div>
      ) : null}

      {/* Ledger */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        </div>
      ) : ledger.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">Бонусных операций пока нет</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {ledger.map((entry) => {
            const isAccrual = entry.type === 'accrual';
            return (
              <div key={entry.id} className="flex items-center gap-3 py-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0 ${
                    isAccrual ? 'bg-green-50' : 'bg-orange-50'
                  }`}
                >
                  {isAccrual ? (
                    <Plus className="w-4 h-4 text-green-600" />
                  ) : (
                    <Minus className="w-4 h-4 text-orange-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {isAccrual ? 'Начисление бонусов' : 'Списание бонусов'}
                    {entry.reason && <span className="font-normal text-gray-500"> · {entry.reason}</span>}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400 mt-0.5">
                    <span>{format(new Date(entry.createdAt), 'dd.MM.yy HH:mm', { locale: ru })}</span>
                    {entry.createdByName && <span>· {entry.createdByName}</span>}
                    {entry.checkId && (
                      <button
                        type="button"
                        onClick={() => navigate(`/checks/${entry.checkId}`)}
                        className="text-primary-600 hover:text-primary-700 font-medium"
                      >
                        · Чек{entry.checkNumber ? ` #${entry.checkNumber}` : ''}
                      </button>
                    )}
                  </div>
                </div>
                <span
                  className={`text-sm font-bold whitespace-nowrap ${isAccrual ? 'text-green-600' : 'text-orange-600'}`}
                >
                  {isAccrual ? '+' : '−'}
                  {formatMoney(entry.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Accrue / Redeem modal */}
      <Modal isOpen={modalOpen} onClose={closeModal} title={mode === 'accrual' ? 'Начислить бонусы' : 'Списать бонусы'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-500">
            Клиент: <span className="font-medium text-gray-700">{clientName}</span>
            {mode === 'redemption' && (
              <>
                {' '}
                · Доступно: <span className="font-medium text-violet-600">{formatMoney(balance)}</span>
              </>
            )}
          </p>
          <div>
            <label className="label">Сумма бонусов</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input"
              placeholder="0"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label">Причина</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input"
              placeholder={mode === 'accrual' ? 'За что начисление' : 'За что списание'}
              required
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeModal} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={adjustMutation.isPending} className="btn-primary">
              {adjustMutation.isPending ? 'Сохраняем…' : mode === 'accrual' ? 'Начислить' : 'Списать'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ---- Main Page Component ----
export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Client edit modal
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [clientComment, setClientComment] = useState('');

  // Car modal
  const [carModalOpen, setCarModalOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<CarType | null>(null);
  const [plateNumber, setPlateNumber] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [carComment, setCarComment] = useState('');
  const [newOwner, setNewOwner] = useState<Client | null>(null);

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

  // Fetch client
  const {
    data: client,
    isLoading,
    isError,
  } = useQuery<Client>({
    queryKey: ['clients', id],
    queryFn: async () => {
      const res = await clientsApi.getById(id!);
      return res.data;
    },
    enabled: !!id,
  });

  // Fetch recent checks for this client
  const { data: checksData } = useQuery<{ data: Check[] }>({
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
    onError: () => {
      toast.error('Ошибка при обновлении клиента');
    },
  });

  // Car mutations
  const createCarMutation = useMutation({
    mutationFn: (data: { plateNumber: string; makeModel: string; comment?: string; clientId: string }) =>
      carsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      toast.success('Автомобиль добавлен');
      closeCarModal();
    },
    onError: () => {
      toast.error('Ошибка при добавлении автомобиля');
    },
  });

  const updateCarMutation = useMutation({
    mutationFn: ({
      carId,
      data,
    }: {
      carId: string;
      data: { plateNumber: string; makeModel: string; comment?: string; clientId?: string };
    }) => carsApi.update(carId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      toast.success('Автомобиль обновлён');
      closeCarModal();
    },
    onError: () => {
      toast.error('Ошибка при обновлении автомобиля');
    },
  });

  const deleteCarMutation = useMutation({
    mutationFn: (carId: string) => carsApi.remove(carId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', id] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      toast.success('Автомобиль удалён');
    },
    onError: () => {
      toast.error('Ошибка при удалении автомобиля');
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
    setPlateNumber('');
    setMakeModel('');
    setCarComment('');
    setNewOwner(null);
    setCarModalOpen(true);
  };

  const openEditCarModal = (car: CarType) => {
    setEditingCar(car);
    setPlateNumber(car.plateNumber);
    setMakeModel(car.makeModel);
    setCarComment(car.comment || '');
    setNewOwner(null);
    setCarModalOpen(true);
  };

  const closeCarModal = () => {
    setCarModalOpen(false);
    setEditingCar(null);
    setNewOwner(null);
  };

  const handleCarSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload: { plateNumber: string; makeModel: string; comment?: string; clientId?: string } = {
      plateNumber,
      makeModel,
      comment: carComment || undefined,
    };
    if (editingCar) {
      // Include clientId only if owner was changed
      if (newOwner) {
        payload.clientId = newOwner.id;
      }
      updateCarMutation.mutate({ carId: editingCar.id, data: payload });
      return;
    }
    // Pre-create duplicate check by plate.
    setCarSubmitting(true);
    try {
      const res = await carsApi.lookupByPlate(plateNumber);
      const existing = res.data;
      if (existing) {
        setDuplicateCar(existing);
        return;
      }
      createCarMutation.mutate({ ...payload, clientId: id! });
    } catch {
      createCarMutation.mutate({ ...payload, clientId: id! });
    } finally {
      setCarSubmitting(false);
    }
  };

  const handleCreateCarAnyway = () => {
    setDuplicateCar(null);
    createCarMutation.mutate({
      plateNumber,
      makeModel,
      comment: carComment || undefined,
      clientId: id!,
    });
  };

  const handleOpenExistingCar = () => {
    if (!duplicateCar) return;
    const ownerId = duplicateCar.clientId;
    setDuplicateCar(null);
    setCarModalOpen(false);
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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('ru-RU') + ' \u20BD';
  };

  if (isLoading) return <LoadingSpinner />;

  if (isError || !client) {
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

  return (
    <div>
      {/* Back button */}
      <button onClick={() => navigate('/clients')} className="btn-secondary mb-4">
        <ArrowLeft className="w-4 h-4" />
        Назад к клиентам
      </button>

      {/* Client Info Card */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Информация о клиенте</h2>
          <button onClick={openClientEditModal} className="btn-secondary">
            <Edit2 className="w-4 h-4" />
            Редактировать
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-50 rounded-lg">
              <User className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">ФИО</p>
              <p className="font-medium text-gray-900">{client.fullName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <Phone className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Телефон</p>
              <p className="font-medium text-gray-900">{formatPhone(client.phone)}</p>
            </div>
          </div>

          {client.comment && (
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-50 rounded-lg">
                <MessageSquare className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Комментарий</p>
                <p className="font-medium text-gray-900">{client.comment}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <Calendar className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Дата регистрации</p>
              <p className="font-medium text-gray-900">{formatDate(client.createdAt)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Debt / Receivables Section */}
      <ClientDebtSection clientId={id!} clientName={client.fullName} />

      {/* Loyalty / Bonus Section */}
      <ClientLoyaltySection clientId={id!} clientName={client.fullName} />

      {/* Cars Section */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Автомобили ({client.cars?.length || 0})</h2>
          <button onClick={openAddCarModal} className="btn-primary">
            <Plus className="w-4 h-4" />
            Добавить авто
          </button>
        </div>

        {!client.cars || client.cars.length === 0 ? (
          <EmptyState
            icon={Car}
            title="Нет автомобилей"
            description="Добавьте автомобиль клиента"
            action={{ label: 'Добавить авто', onClick: openAddCarModal }}
          />
        ) : (
          <div className="space-y-3">
            {client.cars.map((car) => (
              <div
                key={car.id}
                className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden transition-shadow hover:shadow-sm"
              >
                {/* Car header row */}
                <div className="flex items-center justify-between p-4">
                  <button
                    type="button"
                    onClick={() => toggleCarExpand(car.id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <div className="p-2 bg-white rounded-xl border border-gray-200">
                      <Car className="w-5 h-5 text-gray-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{car.plateNumber}</p>
                      <p className="text-sm text-gray-500">{car.makeModel}</p>
                      {car.comment && <p className="text-xs text-gray-400 mt-0.5">{car.comment}</p>}
                    </div>
                    <div className="ml-auto mr-2">
                      {expandedCarId === car.id ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditCarModal(car);
                      }}
                      className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-white transition-colors"
                      title="Редактировать"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCar(car.id);
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded checks panel */}
                {expandedCarId === car.id && (
                  <div className="border-t border-gray-200 bg-white px-4 py-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 pt-2">
                      Чеки по автомобилю
                    </p>
                    <CarChecksPanel carId={car.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Checks Section — journal-style cards */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Последние чеки</h2>

        {recentChecks.length === 0 ? (
          <EmptyState icon={FileText} title="Нет чеков" description="У клиента пока нет чеков" />
        ) : (
          <div className="space-y-3">
            {recentChecks.map((check) => {
              const paymentLabels: Record<string, string> = {
                cash: 'Наличные',
                card: 'Карта',
                warranty: 'Гарантия',
                cash_card: 'Нал/Карта',
                installment: 'Рассрочка',
              };
              const paymentBadges: Record<string, string> = {
                cash: 'badge-green',
                card: 'badge-blue',
                warranty: 'badge-yellow',
                cash_card: 'badge-gray',
                installment: 'badge-blue',
              };
              return (
                <div
                  key={check.id}
                  onClick={() => navigate(`/checks/${check.id}`)}
                  className={`rounded-2xl border shadow-sm overflow-hidden active:scale-[0.99] transition-all cursor-pointer ${
                    check.isDeferred ? 'bg-red-50/50 border-red-200' : 'bg-white border-gray-100'
                  }`}
                >
                  <div className="px-4 pt-3.5 pb-2.5">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base font-bold text-gray-900">#{check.number}</span>
                        {check.isDeferred && (
                          <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            Отложен
                          </span>
                        )}
                        <span className={`flex-shrink-0 ${paymentBadges[check.paymentMethod] ?? 'badge-gray'}`}>
                          {paymentLabels[check.paymentMethod] ?? check.paymentMethod}
                        </span>
                      </div>
                    </div>
                    {check.car && (
                      <div className="flex items-center gap-2 mb-2">
                        <Car className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <p className="text-sm text-gray-600 truncate">
                          {check.car.makeModel}
                          <span className="text-gray-400 ml-1.5">{check.car.plateNumber}</span>
                        </p>
                      </div>
                    )}
                    {check.comment && (
                      <div className="flex items-start gap-2 mb-2 bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100">
                        <MessageSquare className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700 line-clamp-2">{check.comment}</p>
                      </div>
                    )}
                  </div>
                  <div
                    className={`px-4 py-2.5 border-t flex items-center justify-between gap-3 ${
                      check.isDeferred ? 'border-red-100 bg-red-50/30' : 'border-gray-50 bg-gray-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 text-xs text-gray-400 min-w-0">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{format(new Date(check.date || check.createdAt), 'dd.MM.yy HH:mm', { locale: ru })}</span>
                      </div>
                      {check.master && <span className="truncate">{check.master.fullName}</span>}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {(check.discount ?? 0) > 0 && (
                        <div className="flex items-center gap-0.5">
                          <Percent className="w-3 h-3 text-orange-400" />
                          <span className="text-xs font-medium text-orange-500">
                            -{formatCurrency(check.discount ?? 0)}
                          </span>
                        </div>
                      )}
                      <span className="text-sm font-bold text-gray-900">{formatCurrency(check.totalRevenue)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Client Edit Modal */}
      <Modal isOpen={clientModalOpen} onClose={() => setClientModalOpen(false)} title="Редактировать клиента">
        <form onSubmit={handleClientSubmit} className="space-y-4">
          <div>
            <label className="label">ФИО</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input"
              placeholder="Введите ФИО клиента"
              required
            />
          </div>

          <div>
            <label className="label">Телефон</label>
            <PhoneInput value={phone} onChange={setPhone} placeholder="+7 (___) ___-__-__" required />
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              value={clientComment}
              onChange={(e) => setClientComment(e.target.value)}
              className="input"
              rows={3}
              placeholder="Комментарий (необязательно)"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setClientModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button type="submit" disabled={updateClientMutation.isPending} className="btn-primary">
              Сохранить
            </button>
          </div>
        </form>
      </Modal>

      {/* Car Modal */}
      <Modal
        isOpen={carModalOpen}
        onClose={closeCarModal}
        title={editingCar ? 'Редактировать автомобиль' : 'Добавить автомобиль'}
      >
        <form onSubmit={handleCarSubmit} className="space-y-4">
          <div>
            <label className="label">Гос номер</label>
            <input
              type="text"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value.replace(/\s+/g, '').toUpperCase())}
              className="input"
              placeholder="А123АА77"
              required
            />
          </div>

          <div>
            <label className="label">Марка / Модель</label>
            <input
              type="text"
              value={makeModel}
              onChange={(e) => setMakeModel(e.target.value)}
              className="input"
              placeholder="Например: Chevrolet Malibu"
              required
            />
          </div>

          <div>
            <label className="label">Комментарий</label>
            <textarea
              value={carComment}
              onChange={(e) => setCarComment(e.target.value)}
              className="input"
              rows={3}
              placeholder="Комментарий (необязательно)"
            />
          </div>

          {/* Owner change - only shown when editing */}
          {editingCar && (
            <div>
              <label className="label">Сменить владельца</label>
              <p className="text-xs text-gray-500 mb-2">
                Текущий владелец: <span className="font-medium text-gray-700">{client.fullName}</span>
              </p>
              <ClientSearchAutocomplete selectedClient={newOwner} onSelect={setNewOwner} excludeClientId={id} />
              {newOwner && (
                <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                  <UserCheck className="w-3 h-3" />
                  Автомобиль будет перенесён к клиенту: {newOwner.fullName}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={closeCarModal} className="btn-secondary">
              Отмена
            </button>
            <button
              type="submit"
              disabled={createCarMutation.isPending || updateCarMutation.isPending || carSubmitting}
              className="btn-primary"
            >
              {editingCar ? 'Сохранить' : carSubmitting ? 'Проверяем…' : 'Добавить'}
            </button>
          </div>
        </form>
      </Modal>

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
            : `Госномер ${duplicateCar?.plateNumber || plateNumber} уже привязан к другому клиенту. Откройте его карточку, чтобы изменить данные.`
        }
        existingLabel={duplicateCar?.makeModel || ''}
        existingSubtitle={
          duplicateCar?.client
            ? `Клиент: ${duplicateCar.client.fullName} · ${formatPhone(duplicateCar.client.phone)}`
            : duplicateCar?.plateNumber
        }
        openExistingLabel={duplicateCar?.clientId === id ? 'Закрыть' : 'Открыть владельца'}
      />
    </div>
  );
}
