import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

import { adminManagersApi } from '../../api/services';
import type { CreateSettlementRequest } from '../../api/services';
import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { cn } from '../../ui/cn';
import { apiErrorMessage } from './apiError';
import { MoneyExact, balanceCaption, balanceTextClass } from './MoneyExact';
import { adminManagerKeys } from './managerQueryKeys';
import { parseDecimalInput, sanitizeDecimalInput } from './numberInput';

export interface SettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  managerId: string;
  managerName: string;
  /** Текущий баланс менеджера: по нему показываем, каким он станет после расчёта. */
  balance: number;
}

const todayIso = () => format(new Date(), 'yyyy-MM-dd');

/** Внести расчёт с менеджером: положительная сумма — менеджер передал деньги владельцу, отрицательная — корректировка с причиной. */
export default function SettlementModal({ isOpen, onClose, managerId, managerName, balance }: SettlementModalProps) {
  const uid = useId();
  const formId = `${uid}-settlement-form`;
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState('');
  const [settledOn, setSettledOn] = useState(todayIso);
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  // Modal монтирует содержимое только пока открыт, а состояние нужно футеру — сбрасываем при открытии.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setAmount('');
      setSettledOn(todayIso());
      setNote('');
      setShowErrors(false);
    }
  }

  const amountNum = parseDecimalInput(amount);
  const amountFilled = Number.isFinite(amountNum);
  // Одинокий «−» — ещё не ошибка: человек просто начал вводить отрицательную сумму.
  const amountTyped = amount !== '' && amount !== '-';
  const errors = {
    amount: !amountFilled ? 'Введите сумму расчёта.' : amountNum === 0 ? 'Сумма не может быть нулевой.' : undefined,
    settledOn: settledOn ? undefined : 'Укажите дату расчёта.',
    note: amountFilled && amountNum < 0 && !note.trim() ? 'При отрицательной сумме укажите причину.' : undefined,
  };
  const isNegative = amountFilled && amountNum < 0;
  const value = Math.round(amountNum * 100) / 100;
  const balanceAfter = Math.round((balance - value) * 100) / 100;

  const mutation = useMutation({
    mutationFn: (payload: CreateSettlementRequest) => adminManagersApi.addSettlement(managerId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.detail(managerId) });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.ledgerAll });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.audit(managerId) });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.list });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-log'] });
      toast.success('Расчёт внесён');
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Не удалось внести расчёт')),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (errors.amount || errors.settledOn || errors.note) return;
    mutation.mutate({ amount: value, settledOn, note: note.trim() || undefined });
  };

  // Пустые поля подсвечиваем только после попытки отправки, введённое неверно — сразу.
  const shown = (message: string | undefined, filled: boolean) => (showErrors || filled ? message : undefined);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Внести расчёт"
      description={`Менеджер ${managerName}: сколько денег он передал владельцу.`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            Внести
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field
          label="Сумма"
          htmlFor={`${uid}-amount`}
          required
          hint="Плюс — менеджер передал деньги владельцу. Минус — исправление ошибки, тогда долг менеджера вырастет."
          error={shown(errors.amount, amountTyped)}
        >
          <Input
            id={`${uid}-amount`}
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            value={amount}
            onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value, { allowNegative: true }))}
            placeholder="3000"
            invalid={!!shown(errors.amount, amountTyped)}
            rightSlot={<span className="text-xs">₽</span>}
          />
        </Field>

        {amountFilled && amountNum !== 0 && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2" aria-live="polite">
            Баланс после расчёта:{' '}
            <MoneyExact value={balanceAfter} className={cn('font-semibold', balanceTextClass(balanceAfter))} />
            <span className="text-ink-3"> · {balanceCaption(balanceAfter, 'owner')}</span>
          </p>
        )}

        <Field label="Дата расчёта" htmlFor={`${uid}-date`} required error={shown(errors.settledOn, true)}>
          <Input
            id={`${uid}-date`}
            type="date"
            value={settledOn}
            onChange={(e) => setSettledOn(e.target.value)}
            invalid={!!shown(errors.settledOn, true)}
          />
        </Field>

        <Field
          label="Комментарий"
          htmlFor={`${uid}-note`}
          required={isNegative}
          hint={isNegative ? undefined : 'Например: перевод на карту, наличные при встрече.'}
          error={shown(errors.note, false)}
        >
          <Textarea
            id={`${uid}-note`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={isNegative ? 'Почему расчёт отрицательный' : 'Необязательно'}
            invalid={!!shown(errors.note, false)}
          />
        </Field>
      </form>
    </Modal>
  );
}
