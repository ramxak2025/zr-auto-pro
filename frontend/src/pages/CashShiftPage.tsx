import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wallet,
  Banknote,
  CreditCard,
  Receipt,
  ArrowDownToLine,
  Landmark,
  Lock,
  Unlock,
  Printer,
  Scale,
  TrendingUp,
  TrendingDown,
  Users,
  History,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { cashShiftsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantTimezone } from '../hooks/useTenantTimezone';
import { usePointAccess } from '../hooks/usePoints';
import { apiErrorMessage } from '../../../shared/utils/apiError';

import type { CashShift, CashShiftReport, SafeTransaction } from '../../../shared/types';
import { formatMoney, formatDateTime } from '../../../shared/utils/formatters';
import QueryState from '../components/QueryState';
import PageHeader from '../components/PageHeader';
import PointBadge from '../components/PointBadge';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { StatCard } from '../ui/StatCard';
import { StatusPill } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Money } from '../ui/Money';
import { Skeleton } from '../ui/Skeleton';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { cn } from '../ui/cn';
import type { Tone } from '../ui/tokens';

const HISTORY_LIMIT = 20;

function parseAmount(value: string): number {
  const n = Number(value.replace(/\s/g, '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
}

function diffMeta(diff: number): { label: string; tone: Tone; Icon: typeof Scale } {
  if (diff > 0) return { label: `Излишек ${formatMoney(diff)}`, tone: 'ok', Icon: TrendingUp };
  if (diff < 0) return { label: `Недостача ${formatMoney(Math.abs(diff))}`, tone: 'bad', Icon: TrendingDown };
  return { label: 'Касса сходится', tone: 'neutral', Icon: Scale };
}

const toneTextCls: Record<Tone, string> = {
  neutral: 'text-ink',
  accent: 'text-accent-text',
  ok: 'text-ok-text',
  warn: 'text-warn-text',
  bad: 'text-bad-text',
  info: 'text-info-text',
};

/** Строка Z-отчёта: подпись слева, сумма справа табличными цифрами. */
function ReportRow({ label, value, strong, tone }: { label: string; value: ReactNode; strong?: boolean; tone?: Tone }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className={cn('text-sm', strong ? 'font-semibold text-ink' : 'text-ink-2')}>{label}</span>
      <span
        className={cn(
          'text-sm tabular-nums',
          strong ? 'font-semibold' : 'font-medium',
          tone ? toneTextCls[tone] : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Printable-friendly full Z-report document. Reused for history + post-close. */
function ZReportDocument({ report }: { report: CashShiftReport }) {
  // Время смены — в поясе автосервиса: смена открывается и закрывается по его
  // календарным суткам (shifts.service), Z-отчёт обязан показывать то же время.
  const timeZone = useTenantTimezone();
  const s = report.shift;
  const closed = s.status === 'closed';
  const diff = report.difference != null ? diffMeta(report.difference) : null;

  return (
    <div className="space-y-5 print:text-black">
      <div className="pb-1 text-center">
        <h3 className="text-md font-semibold text-ink">Z-отчёт по кассовой смене</h3>
        <p className="mt-1 text-xs tabular-nums text-ink-3">
          {formatDateTime(report.windowStart, timeZone)} —{' '}
          {closed && s.closedAt ? formatDateTime(s.closedAt, timeZone) : 'смена открыта'}
        </p>
        <div className="mt-2 flex justify-center">
          <StatusPill tone={closed ? 'neutral' : 'ok'} live={!closed}>
            {closed ? 'Закрыта' : 'Открыта'}
          </StatusPill>
        </div>
      </div>

      <div className="space-y-1.5 rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
        {/* Автосервис смены (161): у мульти-точечного тенанта Z-отчёт без
            подписи неотличим от отчёта соседнего филиала. */}
        {s.pointId && (
          <div className="flex items-center justify-between gap-2">
            <span>Автосервис</span>
            <PointBadge pointId={s.pointId} />
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span>Открыл</span>
          <span className="font-medium text-ink">
            {s.openedByName || '—'} · {formatDateTime(s.openedAt, timeZone)}
          </span>
        </div>
        {closed && (
          <div className="flex justify-between gap-2">
            <span>Закрыл</span>
            <span className="font-medium text-ink">
              {s.closedByName || '—'}
              {s.closedAt ? ` · ${formatDateTime(s.closedAt, timeZone)}` : ''}
            </span>
          </div>
        )}
      </div>

      <div>
        <ReportRow label="Разменная касса (открытие)" value={formatMoney(report.openingAmount)} />
        <ReportRow label="Выручка наличными" value={formatMoney(report.cashSales)} tone="ok" />
        <ReportRow label="Выручка картой" value={formatMoney(report.cardSales)} tone="accent" />
        <ReportRow label="Общая выручка" value={formatMoney(report.totalRevenue)} />
        <ReportRow label="Расходы из кассы" value={`− ${formatMoney(report.cashExpenses)}`} tone="bad" />
        <ReportRow label="Инкассация" value={`− ${formatMoney(report.collectionsTotal)}`} tone="warn" />
        <ReportRow label="Чеков за смену" value={String(report.checksCount)} />
        <ReportRow label="Расчётный остаток в кассе" value={formatMoney(report.expectedAmount)} strong />
        <ReportRow
          label="Фактический нал при закрытии"
          value={report.factualAmount == null ? '—' : formatMoney(report.factualAmount)}
          strong
        />
        {/* 155 — распределение нала при закрытии: сейф / размен на завтра */}
        {s.toSafeAmount != null && (
          <ReportRow label="Переведено в сейф" value={formatMoney(s.toSafeAmount)} tone="warn" />
        )}
        {s.carryoverAmount != null && <ReportRow label="Осталось на размен" value={formatMoney(s.carryoverAmount)} />}
      </div>

      {diff && (
        <div className="flex items-center justify-between rounded-lg border border-line p-3">
          <span className="text-sm font-semibold text-ink">Расхождение</span>
          <span
            className={cn('flex items-center gap-1.5 text-base font-semibold tabular-nums', toneTextCls[diff.tone])}
          >
            <diff.Icon className="h-4 w-4" aria-hidden="true" />
            {diff.label}
          </span>
        </div>
      )}

      {/* 155 — разбивка выручки по принявшим оплату (checks.accepted_by) */}
      {(report.perAcceptor?.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Users className="h-3.5 w-3.5 text-ink-4" aria-hidden="true" /> По сотрудникам
          </p>
          <div>
            {report.perAcceptor!.map((a) => (
              <div
                key={a.userId ?? '__none__'}
                className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-xs text-ink-2 last:border-0"
              >
                <span className="min-w-0 truncate">
                  {a.name || 'Не распределено'} · {a.checksCount} чек.
                </span>
                <span className="flex-shrink-0 tabular-nums">
                  <span className="font-medium text-ok-text">нал {formatMoney(a.cashSales)}</span>
                  <span className="mx-1 text-ink-3">·</span>
                  <span className="font-medium text-accent-text">карта {formatMoney(a.cardSales)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 155 — фактическая сдача по сотрудникам при закрытии */}
      {(report.settlements?.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Сдано</p>
          <div>
            {report.settlements!.map((st) => {
              const d = st.actualAmount - st.expectedAmount;
              return (
                <div
                  key={st.userId ?? '__none__'}
                  className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-xs text-ink-2 last:border-0"
                >
                  <span className="min-w-0 truncate">
                    {st.name || 'Не распределено'} · расчётно {formatMoney(st.expectedAmount)}
                  </span>
                  <span className="flex-shrink-0 tabular-nums">
                    <span className="font-medium text-ink">{formatMoney(st.actualAmount)}</span>
                    {d !== 0 && (
                      <span className={cn('ml-1.5 font-medium', d > 0 ? 'text-ok-text' : 'text-bad-text')}>
                        ({d > 0 ? '+' : '−'}
                        {formatMoney(Math.abs(d))})
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {report.collections.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Инкассации</p>
          <div>
            {report.collections.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-xs text-ink-2 last:border-0"
              >
                <span className="min-w-0 truncate">
                  {formatDateTime(c.collectedAt, timeZone)}
                  {c.collectedByName ? ` · ${c.collectedByName}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </span>
                <span className="flex-shrink-0 font-medium tabular-nums text-warn-text">{formatMoney(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.note && <p className="text-xs text-ink-3">Примечание: {s.note}</p>}
    </div>
  );
}

/** Денежное поле модалок: текст + inputMode decimal (не type=number — колесо мыши не меняет сумму). */
function AmountInput({
  id,
  value,
  onChange,
  autoFocus,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0"
      aria-label={ariaLabel}
      className={cn('text-right tabular-nums', className)}
      rightSlot={<span className="text-xs font-medium text-ink-3">₽</span>}
    />
  );
}

export default function CashShiftPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // Время открытия/закрытия смен — в поясе автосервиса (см. ZReportDocument).
  const timeZone = useTenantTimezone();
  // Автосервис ТЕКУЩЕЙ СЕССИИ (163): касса, её Z-отчёт и её недостача — деньги
  // одного конкретного автосервиса, и закрывать смену вправе только тот, кто
  // в этом автосервисе и работает.
  const { currentPointId, multiPoint } = usePointAccess();
  // Открытие/закрытие/инкассация кассовой смены — ключ cash_shifts_manage
  // (backend POST /cash-shifts/*, волна Битрикс24). Просмотр статуса — всем.
  const canManage = hasPermission('cash_shifts_manage');

  // Страница истории — в URL (?page=), чтобы F5 возвращал на то же место.
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    if (p <= 1) next.delete('page');
    else next.set('page', String(p));
    setParams(next, { replace: true });
  };
  const [reportShiftId, setReportShiftId] = useState<string | null>(null);

  // Modal state
  const [openModal, setOpenModal] = useState(false);
  const [collectModal, setCollectModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [safeCollectModal, setSafeCollectModal] = useState(false);
  const [openingInput, setOpeningInput] = useState('');
  const [collectInput, setCollectInput] = useState('');
  const [closingInput, setClosingInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  // 155 — закрытие смены: перевод в сейф + сдача по сотрудникам
  const [toSafeInput, setToSafeInput] = useState('');
  const [settleInputs, setSettleInputs] = useState<Record<string, string>>({});
  const [safeCollectInput, setSafeCollectInput] = useState('');

  // ─── Queries ───────────────────────────────────────────────────────────────
  const {
    data: currentReport,
    isLoading: currentLoading,
    isError: currentError,
    isFetching: currentFetching,
    refetch: refetchCurrent,
  } = useQuery({
    queryKey: ['cash-shift', 'current'],
    queryFn: () => cashShiftsApi.current().then((r) => r.data),
  });

  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
    isFetching: historyFetching,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['cash-shift', 'list', page],
    queryFn: () => cashShiftsApi.list({ page, limit: HISTORY_LIMIT }).then((r) => r.data),
  });

  const {
    data: selectedReport,
    isLoading: reportLoading,
    isError: reportError,
    isFetching: reportFetching,
    refetch: refetchReport,
  } = useQuery({
    queryKey: ['cash-shift', 'report', reportShiftId],
    queryFn: () => cashShiftsApi.report(reportShiftId as string).then((r) => r.data),
    enabled: !!reportShiftId,
  });

  // 155 — СЕЙФ (отдельный кошелёк тенанта): баланс + история операций.
  // Чтение гейтится сервером (cash_shifts_manage / owner-class); на старом
  // бэкенде эндпоинта нет — секция просто не рендерится (data отсутствует).
  const {
    data: safeState,
    isError: safeError,
    refetch: refetchSafe,
    isFetching: safeFetching,
  } = useQuery({
    queryKey: ['cash-shift', 'safe'],
    queryFn: () => cashShiftsApi.safe().then((r) => r.data),
    enabled: canManage,
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['cash-shift'] });

  // ─── Mutations ───────────────────────────────────────────────────────────────
  const openMutation = useMutation({
    mutationFn: (data: { openingAmount: number; note?: string }) => cashShiftsApi.open(data),
    onSuccess: () => {
      toast.success('Смена открыта');
      setOpenModal(false);
      setOpeningInput('');
      setNoteInput('');
      refresh();
    },
    // Текст сервера показываем дословно: у отказа бывают разные причины (смена
    // уже открыта, нет права), и глухое «Не удалось открыть смену» их бы съело.
    onError: (err: any) => toast.error(apiErrorMessage(err) ?? 'Не удалось открыть смену', { duration: 8000 }),
  });

  const collectMutation = useMutation({
    mutationFn: ({ id, amount, note }: { id: string; amount: number; note?: string }) =>
      cashShiftsApi.collect(id, { amount, note }),
    onSuccess: () => {
      toast.success('Инкассация записана');
      setCollectModal(false);
      setCollectInput('');
      setNoteInput('');
      refresh();
    },
    onError: (err: any) => toast.error(apiErrorMessage(err) ?? 'Не удалось записать инкассацию'),
  });

  const closeMutation = useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      closingAmount: number;
      note?: string;
      toSafeAmount?: number;
      settlements?: Array<{ userId: string | null; actualAmount: number }>;
    }) => cashShiftsApi.close(id, data),
    onSuccess: (res) => {
      const rep = res.data;
      const diff = rep.difference ?? 0;
      const m = diffMeta(diff);
      toast.success(`Смена закрыта · ${m.label}`);
      setCloseModal(false);
      setClosingInput('');
      setNoteInput('');
      setToSafeInput('');
      setSettleInputs({});
      refresh();
      // Surface the freshly-closed Z-report (with computed difference) instantly.
      setReportShiftId(rep.shift.id);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Не удалось закрыть смену');
    },
  });

  // 155 — инкассация владельцем ИЗ СЕЙФА (без открытой смены).
  const safeCollectMutation = useMutation({
    mutationFn: (data: { amount: number; note?: string }) => cashShiftsApi.safeCollect(data),
    onSuccess: () => {
      toast.success('Инкассация из сейфа записана');
      setSafeCollectModal(false);
      setSafeCollectInput('');
      setNoteInput('');
      refresh();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Не удалось выполнить инкассацию из сейфа');
    },
  });

  const shift = currentReport?.shift;
  const hasOpenShift = !!shift && shift.status === 'open';
  /**
   * МОЖНО ЛИ ТРОГАТЬ ЭТУ СМЕНУ — доказательство, а не предположение.
   *
   * Кассовая смена принадлежит КОНКРЕТНОМУ автосервису (161). Сервер режет
   * смены филиалом сессии, НО фильтр отключается, когда у сессии филиала нет
   * (`pointId` в токене пуст). Тогда `current()` отдаёт ЛЮБУЮ открытую смену
   * тенанта — в том числе соседнего автосервиса. Поэтому у мульти-точечного
   * тенанта действия разрешены только при ДОКАЗАННОМ совпадении.
   */
  const foreignShiftReason: string | null = (() => {
    if (!shift || !multiPoint) return null;
    if (!currentPointId) {
      return 'Эта сессия не привязана к автосервису, поэтому нельзя проверить, чья это смена. Выйдите и войдите заново — тогда действия со сменой станут доступны.';
    }
    if (shift.pointId !== currentPointId) {
      return 'Эта смена открыта в другом автосервисе. Закрыть её и провести инкассацию можно только из него — выйдите и войдите в этот автосервис.';
    }
    return null;
  })();

  // Close-modal live preview of difference
  const closingPreview = (() => {
    if (!currentReport) return null;
    const n = parseAmount(closingInput);
    if (Number.isNaN(n) || closingInput.trim() === '') return null;
    return diffMeta(n - currentReport.expectedAmount);
  })();

  // 155 — баланс сейфа: живой SafeState, fallback — safeBalance из Z-отчёта
  // (старый бэкенд не шлёт ни того, ни другого — карточка скрыта).
  const safeBalance = safeState?.balance ?? currentReport?.safeBalance;

  // 155 — превью «Останется на размен» в диалоге закрытия: факт − в сейф.
  const carryoverPreview = (() => {
    const closing = parseAmount(closingInput);
    if (Number.isNaN(closing) || closingInput.trim() === '') return null;
    const toSafe = toSafeInput.trim() === '' ? 0 : parseAmount(toSafeInput);
    if (Number.isNaN(toSafe)) return null;
    return closing - toSafe;
  })();

  // 155 — сдача по сотрудникам: Σ введённых сумм (пустые поля = 0).
  const perAcceptor = currentReport?.perAcceptor ?? [];
  const settlementsFilled = perAcceptor.some((a) => (settleInputs[a.userId ?? '__none__'] ?? '').trim() !== '');
  const settlementsSum = perAcceptor.reduce((sum, a) => {
    const raw = (settleInputs[a.userId ?? '__none__'] ?? '').trim();
    if (raw === '') return sum;
    const n = parseAmount(raw);
    return Number.isNaN(n) ? sum : sum + n;
  }, 0);

  const handleCloseSubmit = () => {
    if (!shift) return;
    const amount = parseAmount(closingInput);
    if (Number.isNaN(amount) || amount < 0) {
      toast.error('Введите корректную сумму');
      return;
    }
    let toSafeAmount: number | undefined;
    if (toSafeInput.trim() !== '') {
      const t = parseAmount(toSafeInput);
      if (Number.isNaN(t) || t < 0) {
        toast.error('Введите корректную сумму перевода в сейф');
        return;
      }
      if (t > amount) {
        toast.error('В сейф нельзя перевести больше фактического нала');
        return;
      }
      toSafeAmount = t;
    }
    let settlements: Array<{ userId: string | null; actualAmount: number }> | undefined;
    if (settlementsFilled) {
      for (const a of perAcceptor) {
        const raw = (settleInputs[a.userId ?? '__none__'] ?? '').trim();
        if (raw !== '' && (Number.isNaN(parseAmount(raw)) || parseAmount(raw) < 0)) {
          toast.error(`Некорректная сумма сдачи: ${a.name || 'Не распределено'}`);
          return;
        }
      }
      if (Math.abs(settlementsSum - amount) > 0.009) {
        toast.error('Сумма сдач по сотрудникам должна равняться фактическому налу');
        return;
      }
      settlements = perAcceptor.map((a) => {
        const raw = (settleInputs[a.userId ?? '__none__'] ?? '').trim();
        return { userId: a.userId, actualAmount: raw === '' ? 0 : parseAmount(raw) };
      });
    }
    closeMutation.mutate({
      id: shift.id,
      closingAmount: amount,
      note: noteInput.trim() || undefined,
      toSafeAmount,
      settlements,
    });
  };

  const openOpenModal = () => {
    setOpeningInput('');
    setNoteInput('');
    setOpenModal(true);
  };
  const openCollectModal = () => {
    setCollectInput('');
    setNoteInput('');
    setCollectModal(true);
  };
  const openCloseModal = () => {
    setClosingInput('');
    setNoteInput('');
    setToSafeInput('');
    setSettleInputs({});
    setCloseModal(true);
  };

  const canActOnShift = hasOpenShift && canManage && !foreignShiftReason;

  // ─── История: колонки ──────────────────────────────────────────────────────
  const historyColumns = useMemo<DataTableColumn<CashShift>[]>(
    () => [
      {
        key: 'period',
        header: 'Смена',
        primary: true,
        render: (s) => {
          const closed = s.status === 'closed';
          return (
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md',
                  closed ? 'bg-surface-3 text-ink-3' : 'bg-ok-soft text-ok',
                )}
              >
                {closed ? (
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </span>
              <span className="tabular-nums">
                {formatDateTime(s.openedAt, timeZone)}
                {closed && s.closedAt ? ` — ${formatDateTime(s.closedAt, timeZone)}` : ''}
              </span>
            </span>
          );
        },
      },
      {
        key: 'point',
        header: 'Автосервис',
        hideBelow: 'lg',
        // Автосервис строки (161): в истории мульти-точечного тенанта
        // соседствуют смены разных автосервисов. PointBadge сам молчит у
        // одноточечного тенанта.
        render: (s) => <PointBadge pointId={s.pointId} />,
      },
      { key: 'openedBy', header: 'Открыл', hideBelow: 'md', render: (s) => s.openedByName || '—' },
      {
        key: 'opening',
        header: 'Разменная',
        numeric: true,
        hideBelow: 'sm',
        render: (s) => <Money value={s.openingAmount} />,
      },
      {
        key: 'diff',
        header: 'Расхождение',
        numeric: true,
        render: (s) => {
          if (s.status !== 'closed')
            return (
              <StatusPill tone="ok" live>
                Открыта
              </StatusPill>
            );
          if (s.difference == null) return <span className="text-ink-3">—</span>;
          return <Money value={s.difference} signed colorize className="font-semibold" />;
        },
      },
    ],
    [timeZone],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Кассовая смена"
        icon={Wallet}
        subtitle={
          currentLoading
            ? 'Z-отчёт, инкассация и сейф'
            : hasOpenShift && shift
              ? `Открыта ${formatDateTime(shift.openedAt, timeZone)}${shift.openedByName ? ` · ${shift.openedByName}` : ''}`
              : 'Открытой смены нет'
        }
        // Один primary на экран: пока смены нет, «Открыть смену» живёт в карточке
        // состояния ниже; действия открытой смены — здесь.
        actions={
          !currentLoading && !currentError && canActOnShift ? (
            <>
              <Button variant="secondary" icon={ArrowDownToLine} onClick={openCollectModal}>
                Инкассация
              </Button>
              <Button icon={Lock} onClick={openCloseModal}>
                Закрыть смену
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Current shift — a fetch FAILURE must show error+retry, never fall
          through to «Открытая смена отсутствует» (which invites opening a
          second shift while one may already be open on the server). */}
      <QueryState
        isLoading={currentLoading}
        isError={currentError}
        onRetry={refetchCurrent}
        isFetching={currentFetching}
        loader={
          <div
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
            aria-busy="true"
            aria-label="Загрузка смены"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        }
        errorTitle="Не удалось загрузить смену"
      >
        {hasOpenShift && currentReport ? (
          <Card padding="none">
            <CardHeader
              icon={Unlock}
              iconTone="ok"
              title={
                <span className="flex flex-wrap items-center gap-2">
                  Смена открыта
                  <PointBadge pointId={shift?.pointId} />
                </span>
              }
              subtitle={
                shift
                  ? `${shift.openedByName ? `${shift.openedByName} · ` : ''}${formatDateTime(shift.openedAt, timeZone)}`
                  : undefined
              }
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Receipt}
                  onClick={() => setReportShiftId(currentReport.shift.id)}
                >
                  Z-отчёт
                </Button>
              }
            />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <StatCard
                  compact
                  icon={Banknote}
                  label="Наличными"
                  value={formatMoney(currentReport.cashSales)}
                  tone="ok"
                />
                <StatCard compact icon={CreditCard} label="Картой" value={formatMoney(currentReport.cardSales)} />
                <StatCard
                  compact
                  icon={ArrowDownToLine}
                  label="Инкассация"
                  value={formatMoney(currentReport.collectionsTotal)}
                />
                <StatCard
                  compact
                  icon={Wallet}
                  label="Расходы из кассы"
                  value={formatMoney(currentReport.cashExpenses)}
                />
                <StatCard compact icon={Receipt} label="Чеков" value={String(currentReport.checksCount)} />
                <StatCard compact icon={Unlock} label="Разменная" value={formatMoney(currentReport.openingAmount)} />
                <StatCard
                  compact
                  icon={TrendingUp}
                  label="Общая выручка"
                  value={formatMoney(currentReport.totalRevenue)}
                />
                <StatCard
                  compact
                  icon={Scale}
                  label="Расчётный остаток"
                  value={formatMoney(currentReport.expectedAmount)}
                  tone="accent"
                />
              </div>

              {foreignShiftReason ? (
                <p
                  role="status"
                  className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn-text"
                >
                  {foreignShiftReason}
                </p>
              ) : (
                !canManage && (
                  <p className="text-xs text-ink-3">Открытие и закрытие смены доступно директору и администратору.</p>
                )
              )}
            </CardBody>
          </Card>
        ) : (
          <Card padding="md" className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-3">
              <Lock className="h-5 w-5 text-ink-4" aria-hidden="true" />
            </div>
            <p className="mt-3 text-md font-semibold text-ink">Открытой смены нет</p>
            <p className="mt-1 text-sm text-ink-3">
              {canManage
                ? 'Откройте смену, чтобы вести Z-отчёт и инкассацию.'
                : 'Открытие смены доступно директору и администратору.'}
            </p>
            {canManage && (
              <Button icon={Unlock} onClick={openOpenModal} className="mt-4">
                Открыть смену
              </Button>
            )}
          </Card>
        )}
      </QueryState>

      {/* 155 — СЕЙФ: отдельный кошелёк тенанта. Карточка появляется, когда
          бэкенд отдаёт баланс; при ошибке запроса — честная строка. */}
      {canManage && safeError && safeBalance == null ? (
        <p
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-bad/20 bg-bad-soft px-3.5 py-3 text-sm text-bad-text"
        >
          Не удалось загрузить сейф
          <Button variant="secondary" size="sm" onClick={() => refetchSafe()} loading={safeFetching}>
            Повторить
          </Button>
        </p>
      ) : safeBalance != null ? (
        <Card padding="none">
          <CardHeader
            icon={Landmark}
            iconTone="warn"
            title="Сейф"
            subtitle="Наличные вне кассового ящика"
            actions={
              <>
                <Money value={safeBalance} className="text-lg font-semibold text-ink" />
                {canManage && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={ArrowDownToLine}
                    onClick={() => {
                      setSafeCollectInput('');
                      setNoteInput('');
                      setSafeCollectModal(true);
                    }}
                    disabled={safeBalance <= 0}
                  >
                    Инкассация из сейфа
                  </Button>
                )}
              </>
            }
          />
          {(safeState?.transactions?.length ?? 0) > 0 && (
            <ul className="divide-y divide-line">
              {safeState!.transactions.slice(0, 10).map((t: SafeTransaction) => {
                const isOut = t.type === 'collection' || (t.type === 'adjustment' && t.amount < 0);
                const label =
                  t.type === 'deposit'
                    ? 'Из кассы (закрытие смены)'
                    : t.type === 'collection'
                      ? 'Инкассация'
                      : 'Корректировка';
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{label}</p>
                      <p className="truncate text-xs tabular-nums text-ink-3">
                        {formatDateTime(t.createdAt, timeZone)}
                        {t.actorName ? ` · ${t.actorName}` : ''}
                        {t.note ? ` · ${t.note}` : ''}
                      </p>
                    </div>
                    <Money
                      value={isOut ? -Math.abs(t.amount) : Math.abs(t.amount)}
                      signed
                      colorize
                      className="text-sm font-semibold"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      {/* История смен */}
      <Card padding="none">
        <CardHeader
          icon={History}
          iconTone="neutral"
          title="История смен"
          subtitle="Нажмите на смену, чтобы открыть её Z-отчёт"
          divider={false}
        />
        <DataTable
          bare
          caption="История кассовых смен"
          columns={historyColumns}
          rows={history?.data ?? []}
          rowKey={(s) => s.id}
          onRowClick={(s) => setReportShiftId(s.id)}
          rowLabel={(s) => `Z-отчёт за ${formatDateTime(s.openedAt, timeZone)}`}
          isLoading={historyLoading}
          isError={historyError}
          onRetry={() => refetchHistory()}
          isFetching={historyFetching}
          emptyState={{ icon: Wallet, title: 'Смен пока не было', description: 'Закрытые смены появятся здесь' }}
        />
        {(history?.total ?? 0) > HISTORY_LIMIT && (
          <div className="border-t border-line px-5">
            <Pagination
              page={page}
              total={history?.total ?? 0}
              limit={history?.limit ?? HISTORY_LIMIT}
              onChange={setPage}
            />
          </div>
        )}
      </Card>

      {/* ─── Open shift modal ─── */}
      <Modal
        isOpen={openModal}
        onClose={() => setOpenModal(false)}
        title="Открыть смену"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenModal(false)} disabled={openMutation.isPending}>
              Отмена
            </Button>
            <Button
              icon={Unlock}
              loading={openMutation.isPending}
              onClick={() => {
                const amount = parseAmount(openingInput);
                if (Number.isNaN(amount) || amount < 0) {
                  toast.error('Введите корректную сумму');
                  return;
                }
                openMutation.mutate({ openingAmount: amount, note: noteInput.trim() || undefined });
              }}
            >
              Открыть смену
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="Разменная касса"
            htmlFor="open-amount"
            hint="Наличные, которые уже лежат в кассе на момент открытия."
          >
            <AmountInput id="open-amount" value={openingInput} onChange={setOpeningInput} autoFocus />
          </Field>
          <Field label="Примечание" htmlFor="open-note" hint="Необязательно">
            <Input id="open-note" value={noteInput} onChange={(e) => setNoteInput(e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* ─── Collect modal ─── */}
      <Modal
        isOpen={collectModal}
        onClose={() => setCollectModal(false)}
        title="Инкассация"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCollectModal(false)} disabled={collectMutation.isPending}>
              Отмена
            </Button>
            <Button
              icon={ArrowDownToLine}
              loading={collectMutation.isPending}
              onClick={() => {
                if (!shift) return;
                const amount = parseAmount(collectInput);
                if (Number.isNaN(amount) || amount <= 0) {
                  toast.error('Введите корректную сумму');
                  return;
                }
                collectMutation.mutate({ id: shift.id, amount, note: noteInput.trim() || undefined });
              }}
            >
              Записать инкассацию
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {currentReport && (
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="text-ink-3">Расчётный остаток в кассе</span>
              <Money value={currentReport.expectedAmount} className="font-semibold text-ink" />
            </div>
          )}
          <Field label="Сумма инкассации" htmlFor="collect-amount">
            <AmountInput id="collect-amount" value={collectInput} onChange={setCollectInput} autoFocus />
          </Field>
          <Field label="Примечание" htmlFor="collect-note" hint="Необязательно">
            <Input id="collect-note" value={noteInput} onChange={(e) => setNoteInput(e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* ─── Close modal ─── */}
      <Modal
        isOpen={closeModal}
        onClose={() => setCloseModal(false)}
        title="Закрыть смену"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseModal(false)} disabled={closeMutation.isPending}>
              Отмена
            </Button>
            <Button icon={Lock} loading={closeMutation.isPending} onClick={handleCloseSubmit}>
              Закрыть смену
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {currentReport && (
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="text-ink-3">Расчётный остаток в кассе</span>
              <Money value={currentReport.expectedAmount} className="font-semibold text-ink" />
            </div>
          )}
          <Field
            label="Фактический нал в кассе"
            htmlFor="close-amount"
            hint="Пересчитайте наличные в кассе и введите фактическую сумму."
          >
            <AmountInput id="close-amount" value={closingInput} onChange={setClosingInput} autoFocus />
          </Field>
          {closingPreview && (
            <div className="flex items-center justify-between rounded-lg border border-line p-3" role="status">
              <span className="text-sm font-medium text-ink-2">Расхождение</span>
              <span
                className={cn(
                  'flex items-center gap-1.5 text-sm font-semibold tabular-nums',
                  toneTextCls[closingPreview.tone],
                )}
              >
                <closingPreview.Icon className="h-4 w-4" aria-hidden="true" />
                {closingPreview.label}
              </span>
            </div>
          )}

          {/* 155 — сдача по сотрудникам: каждый принимавший сдаёт свой нал */}
          {perAcceptor.length > 0 && (
            <fieldset className="min-w-0 border-0 p-0">
              <legend className="mb-2 text-sm font-medium text-ink-2">Сдача по сотрудникам</legend>
              <div className="space-y-2">
                {perAcceptor.map((a) => {
                  const key = a.userId ?? '__none__';
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{a.name || 'Не распределено'}</p>
                        <p className="text-xs tabular-nums text-ink-3">Расчётно наличными {formatMoney(a.cashSales)}</p>
                      </div>
                      <AmountInput
                        value={settleInputs[key] ?? ''}
                        onChange={(v) => setSettleInputs((prev) => ({ ...prev, [key]: v }))}
                        ariaLabel={`Сдача: ${a.name || 'Не распределено'}`}
                        className="w-32"
                      />
                    </div>
                  );
                })}
              </div>
              {settlementsFilled && (
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-ink-3">Итого сдано</span>
                  <Money value={settlementsSum} className="font-semibold text-ink" />
                </div>
              )}
              <p className="mt-1.5 text-xs text-ink-3">
                Сумма сдач должна совпасть с фактическим налом. Оставьте поля пустыми, чтобы закрыть одной общей суммой.
              </p>
            </fieldset>
          )}

          {/* 155 — перевод части нала в сейф; остаток — размен на завтра */}
          <Field
            label="Перевести в сейф"
            htmlFor="close-safe"
            hint={
              carryoverPreview != null
                ? `Останется на размен: ${formatMoney(carryoverPreview)}`
                : 'Остаток станет разменной кассой следующей смены'
            }
            error={
              carryoverPreview != null && carryoverPreview < 0
                ? 'В сейф нельзя перевести больше фактического нала'
                : undefined
            }
          >
            <AmountInput id="close-safe" value={toSafeInput} onChange={setToSafeInput} />
          </Field>

          <Field label="Примечание" htmlFor="close-note" hint="Необязательно">
            <Input id="close-note" value={noteInput} onChange={(e) => setNoteInput(e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* ─── Safe collect modal (155 — инкассация из сейфа) ─── */}
      <Modal
        isOpen={safeCollectModal}
        onClose={() => setSafeCollectModal(false)}
        title="Инкассация из сейфа"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setSafeCollectModal(false)}
              disabled={safeCollectMutation.isPending}
            >
              Отмена
            </Button>
            <Button
              icon={ArrowDownToLine}
              loading={safeCollectMutation.isPending}
              onClick={() => {
                const amount = parseAmount(safeCollectInput);
                if (Number.isNaN(amount) || amount <= 0) {
                  toast.error('Введите корректную сумму');
                  return;
                }
                if (safeBalance != null && amount > safeBalance) {
                  toast.error('Сумма больше баланса сейфа');
                  return;
                }
                safeCollectMutation.mutate({ amount, note: noteInput.trim() || undefined });
              }}
            >
              Записать инкассацию
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {safeBalance != null && (
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="text-ink-3">Баланс сейфа</span>
              <Money value={safeBalance} className="font-semibold text-ink" />
            </div>
          )}
          <Field label="Сумма инкассации" htmlFor="safe-amount" hint="Не больше текущего баланса сейфа.">
            <AmountInput id="safe-amount" value={safeCollectInput} onChange={setSafeCollectInput} autoFocus />
          </Field>
          <Field label="Примечание" htmlFor="safe-note" hint="Необязательно">
            <Input id="safe-note" value={noteInput} onChange={(e) => setNoteInput(e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* ─── Z-report modal ─── */}
      <Modal
        isOpen={!!reportShiftId}
        onClose={() => setReportShiftId(null)}
        title="Z-отчёт"
        size="lg"
        footer={
          selectedReport ? (
            <Button variant="secondary" icon={Printer} onClick={() => window.print()} className="print:hidden">
              Печать
            </Button>
          ) : undefined
        }
      >
        <QueryState
          isLoading={reportLoading || (!!reportShiftId && !selectedReport && !reportError)}
          isError={reportError}
          onRetry={refetchReport}
          isFetching={reportFetching}
          minHeight="min-h-[30vh]"
          errorTitle="Не удалось загрузить Z-отчёт"
        >
          {selectedReport && (
            <div id="z-report-print">
              <ZReportDocument report={selectedReport} />
            </div>
          )}
        </QueryState>
      </Modal>
    </div>
  );
}
