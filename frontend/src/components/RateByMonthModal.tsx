/**
 * RateByMonthModal — смена ставки мастера «за месяц» + история ставок
 * (Round 14, миграция 150).
 *
 *   • прошлый месяц — сервер пересчитает начисления ТОЛЬКО этого месяца
 *     новой ставкой (остальные месяцы не трогаются);
 *   • текущий — плюс обновится текущая ставка (новые чеки запекаются ею);
 *   • будущий — ставка зафиксируется и применится, когда месяц наступит.
 *
 * API: usersApi.setRate / usersApi.getRateHistory (гейт user_management).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Loader2, CalendarClock } from 'lucide-react';
import toast from 'react-hot-toast';

import { usersApi } from '../api/services';
import Modal from './Modal';
import type { UserRateHistoryEntry } from '../types';

function labelMonth(my: string): string {
  const [y, m] = my.split('-');
  return format(new Date(Number(y), Number(m) - 1, 1), 'LLLL yyyy', { locale: ru });
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  currentSalaryPercent: number;
  currentProductPercent: number;
}

export default function RateByMonthModal({
  isOpen,
  onClose,
  userId,
  userName,
  currentSalaryPercent,
  currentProductPercent,
}: Props) {
  const queryClient = useQueryClient();
  const currentKey = format(new Date(), 'yyyy-MM');

  const [month, setMonth] = useState(currentKey);
  const [svc, setSvc] = useState(String(currentSalaryPercent));
  const [prod, setProd] = useState(String(currentProductPercent));

  useEffect(() => {
    if (isOpen) {
      setMonth(currentKey);
      setSvc(String(currentSalaryPercent));
      setProd(String(currentProductPercent));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentSalaryPercent, currentProductPercent]);

  const { data: history } = useQuery({
    queryKey: ['user-rate-history', userId],
    queryFn: async () => (await usersApi.getRateHistory(userId)).data as UserRateHistoryEntry[],
    enabled: isOpen,
  });

  const mutation = useMutation({
    mutationFn: (data: { month: string; salaryPercent: number; productSalaryPercent: number }) =>
      usersApi.setRate(userId, data),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-rate-history', userId] });
      // Начисления месяца пересчитаны — зарплатные экраны и отчёты устарели.
      queryClient.invalidateQueries({ queryKey: ['salary-all'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
      toast.success(`Ставка за ${labelMonth(vars.month)} сохранена`);
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Не удалось сохранить ставку');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = parseFloat(svc.replace(',', '.'));
    const p = parseFloat(prod.replace(',', '.'));
    if (!/^\d{4}-\d{2}$/.test(month)) {
      toast.error('Выберите месяц');
      return;
    }
    if (!Number.isFinite(s) || s < 0 || s > 100 || !Number.isFinite(p) || p < 0 || p > 100) {
      toast.error('Проценты — числа от 0 до 100');
      return;
    }
    mutation.mutate({ month, salaryPercent: s, productSalaryPercent: p });
  };

  const isPast = month < currentKey;
  const isFuture = month > currentKey;
  const warning = isPast
    ? `Пересчитает начисления ТОЛЬКО за ${labelMonth(month)}. Остальные месяцы не изменятся.`
    : isFuture
      ? `Ставка применится, когда наступит ${labelMonth(month)}. До этого действует текущая.`
      : `Изменит текущую ставку и пересчитает начисления за ${labelMonth(month)}.`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Ставка по месяцам — ${userName}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Месяц</label>
          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">% от услуг</label>
            <input
              type="number"
              className="input"
              value={svc}
              onChange={(e) => setSvc(e.target.value)}
              min={0}
              max={100}
              step={1}
            />
          </div>
          <div>
            <label className="label">% от товаров</label>
            <input
              type="number"
              className="input"
              value={prod}
              onChange={(e) => setProd(e.target.value)}
              min={0}
              max={100}
              step={1}
            />
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
          <CalendarClock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">{warning}</p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Отмена
          </button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Сохранить ставку
          </button>
        </div>
      </form>

      {/* ── История ставок ─────────────────────────────────────────────── */}
      <div className="mt-6 border-t border-gray-200 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">История ставок</p>
        {(history ?? []).length === 0 ? (
          <p className="text-xs text-gray-400">
            Ставка ещё не менялась — действует текущая ({currentSalaryPercent}% / {currentProductPercent}%)
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {(history ?? []).map((h) => (
              <li key={h.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-gray-900 capitalize">{labelMonth(h.month)}</span>
                <span className="text-xs text-gray-500">
                  {h.salaryPercent ?? '—'}% услуги · {h.productSalaryPercent ?? '—'}% товары
                </span>
                {h.creatorName ? (
                  <span className="text-xs text-gray-400 truncate max-w-[10rem]">{h.creatorName}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
