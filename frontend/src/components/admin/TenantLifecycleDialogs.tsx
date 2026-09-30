import { useId, useState } from 'react';

import ConfirmDialog from '../ConfirmDialog';
import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Textarea } from '../../ui/Textarea';

/*
 * Диалоги жизненного цикла автосервиса: приостановка, возобновление, вход как владелец.
 * Общие для карточки автосервиса суперадмина и менеджера — отличается только текст входа.
 */

interface SuspendModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantName: string;
  isPending: boolean;
  onSubmit: (reason: string | undefined) => void;
}

/** Приостановка с необязательной причиной; срок подписки не меняется. */
export function SuspendModal({ isOpen, onClose, tenantName, isPending, onSubmit }: SuspendModalProps) {
  const uid = useId();
  const [reason, setReason] = useState('');
  const [wasOpen, setWasOpen] = useState(false);

  // Modal монтирует содержимое только пока открыт, а состояние нужно футеру — сбрасываем при открытии.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setReason('');
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Приостановить автосервис"
      description={`Сотрудники «${tenantName}» потеряют доступ до возобновления. Срок подписки не меняется.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button variant="danger" onClick={() => onSubmit(reason.trim() || undefined)} loading={isPending}>
            Приостановить
          </Button>
        </>
      }
    >
      <Field label="Причина (необязательно)" htmlFor={`${uid}-suspend-reason`}>
        <Textarea
          id={`${uid}-suspend-reason`}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Например: задолженность по оплате"
        />
      </Field>
    </Modal>
  );
}

interface UnsuspendDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tenantName: string;
  onConfirm: () => void;
}

export function UnsuspendDialog({ isOpen, onClose, tenantName, onConfirm }: UnsuspendDialogProps) {
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Возобновить работу"
      message={`Возобновить доступ для «${tenantName}»? Сотрудники снова смогут работать в приложении.`}
      confirmText="Возобновить"
      variant="primary"
    />
  );
}

interface ImpersonateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'superadmin' | 'manager';
  tenantName: string;
  onConfirm: () => void;
}

/** Вход как владелец: текущая сессия заменяется временной (30 минут), вернуться можно только повторным входом. */
export function ImpersonateDialog({ isOpen, onClose, mode, tenantName, onConfirm }: ImpersonateDialogProps) {
  const who = mode === 'manager' ? 'менеджера' : 'суперадмина';
  const back =
    mode === 'manager' ? 'чтобы вернуться в кабинет менеджера, войдите заново' : 'потребуется повторный вход';
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Войти как владелец"
      message={`Вы войдёте в аккаунт владельца «${tenantName}» под временной сессией (30 минут). Текущая сессия ${who} будет заменена — ${back}. Продолжить?`}
      confirmText="Войти"
      variant="primary"
    />
  );
}
