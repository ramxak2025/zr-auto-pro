import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { plansApi } from '../../api/services';
import type { Plan } from '../../types';
import { formatMoney } from '../../../../shared/utils/formatters';
import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Select } from '../../ui/Select';
import { ErrorRow } from './adminUi';

export interface AssignPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'superadmin' | 'manager';
  /** Текущий тариф автосервиса — предвыбран при открытии. */
  currentPlanId?: string | null;
  isPending: boolean;
  onSubmit: (planId: string) => void;
}

/** Смена тарифа автосервиса: цена и лимит сотрудников синхронизируются на сервере. */
export default function AssignPlanModal({
  isOpen,
  onClose,
  mode,
  currentPlanId,
  isPending,
  onSubmit,
}: AssignPlanModalProps) {
  const uid = useId();
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [wasOpen, setWasOpen] = useState(false);

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setSelectedPlanId(currentPlanId || '');
  }

  // Активные тарифы; ключ общий со страницами суперадмина — кэш переиспользуется.
  const {
    data: plans,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['plans'],
    queryFn: () => plansApi.getAll(),
    select: (res) => (res.data as Plan[]).filter((p) => p.isActive),
    enabled: isOpen,
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Назначить тариф"
      description="Назначение тарифа синхронизирует цену и лимит сотрудников автосервиса."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button
            disabled={!selectedPlanId}
            onClick={() => selectedPlanId && onSubmit(selectedPlanId)}
            loading={isPending}
          >
            Назначить
          </Button>
        </>
      }
    >
      {isError && !plans ? (
        <ErrorRow
          message={
            mode === 'manager'
              ? 'Не удалось загрузить список тарифов. Повторите попытку.'
              : 'Не удалось загрузить тарифы'
          }
          onRetry={() => refetch()}
          loading={isFetching}
        />
      ) : (
        <Field label="Тариф" htmlFor={`${uid}-plan`}>
          <Select
            id={`${uid}-plan`}
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
            placeholder="— Выберите тариф —"
          >
            {(plans ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatMoney(p.monthlyPrice)}/мес · до {p.maxUsers} сотр.
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  );
}
