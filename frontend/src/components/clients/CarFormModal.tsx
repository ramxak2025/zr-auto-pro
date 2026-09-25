/**
 * CarFormModal — единая форма автомобиля (создание / редактирование) для
 * карточки клиента и списка «Автомобили».
 *
 * Поля: госномер, марка и модель, VIN (только при включённой опции тенанта —
 * `vinEnabled`), комментарий. Логика сохранения (проверка дубля госномера,
 * мутации, инвалидация кэша) остаётся у страницы: форма отдаёт значения через
 * `onSubmit`, а ошибку VIN (409 VIN_DUPLICATE) получает обратно через
 * `vinError` и показывает под полем с ссылкой на карточку владельца.
 *
 * `extra` — дополнительный блок формы (смена владельца в карточке клиента).
 */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../Modal';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { focusRing } from '../../ui/tokens';
import { cn } from '../../ui/cn';
import { VinInput, type VinDuplicateInfo } from '../vin';

export interface CarFormValues {
  plateNumber: string;
  makeModel: string;
  /** Канонический VIN или '' (пусто). При выключенной опции всегда ''. */
  vin: string;
  comment: string;
}

export const EMPTY_CAR_FORM: CarFormValues = { plateNumber: '', makeModel: '', vin: '', comment: '' };

export interface CarFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  initial: CarFormValues;
  vinEnabled: boolean;
  submitting?: boolean;
  submitLabel: string;
  /** 409 VIN_DUPLICATE от сервера — показывается под полем VIN. */
  vinError?: VinDuplicateInfo | null;
  /** id текущего клиента: ссылка «Открыть карточку» не показывается на самого себя. */
  currentClientId?: string;
  onSubmit: (values: CarFormValues) => void;
  /** Дополнительные поля между комментарием и футером (смена владельца). */
  extra?: ReactNode;
}

export default function CarFormModal({
  isOpen,
  onClose,
  title,
  description,
  initial,
  vinEnabled,
  submitting = false,
  submitLabel,
  vinError,
  currentClientId,
  onSubmit,
  extra,
}: CarFormModalProps) {
  const uid = useId();
  const formId = `car-form-${uid}`;
  const [values, setValues] = useState<CarFormValues>(initial);
  // Каждое открытие — свежие значения (новая машина / другая машина).
  // Синхронно, в рендере (derived state), а не в useEffect: иначе первый кадр
  // открытой формы показывал бы прошлые/пустые поля.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setValues(initial);
  }

  const set = (patch: Partial<CarFormValues>) => setValues((prev) => ({ ...prev, ...patch }));

  // Ошибка сервера по VIN (409) — фокус на поле с ошибкой, как у любой формы.
  useEffect(() => {
    if (vinError) document.getElementById(`${formId}-vin`)?.focus();
  }, [vinError, formId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      plateNumber: values.plateNumber.trim(),
      makeModel: values.makeModel.trim(),
      vin: vinEnabled ? values.vin : '',
      comment: values.comment.trim(),
    });
  };

  const vinErrorAction =
    vinError?.clientId && vinError.clientId !== currentClientId ? (
      <Link
        to={`/clients/${vinError.clientId}`}
        className={cn('font-medium text-accent-text underline-offset-2 hover:underline', focusRing)}
        onClick={onClose}
      >
        Открыть карточку клиента
      </Link>
    ) : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" form={formId} loading={submitting}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <Field label="Госномер" htmlFor={`${formId}-plate`} required>
          <Input
            id={`${formId}-plate`}
            name="plateNumber"
            value={values.plateNumber}
            onChange={(e) => set({ plateNumber: e.target.value.replace(/\s+/g, '').toUpperCase() })}
            placeholder="А123АА77"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            className="uppercase tracking-wide"
          />
        </Field>

        <Field label="Марка и модель" htmlFor={`${formId}-make`} required>
          <Input
            id={`${formId}-make`}
            name="makeModel"
            value={values.makeModel}
            onChange={(e) => set({ makeModel: e.target.value })}
            placeholder="Например: Chevrolet Malibu"
            autoComplete="off"
            required
          />
        </Field>

        {vinEnabled && (
          <Field label="VIN" htmlFor={`${formId}-vin`}>
            <VinInput
              id={`${formId}-vin`}
              value={values.vin}
              onChange={(vin) => set({ vin })}
              makeModel={values.makeModel}
              onMakeModel={(makeModel) => set({ makeModel })}
              error={vinError?.message ?? null}
              errorAction={vinErrorAction}
            />
          </Field>
        )}

        <Field label="Комментарий" htmlFor={`${formId}-comment`}>
          <Textarea
            id={`${formId}-comment`}
            name="comment"
            value={values.comment}
            onChange={(e) => set({ comment: e.target.value })}
            rows={3}
            placeholder="Необязательно"
          />
        </Field>

        {extra}
      </form>
    </Modal>
  );
}
