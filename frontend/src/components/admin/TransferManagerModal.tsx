import { useId, useState } from 'react';

import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Select } from '../../ui/Select';
import { ErrorRow } from './adminUi';
import { useAdminManagers } from './useAdminManagers';

export interface TransferManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantName: string;
  /** Текущий менеджер автосервиса — предвыбран; null — клиент без менеджера. */
  currentManagerId: string | null;
  isPending: boolean;
  /** null — открепить от менеджера. */
  onSubmit: (managerId: string | null) => void;
}

/** Передача автосервиса другому менеджеру или «Без менеджера». История платежей остаётся у прежнего менеджера. */
export default function TransferManagerModal({
  isOpen,
  onClose,
  tenantName,
  currentManagerId,
  isPending,
  onSubmit,
}: TransferManagerModalProps) {
  const uid = useId();
  const [selected, setSelected] = useState('');
  const [wasOpen, setWasOpen] = useState(false);

  // Modal монтирует содержимое только пока открыт, а состояние нужно футеру — сбрасываем при открытии.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setSelected(currentManagerId ?? '');
  }

  const { data: managers, isError, isFetching, refetch } = useAdminManagers(isOpen);

  // Отключённых менеджеров клиенту не назначаем; текущий остаётся в списке, даже если отключён.
  const options = (managers ?? []).filter((m) => m.isActive || m.id === currentManagerId);
  const unchanged = selected === (currentManagerId ?? '');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Передать другому менеджеру"
      description={`Автосервис «${tenantName}». Прошлые платежи и расчёты остаются у прежнего менеджера, новые пойдут новому.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button
            disabled={unchanged || (isError && !managers)}
            onClick={() => onSubmit(selected || null)}
            loading={isPending}
          >
            Передать
          </Button>
        </>
      }
    >
      {isError && !managers ? (
        <ErrorRow message="Не удалось загрузить менеджеров" onRetry={() => refetch()} loading={isFetching} />
      ) : (
        <Field label="Менеджер" htmlFor={`${uid}-manager`}>
          <Select
            id={`${uid}-manager`}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            placeholder="Без менеджера"
          >
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName} · доля владельца {m.ownerSharePercent} %{m.isActive ? '' : ' · отключён'}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  );
}
