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
import { CalendarClock } from 'lucide-react';
import toast from 'react-hot-toast';

import { usersApi } from '../api/services';
import Modal from './Modal';
import { ErrorRow } from './dashboard/shared';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { SkeletonText } from '../ui/Skeleton';
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
  /**
   * Round 15 п.1 — вход из «Зарплаты»: месяц зафиксирован выбранным периодом
   * ('YYYY-MM'), поле месяца скрыто. Без пропа — прежнее поведение
   * (вход из Пользователей, свободный выбор).
   */
  fixedMonth?: string;
}

export default function RateByMonthModal({
  isOpen,
  onClose,
  userId,
  userName,
  currentSalaryPercent,
  currentProductPercent,
  fixedMonth,
}: Props) {
  const queryClient = useQueryClient();
  const currentKey = format(new Date(), 'yyyy-MM');

  const [month, setMonth] = useState(fixedMonth ?? currentKey);
  const [svc, setSvc] = useState(String(currentSalaryPercent));
  const [prod, setProd] = useState(String(currentProductPercent));

  useEffect(() => {
    if (isOpen) {
      setMonth(fixedMonth ?? currentKey);
      setSvc(String(currentSalaryPercent));
      setProd(String(currentProductPercent));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentSalaryPercent, currentProductPercent, fixedMonth]);

  const historyQuery = useQuery({
    queryKey: ['user-rate-history', userId],
    queryFn: async () => (await usersApi.getRateHistory(userId)).data as UserRateHistoryEntry[],
    enabled: isOpen,
  });
  const history = historyQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: (data: { month: string; salaryPercent: number; productSalaryPercent: number }) =>
      usersApi.setRate(userId, data),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-rate-history', userId] });
      // Сервер перепёк salary_amount И checks.profit месяца — устарели не
      // только зарплатные экраны, но и ВСЕ денежные отчёты (Round 15 п.1).
      queryClient.invalidateQueries({ queryKey: ['salary-all'] });
      queryClient.invalidateQueries({ queryKey: ['salary-my'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      queryClient.invalidateQueries({ queryKey: ['tag-analytics'] });
      const future = vars.month > currentKey;
      toast.success(
        future
          ? `Ставка за ${labelMonth(vars.month)} сохранена — применится, когда месяц наступит`
          : `Начисления и прибыль за ${labelMonth(vars.month)} пересчитаны`,
      );
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
  // Round 15 п.1 — предупреждение владельцу дословно про деньги.
  const warning = isPast
    ? `Пересчитает начисления И ПРИБЫЛЬ только за ${labelMonth(month)}. Другие месяцы не изменятся.`
    : isFuture
      ? `Ставка применится, когда наступит ${labelMonth(month)}. До этого действует текущая.`
      : `Изменит текущую ставку и пересчитает начисления и прибыль за ${labelMonth(month)}. Другие месяцы не изменятся.`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={fixedMonth ? `Процент за ${labelMonth(month)}` : 'Ставка по месяцам'}
      description={userName}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="rate-by-month-form" loading={mutation.isPending}>
            Сохранить ставку
          </Button>
        </>
      }
    >
      <form id="rate-by-month-form" onSubmit={handleSubmit} className="space-y-4">
        {fixedMonth ? null : (
          <Field label="Месяц" htmlFor="rate-month" required>
            <Input id="rate-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="% от услуг" htmlFor="rate-services">
            <Input
              id="rate-services"
              inputMode="decimal"
              value={svc}
              onChange={(e) => setSvc(e.target.value)}
              rightSlot={<span className="text-sm">%</span>}
            />
          </Field>
          <Field label="% от товаров" htmlFor="rate-products">
            <Input
              id="rate-products"
              inputMode="decimal"
              value={prod}
              onChange={(e) => setProd(e.target.value)}
              rightSlot={<span className="text-sm">%</span>}
            />
          </Field>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-xs leading-snug text-warn-text">
          <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <p>{warning}</p>
        </div>
      </form>

      {/* ── История ставок ─────────────────────────────────────────────── */}
      <div className="mt-6 border-t border-line pt-4">
        <h3 className="mb-2 text-xs font-semibold text-ink-3">История ставок</h3>
        {historyQuery.isLoading ? (
          <SkeletonText lines={2} />
        ) : historyQuery.isError ? (
          <ErrorRow
            message="Не удалось загрузить историю ставок"
            onRetry={() => historyQuery.refetch()}
            loading={historyQuery.isFetching}
          />
        ) : history.length === 0 ? (
          <p className="text-xs text-ink-3">
            Ставка ещё не менялась — действует текущая ({currentSalaryPercent}% / {currentProductPercent}%)
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm font-medium capitalize text-ink">{labelMonth(h.month)}</span>
                <span className="text-xs tabular-nums text-ink-2">
                  {h.salaryPercent ?? '—'}% услуги · {h.productSalaryPercent ?? '—'}% товары
                </span>
                {h.creatorName ? (
                  <span className="max-w-[10rem] truncate text-xs text-ink-3">{h.creatorName}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
