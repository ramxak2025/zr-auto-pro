import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';

const MIN_PASSWORD = 6;

export interface ResetOwnerPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantName: string;
  isPending: boolean;
  onSubmit: (password: string) => void;
}

/** Сброс пароля владельца автосервиса (кабинет менеджера): новый пароль задаёт менеджер и передаёт владельцу. */
export default function ResetOwnerPasswordModal({
  isOpen,
  onClose,
  tenantName,
  isPending,
  onSubmit,
}: ResetOwnerPasswordModalProps) {
  const uid = useId();
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  // Modal монтирует содержимое только пока открыт, а состояние нужно футеру — сбрасываем при открытии.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setPassword('');
      setVisible(false);
    }
  }

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const canSubmit = password.length >= MIN_PASSWORD;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Сбросить пароль владельца"
      description={`Новый пароль для входа владельца «${tenantName}». Прежний пароль перестанет работать.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button type="submit" form={`${uid}-reset-form`} disabled={!canSubmit} loading={isPending}>
            Сохранить пароль
          </Button>
        </>
      }
    >
      <form
        id={`${uid}-reset-form`}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit(password);
        }}
      >
        <Field
          label="Новый пароль"
          htmlFor={`${uid}-reset-password`}
          required
          hint={`Минимум ${MIN_PASSWORD} символов. После сохранения пароль нигде не показывается — передайте его владельцу.`}
          error={tooShort ? `Минимум ${MIN_PASSWORD} символов.` : undefined}
        >
          <Input
            id={`${uid}-reset-password`}
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={tooShort}
            rightSlot={
              <IconButton
                label={visible ? 'Скрыть пароль' : 'Показать пароль'}
                icon={visible ? EyeOff : Eye}
                size="sm"
                onClick={() => setVisible((v) => !v)}
              />
            }
          />
        </Field>
      </form>
    </Modal>
  );
}
