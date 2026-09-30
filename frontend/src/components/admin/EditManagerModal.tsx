import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { adminManagersApi } from '../../api/services';
import type { UpdateManagerRequest } from '../../api/services';
import type { PlatformManager } from '../../types';
import { isCompletePhone, normalizePhone } from '../../../../shared/validation/phone';
import Modal from '../Modal';
import Switch from '../Switch';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { apiErrorCode, apiErrorMessage } from './apiError';
import { adminManagerKeys } from './managerQueryKeys';
import { formatPercent, parseDecimalInput, sanitizeDecimalInput } from './numberInput';
import { maskPhoneInput } from './phoneInput';

const MIN_PASSWORD = 6;

interface EditForm {
  fullName: string;
  phone: string;
  ownerSharePercent: string;
  isActive: boolean;
  password: string;
  note: string;
}

const formFrom = (m: PlatformManager): EditForm => ({
  fullName: m.fullName,
  phone: maskPhoneInput(m.phone),
  ownerSharePercent: formatPercent(m.ownerSharePercent),
  isActive: m.isActive,
  password: '',
  note: m.note ?? '',
});

export interface EditManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  manager: PlatformManager;
}

/** Правка менеджера: имя, телефон-логин, доля владельца, доступ, новый пароль, заметка. Доля действует только на будущие оплаты. */
export default function EditManagerModal({ isOpen, onClose, manager }: EditManagerModalProps) {
  const uid = useId();
  const formId = `${uid}-edit-manager-form`;
  const queryClient = useQueryClient();

  const [form, setForm] = useState<EditForm>(() => formFrom(manager));
  const [showErrors, setShowErrors] = useState(false);
  // Ответ 409 PHONE_TAKEN: показываем у поля телефона, пока его не поправят.
  const [phoneTaken, setPhoneTaken] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  // Modal монтирует содержимое только пока открыт, а состояние нужно футеру — сбрасываем при открытии.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setForm(formFrom(manager));
      setShowErrors(false);
      setPhoneTaken(null);
    }
  }

  const shareNum = parseDecimalInput(form.ownerSharePercent);
  const errors = {
    fullName: form.fullName.trim() ? undefined : 'Введите имя менеджера.',
    phone: isCompletePhone(form.phone) ? undefined : 'Введите телефон полностью — это логин менеджера.',
    share: Number.isFinite(shareNum) && shareNum >= 0 && shareNum <= 100 ? undefined : 'Введите число от 0 до 100.',
    password:
      form.password === '' || form.password.length >= MIN_PASSWORD
        ? undefined
        : `Пароль — не короче ${MIN_PASSWORD} символов.`,
  };
  const formValid = !errors.fullName && !errors.phone && !errors.share && !errors.password;

  // PATCH получает только изменённые поля: пустой запрос — нечего сохранять.
  const request: UpdateManagerRequest = {};
  if (form.fullName.trim() !== manager.fullName) request.fullName = form.fullName.trim();
  if (isCompletePhone(form.phone) && normalizePhone(form.phone) !== normalizePhone(manager.phone)) {
    request.phone = normalizePhone(form.phone);
  }
  if (Number.isFinite(shareNum) && shareNum !== manager.ownerSharePercent) request.ownerSharePercent = shareNum;
  if (form.isActive !== manager.isActive) request.isActive = form.isActive;
  if (form.password) request.password = form.password;
  if (form.note.trim() !== (manager.note ?? '')) request.note = form.note.trim() || null;
  const dirty = Object.keys(request).length > 0;

  const mutation = useMutation({
    mutationFn: (payload: UpdateManagerRequest) => adminManagersApi.update(manager.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.detail(manager.id) });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.list });
      queryClient.invalidateQueries({ queryKey: adminManagerKeys.audit(manager.id) });
      queryClient.invalidateQueries({ queryKey: ['admin-audit-log'] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('Изменения сохранены');
      onClose();
    },
    onError: (err) => {
      if (apiErrorCode(err) === 'PHONE_TAKEN') {
        setPhoneTaken(apiErrorMessage(err, 'Этот телефон уже занят другим пользователем платформы.'));
        return;
      }
      toast.error(apiErrorMessage(err, 'Не удалось сохранить менеджера'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    if (!formValid || !dirty) return;
    mutation.mutate(request);
  };

  // Пустые поля подсвечиваем только после попытки отправки, введённое неверно — сразу.
  const shown = (message: string | undefined, filled: boolean) => (showErrors || filled ? message : undefined);
  const phoneError = phoneTaken ?? shown(errors.phone, form.phone !== '');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Редактировать менеджера"
      description={manager.fullName}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={!dirty}>
            Сохранить
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Имя" htmlFor={`${uid}-name`} required error={shown(errors.fullName, form.fullName !== '')}>
          <Input
            id={`${uid}-name`}
            autoComplete="off"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            invalid={!!shown(errors.fullName, form.fullName !== '')}
          />
        </Field>

        <Field label="Телефон (логин)" htmlFor={`${uid}-phone`} required error={phoneError}>
          <Input
            id={`${uid}-phone`}
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            className="tabular-nums"
            value={form.phone}
            onChange={(e) => {
              setPhoneTaken(null);
              setForm({ ...form, phone: maskPhoneInput(e.target.value) });
            }}
            placeholder="+7 (XXX) XXX-XX-XX"
            invalid={!!phoneError}
          />
        </Field>

        <Field
          label="Доля владельца"
          htmlFor={`${uid}-share`}
          required
          hint="Действует на будущие оплаты: уже проведённые платежи хранят прежнюю долю и не пересчитываются."
          error={shown(errors.share, form.ownerSharePercent !== '')}
        >
          <Input
            id={`${uid}-share`}
            inputMode="decimal"
            maxLength={6}
            className="tabular-nums"
            value={form.ownerSharePercent}
            onChange={(e) => setForm({ ...form, ownerSharePercent: sanitizeDecimalInput(e.target.value) })}
            invalid={!!shown(errors.share, form.ownerSharePercent !== '')}
            rightSlot={<span className="text-xs">%</span>}
          />
        </Field>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-line px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Может входить в кабинет</p>
            <p className="text-xs text-ink-3">
              Отключённый менеджер не войдёт в систему. Его автосервисы остаются за ним.
            </p>
          </div>
          <Switch
            checked={form.isActive}
            onChange={(isActive) => setForm({ ...form, isActive })}
            label="Менеджер активен"
          />
        </div>

        <Field
          label="Новый пароль"
          htmlFor={`${uid}-password`}
          hint={`Оставьте пустым, чтобы не менять. Минимум ${MIN_PASSWORD} символов — передайте его менеджеру.`}
          error={shown(errors.password, form.password !== '')}
        >
          <Input
            id={`${uid}-password`}
            type="text"
            autoComplete="off"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            invalid={!!shown(errors.password, form.password !== '')}
          />
        </Field>

        <Field label="Заметка" htmlFor={`${uid}-note`} hint="Видна только вам.">
          <Textarea
            id={`${uid}-note`}
            rows={2}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}
