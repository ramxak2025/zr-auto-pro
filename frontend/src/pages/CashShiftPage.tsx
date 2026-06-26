import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wallet,
  Banknote,
  CreditCard,
  Receipt,
  ArrowDownToLine,
  Lock,
  Unlock,
  Printer,
  Scale,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { cashShiftsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import type { CashShift, CashShiftReport } from '../../../shared/types';
import { formatMoney, formatDateTime } from '../../../shared/utils/formatters';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';

const HISTORY_LIMIT = 20;

function parseAmount(value: string): number {
  const n = Number(value.replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
}

function diffMeta(diff: number) {
  if (diff > 0) return { label: `Излишек ${formatMoney(diff)}`, color: 'text-green-600', Icon: TrendingUp };
  if (diff < 0) return { label: `Недостача ${formatMoney(Math.abs(diff))}`, color: 'text-red-600', Icon: TrendingDown };
  return { label: 'Касса сходится', color: 'text-gray-700', Icon: Scale };
}

/** Printable-friendly full Z-report document. Reused for history + post-close. */
function ZReportDocument({ report }: { report: CashShiftReport }) {
  const s = report.shift;
  const closed = s.status === 'closed';
  const Row = ({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className={`text-sm ${strong ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${strong ? 'font-bold' : 'font-medium'} ${color || 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  );

  return (
    <div className="space-y-5 print:text-black">
      {/* Header */}
      <div className="text-center pb-2">
        <h3 className="text-lg font-bold text-gray-900">Z-отчёт по кассовой смене</h3>
        <p className="text-xs text-gray-500 mt-1">
          {formatDateTime(report.windowStart)} — {closed && s.closedAt ? formatDateTime(s.closedAt) : 'смена открыта'}
        </p>
        <span
          className={`inline-flex items-center gap-1 mt-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            closed ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'
          }`}
        >
          {closed ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          {closed ? 'Закрыта' : 'Открыта'}
        </span>
      </div>

      {/* Meta */}
      <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
        <div className="flex justify-between">
          <span>Открыл</span>
          <span className="font-medium text-gray-800">
            {s.openedByName || '—'} · {formatDateTime(s.openedAt)}
          </span>
        </div>
        {closed && (
          <div className="flex justify-between">
            <span>Закрыл</span>
            <span className="font-medium text-gray-800">
              {s.closedByName || '—'}
              {s.closedAt ? ` · ${formatDateTime(s.closedAt)}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Reconciliation */}
      <div>
        <Row label="Разменная касса (открытие)" value={formatMoney(report.openingAmount)} />
        <Row label="Выручка наличными" value={formatMoney(report.cashSales)} color="text-green-600" />
        <Row label="Выручка картой" value={formatMoney(report.cardSales)} color="text-blue-600" />
        <Row label="Общая выручка" value={formatMoney(report.totalRevenue)} />
        <Row label="Расходы из кассы" value={`− ${formatMoney(report.cashExpenses)}`} color="text-rose-600" />
        <Row label="Инкассация" value={`− ${formatMoney(report.collectionsTotal)}`} color="text-amber-600" />
        <Row label="Чеков за смену" value={String(report.checksCount)} />
        <Row label="Расчётный остаток в кассе" value={formatMoney(report.expectedAmount)} strong />
        <Row
          label="Фактический нал при закрытии"
          value={report.factualAmount == null ? '—' : formatMoney(report.factualAmount)}
          strong
        />
      </div>

      {/* Difference */}
      {report.difference != null && (
        <div className="rounded-xl border border-gray-200 p-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Расхождение</span>
          {(() => {
            const m = diffMeta(report.difference);
            return (
              <span className={`flex items-center gap-1.5 text-base font-bold ${m.color}`}>
                <m.Icon className="h-4 w-4" />
                {m.label}
              </span>
            );
          })()}
        </div>
      )}

      {/* Collections breakdown */}
      {report.collections.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-2">Инкассации</p>
          <div className="space-y-1">
            {report.collections.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-xs text-gray-600 py-1 border-b border-gray-100 last:border-0"
              >
                <span>
                  {formatDateTime(c.collectedAt)}
                  {c.collectedByName ? ` · ${c.collectedByName}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </span>
                <span className="font-medium text-amber-600 tabular-nums">{formatMoney(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.note && <p className="text-xs text-gray-500 italic">Примечание: {s.note}</p>}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  valueColor,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  color: string;
  valueColor: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <div className="stat-label">{label}</div>
      </div>
      <div className={`stat-value ${valueColor}`}>{value}</div>
    </div>
  );
}

export default function CashShiftPage() {
  const { isRole } = useAuth();
  const queryClient = useQueryClient();
  const canManage = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [page, setPage] = useState(1);
  const [reportShiftId, setReportShiftId] = useState<string | null>(null);

  // Modal state
  const [openModal, setOpenModal] = useState(false);
  const [collectModal, setCollectModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [openingInput, setOpeningInput] = useState('');
  const [collectInput, setCollectInput] = useState('');
  const [closingInput, setClosingInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  // ─── Queries ───────────────────────────────────────────────────────────────
  const { data: currentReport, isLoading: currentLoading } = useQuery({
    queryKey: ['cash-shift', 'current'],
    queryFn: () => cashShiftsApi.current().then((r) => r.data),
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['cash-shift', 'list', page],
    queryFn: () => cashShiftsApi.list({ page, limit: HISTORY_LIMIT }).then((r) => r.data),
  });

  const { data: selectedReport, isLoading: reportLoading } = useQuery({
    queryKey: ['cash-shift', 'report', reportShiftId],
    queryFn: () => cashShiftsApi.report(reportShiftId as string).then((r) => r.data),
    enabled: !!reportShiftId,
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
    onError: () => toast.error('Не удалось открыть смену'),
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
    onError: () => toast.error('Не удалось записать инкассацию'),
  });

  const closeMutation = useMutation({
    mutationFn: ({ id, closingAmount, note }: { id: string; closingAmount: number; note?: string }) =>
      cashShiftsApi.close(id, { closingAmount, note }),
    onSuccess: (res) => {
      const rep = res.data;
      const diff = rep.difference ?? 0;
      const m = diffMeta(diff);
      toast.success(`Смена закрыта · ${m.label}`);
      setCloseModal(false);
      setClosingInput('');
      setNoteInput('');
      refresh();
      // Surface the freshly-closed Z-report (with computed difference) instantly.
      setReportShiftId(rep.shift.id);
    },
    onError: () => toast.error('Не удалось закрыть смену'),
  });

  const shift = currentReport?.shift;
  const hasOpenShift = !!shift && shift.status === 'open';

  // Close-modal live preview of difference
  const closingPreview = (() => {
    if (!currentReport) return null;
    const n = parseAmount(closingInput);
    if (Number.isNaN(n) || closingInput.trim() === '') return null;
    return diffMeta(n - currentReport.expectedAmount);
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-xl">
          <Wallet className="w-6 h-6 text-primary-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Кассовая смена</h1>
      </div>

      {/* Current shift */}
      {currentLoading ? (
        <LoadingSpinner />
      ) : hasOpenShift && currentReport ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                <Unlock className="h-3 w-3" /> Смена открыта
              </span>
              <span className="text-sm text-gray-500">
                {shift?.openedByName ? `${shift.openedByName} · ` : ''}
                {shift ? formatDateTime(shift.openedAt) : ''}
              </span>
            </div>
            <button onClick={() => setReportShiftId(currentReport.shift.id)} className="btn-ghost btn-sm">
              <Receipt className="w-4 h-4" /> Подробный Z-отчёт
            </button>
          </div>

          {/* Live Z-report cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Banknote}
              label="Нал. выручка"
              value={formatMoney(currentReport.cashSales)}
              color="text-green-500"
              valueColor="text-green-600"
            />
            <StatCard
              icon={CreditCard}
              label="Карта"
              value={formatMoney(currentReport.cardSales)}
              color="text-blue-500"
              valueColor="text-blue-600"
            />
            <StatCard
              icon={ArrowDownToLine}
              label="Инкассация"
              value={formatMoney(currentReport.collectionsTotal)}
              color="text-amber-500"
              valueColor="text-amber-600"
            />
            <StatCard
              icon={Wallet}
              label="Расходы"
              value={formatMoney(currentReport.cashExpenses)}
              color="text-rose-500"
              valueColor="text-rose-600"
            />
            <StatCard
              icon={Receipt}
              label="Чеков"
              value={String(currentReport.checksCount)}
              color="text-gray-500"
              valueColor="text-gray-900"
            />
            <StatCard
              icon={Unlock}
              label="Разменная"
              value={formatMoney(currentReport.openingAmount)}
              color="text-gray-500"
              valueColor="text-gray-900"
            />
            <StatCard
              icon={Scale}
              label="Расчётный остаток"
              value={formatMoney(currentReport.expectedAmount)}
              color="text-primary-500"
              valueColor="text-primary-700"
            />
            <StatCard
              icon={TrendingUp}
              label="Общая выручка"
              value={formatMoney(currentReport.totalRevenue)}
              color="text-indigo-500"
              valueColor="text-indigo-700"
            />
          </div>

          {/* Actions */}
          {canManage ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  setCollectInput('');
                  setNoteInput('');
                  setCollectModal(true);
                }}
                className="btn-secondary flex-1 justify-center"
              >
                <ArrowDownToLine className="w-4 h-4" /> Инкассация
              </button>
              <button
                onClick={() => {
                  setClosingInput('');
                  setNoteInput('');
                  setCloseModal(true);
                }}
                className="btn-primary flex-1 justify-center"
              >
                <Lock className="w-4 h-4" /> Закрыть смену
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Открытие и закрытие смены доступно директору и администратору.</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
            <Lock className="h-6 w-6 text-gray-400" />
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">Открытая смена отсутствует</p>
            <p className="text-sm text-gray-500 mt-1">Откройте смену, чтобы вести Z-отчёт и инкассацию.</p>
          </div>
          {canManage ? (
            <button
              onClick={() => {
                setOpeningInput('');
                setNoteInput('');
                setOpenModal(true);
              }}
              className="btn-primary mx-auto"
            >
              <Unlock className="w-4 h-4" /> Открыть смену
            </button>
          ) : (
            <p className="text-xs text-gray-400">Открытие смены доступно директору и администратору.</p>
          )}
        </div>
      )}

      {/* History */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">История смен</h2>
        {historyLoading ? (
          <LoadingSpinner />
        ) : !history || history.data.length === 0 ? (
          <EmptyState icon={Wallet} title="Нет смен" description="Закрытые смены появятся здесь" />
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
              {history.data.map((s: CashShift) => {
                const closed = s.status === 'closed';
                const diff = s.difference;
                return (
                  <button
                    key={s.id}
                    onClick={() => setReportShiftId(s.id)}
                    className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  >
                    <div
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${closed ? 'bg-gray-100' : 'bg-green-50'}`}
                    >
                      {closed ? (
                        <Lock className="h-5 w-5 text-gray-500" />
                      ) : (
                        <Unlock className="h-5 w-5 text-green-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {formatDateTime(s.openedAt)}
                        {closed && s.closedAt ? ` — ${formatDateTime(s.closedAt)}` : ''}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {s.openedByName || '—'} · Разменная {formatMoney(s.openingAmount)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {!closed ? (
                        <span className="badge badge-green">Открыта</span>
                      ) : diff == null ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <span className={`text-sm font-semibold tabular-nums ${diffMeta(diff).color}`}>
                          {diff > 0 ? '+' : diff < 0 ? '−' : ''}
                          {formatMoney(Math.abs(diff))}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <Pagination page={page} total={history.total} limit={history.limit} onChange={setPage} />
          </>
        )}
      </div>

      {/* ─── Open shift modal ─── */}
      <Modal isOpen={openModal} onClose={() => setOpenModal(false)} title="Открыть смену">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Разменная касса, ₽</label>
            <input
              type="number"
              inputMode="decimal"
              autoFocus
              value={openingInput}
              onChange={(e) => setOpeningInput(e.target.value)}
              placeholder="0"
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">Наличные, которые уже лежат в кассе на момент открытия.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Примечание (необязательно)</label>
            <input value={noteInput} onChange={(e) => setNoteInput(e.target.value)} className="input" />
          </div>
          <button
            onClick={() => {
              const amount = parseAmount(openingInput);
              if (Number.isNaN(amount) || amount < 0) {
                toast.error('Введите корректную сумму');
                return;
              }
              openMutation.mutate({ openingAmount: amount, note: noteInput.trim() || undefined });
            }}
            disabled={openMutation.isPending}
            className="btn-primary w-full justify-center"
          >
            <Unlock className="w-4 h-4" /> {openMutation.isPending ? 'Открываем…' : 'Открыть смену'}
          </button>
        </div>
      </Modal>

      {/* ─── Collect modal ─── */}
      <Modal isOpen={collectModal} onClose={() => setCollectModal(false)} title="Инкассация">
        <div className="space-y-4">
          {currentReport && (
            <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600 flex justify-between">
              <span>Расчётный остаток в кассе</span>
              <span className="font-semibold text-gray-900">{formatMoney(currentReport.expectedAmount)}</span>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Сумма инкассации, ₽</label>
            <input
              type="number"
              inputMode="decimal"
              autoFocus
              value={collectInput}
              onChange={(e) => setCollectInput(e.target.value)}
              placeholder="0"
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Примечание (необязательно)</label>
            <input value={noteInput} onChange={(e) => setNoteInput(e.target.value)} className="input" />
          </div>
          <button
            onClick={() => {
              if (!shift) return;
              const amount = parseAmount(collectInput);
              if (Number.isNaN(amount) || amount <= 0) {
                toast.error('Введите корректную сумму');
                return;
              }
              collectMutation.mutate({ id: shift.id, amount, note: noteInput.trim() || undefined });
            }}
            disabled={collectMutation.isPending}
            className="btn-primary w-full justify-center"
          >
            <ArrowDownToLine className="w-4 h-4" /> {collectMutation.isPending ? 'Записываем…' : 'Записать инкассацию'}
          </button>
        </div>
      </Modal>

      {/* ─── Close modal ─── */}
      <Modal isOpen={closeModal} onClose={() => setCloseModal(false)} title="Закрыть смену">
        <div className="space-y-4">
          {currentReport && (
            <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600 flex justify-between">
              <span>Расчётный остаток в кассе</span>
              <span className="font-semibold text-gray-900">{formatMoney(currentReport.expectedAmount)}</span>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Фактический нал в кассе, ₽</label>
            <input
              type="number"
              inputMode="decimal"
              autoFocus
              value={closingInput}
              onChange={(e) => setClosingInput(e.target.value)}
              placeholder="0"
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">Пересчитайте наличные в кассе и введите фактическую сумму.</p>
          </div>
          {closingPreview && (
            <div className="rounded-xl border border-gray-200 p-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Расхождение</span>
              <span className={`flex items-center gap-1.5 text-sm font-bold ${closingPreview.color}`}>
                <closingPreview.Icon className="h-4 w-4" />
                {closingPreview.label}
              </span>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Примечание (необязательно)</label>
            <input value={noteInput} onChange={(e) => setNoteInput(e.target.value)} className="input" />
          </div>
          <button
            onClick={() => {
              if (!shift) return;
              const amount = parseAmount(closingInput);
              if (Number.isNaN(amount) || amount < 0) {
                toast.error('Введите корректную сумму');
                return;
              }
              closeMutation.mutate({ id: shift.id, closingAmount: amount, note: noteInput.trim() || undefined });
            }}
            disabled={closeMutation.isPending}
            className="btn-primary w-full justify-center"
          >
            <Lock className="w-4 h-4" /> {closeMutation.isPending ? 'Закрываем…' : 'Закрыть смену'}
          </button>
        </div>
      </Modal>

      {/* ─── Z-report modal ─── */}
      <Modal isOpen={!!reportShiftId} onClose={() => setReportShiftId(null)} title="Z-отчёт" size="lg">
        {reportLoading || !selectedReport ? (
          <LoadingSpinner />
        ) : (
          <div className="space-y-4">
            <div id="z-report-print">
              <ZReportDocument report={selectedReport} />
            </div>
            <button onClick={() => window.print()} className="btn-secondary w-full justify-center print:hidden">
              <Printer className="w-4 h-4" /> Печать
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
