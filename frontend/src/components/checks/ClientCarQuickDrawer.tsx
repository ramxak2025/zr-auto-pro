import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { carsApi, clientsApi } from '../../api/services';
import type { Car, Client } from '../../types';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Checkbox } from '../../ui/Checkbox';
import PhoneInput from '../PhoneInput';
import { VinInput, vinDuplicateError } from '../vin';
import { formatPhone, isValidPhone } from '../../../../shared/validation/phone';
import { apiErrorMessage, apiErrorStatus, otherPointPhoneConflictMessage } from '../../../../shared/utils/apiError';
import {
  isValidRussianPlate,
  looksLikeRussianPlate,
  normalizeForeignPlate,
  processPlateInput,
} from '../../../../shared/utils/plate';

export type QuickDrawerMode =
  | { kind: 'new-client'; initialVin?: string; initialPlate?: string; initialPhone?: string }
  | { kind: 'add-car'; client: Client; initialVin?: string }
  | { kind: 'edit-car'; client: Client; car: Car };

interface ClientCarQuickDrawerProps {
  open: boolean;
  onClose: () => void;
  mode: QuickDrawerMode | null;
  /** Опция «VIN-код автомобиля» тенанта — без неё поле VIN не монтируется. */
  vinEnabled: boolean;
  /** Готово: свежая карточка клиента (с cars[]) и id машины, которую выбрать в чеке. */
  onDone: (client: Client, carId: string | null) => void;
}

interface PhoneConflict {
  clientId: string;
  name: string;
  phone: string;
}

/**
 * Госномер для сохранения: российский — «А123ВС 77» (латиница → кириллица,
 * регион через пробел, как пишет мобильная Касса); иностранный — верхний
 * регистр латиницей. Сервер дедуплицирует по ключу без пробелов, так что формат
 * на поиск не влияет.
 */
function plateForSave(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (looksLikeRussianPlate(trimmed)) {
    const clean = processPlateInput(trimmed);
    if (isValidRussianPlate(clean)) return `${clean.slice(0, 6)} ${clean.slice(6)}`;
  }
  return normalizeForeignPlate(trimmed);
}

interface FormInit {
  fullName: string;
  phone: string;
  plate: string;
  noPlate: boolean;
  makeModel: string;
  vin: string;
}

/** Начальные значения полей под режим панели; VIN — только при включённой опции. */
function initialForm(mode: QuickDrawerMode | null, vinEnabled: boolean): FormInit {
  const empty: FormInit = { fullName: '', phone: '', plate: '', noPlate: false, makeModel: '', vin: '' };
  if (!mode) return empty;
  if (mode.kind === 'new-client') {
    return {
      ...empty,
      phone: mode.initialPhone ? formatPhone(mode.initialPhone) : '',
      plate: mode.initialPlate ?? '',
      vin: vinEnabled ? (mode.initialVin ?? '') : '',
    };
  }
  if (mode.kind === 'add-car') {
    return { ...empty, vin: vinEnabled ? (mode.initialVin ?? '') : '' };
  }
  return {
    ...empty,
    plate: mode.car.plateNumber ?? '',
    noPlate: !!mode.car.noPlate || !mode.car.plateNumber,
    makeModel: mode.car.makeModel ?? '',
    vin: vinEnabled ? (mode.car.vin ?? '') : '',
  };
}

/** 409 CLIENT_PHONE_EXISTS → карточка существующего клиента (в своём филиале). */
function phoneConflictOf(err: unknown): PhoneConflict | null {
  if (apiErrorStatus(err) !== 409) return null;
  const data = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
  if (!data || data.code !== 'CLIENT_PHONE_EXISTS') return null;
  const client = data.client as { id?: string; fullName?: string; phone?: string } | undefined;
  const clientId = (typeof data.clientId === 'string' && data.clientId) || client?.id;
  if (!clientId) return null;
  return { clientId, name: client?.fullName || 'Клиент', phone: client?.phone || '' };
}

/**
 * Быстрое создание клиента и/или автомобиля прямо из Кассы — кассир не уходит
 * со страницы заказа (паритет с mobile QuickClientCreateSheet). Три режима:
 * новый клиент (+ авто по желанию), новое авто существующего клиента, правка
 * выбранного авто. При включённой опции 171 в форме авто есть поле VIN:
 * расшифровка подставляет марку/модель, 409 VIN_DUPLICATE показывается под
 * полем с именем клиента-владельца.
 *
 * Клиент создаётся ОДИН раз: если авто не сохранилось (409 по VIN, сеть), id
 * созданного клиента запоминается и повторная отправка создаёт только машину.
 */
export default function ClientCarQuickDrawer({ open, onClose, mode, vinEnabled, onDone }: ClientCarQuickDrawerProps) {
  const queryClient = useQueryClient();
  const uid = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Начальные значения — уже при первом рендере (родитель монтирует панель с
  // новым key на каждое открытие), эффект ниже лишь страхует повторное открытие
  // без смены key.
  const [fullName, setFullName] = useState(() => initialForm(mode, vinEnabled).fullName);
  const [phone, setPhone] = useState(() => initialForm(mode, vinEnabled).phone);
  const [plate, setPlate] = useState(() => initialForm(mode, vinEnabled).plate);
  const [noPlate, setNoPlate] = useState(() => initialForm(mode, vinEnabled).noPlate);
  const [makeModel, setMakeModel] = useState(() => initialForm(mode, vinEnabled).makeModel);
  const [vin, setVin] = useState(() => initialForm(mode, vinEnabled).vin);

  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [plateError, setPlateError] = useState<string | null>(null);
  const [vinError, setVinError] = useState<string | null>(null);
  const [phoneConflict, setPhoneConflict] = useState<PhoneConflict | null>(null);

  const [submitting, setSubmitting] = useState(false);
  // Клиент уже создан на прошлой попытке (авто не сохранилось) — не дублируем.
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);

  // Сброс формы под режим при каждом открытии.
  useEffect(() => {
    if (!open || !mode) return;
    setNameError(null);
    setPhoneError(null);
    setPlateError(null);
    setVinError(null);
    setPhoneConflict(null);
    setCreatedClientId(null);
    setSubmitting(false);
    const init = initialForm(mode, vinEnabled);
    setFullName(init.fullName);
    setPhone(init.phone);
    setPlate(init.plate);
    setNoPlate(init.noPlate);
    setMakeModel(init.makeModel);
    setVin(init.vin);
  }, [open, mode, vinEnabled]);

  if (!mode) return null;

  const isNewClient = mode.kind === 'new-client';
  const isEditCar = mode.kind === 'edit-car';
  const carFilled = noPlate || plate.trim().length > 0 || makeModel.trim().length > 0 || vin.length > 0;

  const title = isNewClient ? 'Новый клиент' : isEditCar ? 'Изменить автомобиль' : 'Новый автомобиль';
  const subtitle = !isNewClient
    ? `${mode.client.fullName} · ${formatPhone(mode.client.phone)}`
    : 'Клиент и его автомобиль — без ухода из Кассы';

  const finish = async (clientId: string, carId: string | null) => {
    const fresh = (await clientsApi.getById(clientId)).data as Client;
    queryClient.invalidateQueries({ queryKey: ['clients'] });
    queryClient.invalidateQueries({ queryKey: ['cars'] });
    onDone(fresh, carId);
  };

  const saveCar = async (clientId: string): Promise<string | null> => {
    const plateNumber = noPlate ? '' : plateForSave(plate);
    const payloadVin = vinEnabled ? (vin ? vin : null) : undefined;
    if (isEditCar) {
      await carsApi.update(mode.car.id, {
        plateNumber,
        makeModel: makeModel.trim(),
        noPlate,
        ...(payloadVin !== undefined ? { vin: payloadVin } : {}),
      });
      return mode.car.id;
    }
    const res = await carsApi.create({
      clientId,
      plateNumber,
      makeModel: makeModel.trim(),
      noPlate,
      ...(payloadVin ? { vin: payloadVin } : {}),
    });
    return res.data.id;
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    setNameError(null);
    setPhoneError(null);
    setPlateError(null);
    setVinError(null);
    setPhoneConflict(null);

    // Валидация формы.
    let firstBad: string | null = null;
    if (isNewClient && !createdClientId && !fullName.trim()) {
      setNameError('Укажите имя клиента');
      firstBad = firstBad ?? `${uid}-name`;
    }
    if (isNewClient && !createdClientId && phone.trim() && !isValidPhone(phone)) {
      setPhoneError('Проверьте номер телефона');
      firstBad = firstBad ?? `${uid}-phone`;
    }
    if ((!isNewClient || carFilled) && !noPlate && !plate.trim()) {
      setPlateError('Укажите госномер или отметьте «Без номера»');
      firstBad = firstBad ?? `${uid}-plate`;
    }
    if (firstBad) {
      focusField(firstBad);
      return;
    }

    setSubmitting(true);
    try {
      let clientId: string;
      if (isNewClient) {
        if (createdClientId) {
          clientId = createdClientId;
        } else {
          try {
            const res = await clientsApi.create({ fullName: fullName.trim(), phone: phone.trim() });
            clientId = res.data.id;
            setCreatedClientId(clientId);
          } catch (err) {
            const conflict = phoneConflictOf(err);
            if (conflict) {
              setPhoneConflict(conflict);
              focusField(`${uid}-phone`);
              return;
            }
            const otherPoint = otherPointPhoneConflictMessage(err);
            if (otherPoint) {
              setPhoneError(otherPoint);
              focusField(`${uid}-phone`);
              return;
            }
            const msg = apiErrorMessage(err) ?? 'Не удалось создать клиента';
            if (/имя/i.test(msg)) setNameError(msg);
            else toast.error(msg, { duration: 6000 });
            return;
          }
        }
      } else {
        clientId = mode.client.id;
      }

      let carId: string | null = null;
      if (!isNewClient || carFilled) {
        try {
          carId = await saveCar(clientId);
        } catch (err) {
          const dup = vinDuplicateError(err);
          if (dup) {
            setVinError(dup.message);
            focusField(`${uid}-vin`);
            return;
          }
          const msg = apiErrorMessage(err) ?? 'Не удалось сохранить автомобиль';
          if (/номер/i.test(msg)) {
            setPlateError(msg);
            focusField(`${uid}-plate`);
          } else toast.error(msg, { duration: 6000 });
          return;
        }
      }

      await finish(clientId, carId);
      toast.success(isNewClient ? 'Клиент добавлен' : isEditCar ? 'Автомобиль обновлён' : 'Автомобиль добавлен');
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? 'Не удалось сохранить');
    } finally {
      setSubmitting(false);
    }
  };

  // 409 по телефону: берём существующего клиента; если авто заполнено —
  // сразу привязываем его к нему.
  const useExisting = async () => {
    if (!phoneConflict || submitting) return;
    setSubmitting(true);
    try {
      const clientId = phoneConflict.clientId;
      let carId: string | null = null;
      if (carFilled) {
        try {
          carId = await saveCar(clientId);
        } catch (err) {
          const dup = vinDuplicateError(err);
          if (dup) {
            setCreatedClientId(clientId);
            setPhoneConflict(null);
            setVinError(dup.message);
            focusField(`${uid}-vin`);
            return;
          }
          toast.error(apiErrorMessage(err) ?? 'Не удалось сохранить автомобиль', { duration: 6000 });
          setCreatedClientId(clientId);
          setPhoneConflict(null);
          return;
        }
      }
      await finish(clientId, carId);
    } catch (err) {
      toast.error(apiErrorMessage(err) ?? 'Не удалось выбрать клиента');
    } finally {
      setSubmitting(false);
    }
  };

  // Отмена после того, как клиент уже создан: он существует — подставляем его
  // в чек, иначе кассир создал бы дубль при повторе.
  const handleClose = () => {
    if (createdClientId && !submitting) {
      void finish(createdClientId, null).catch(() => onClose());
      return;
    }
    onClose();
  };

  const formId = `${uid}-form`;
  /** Ошибка валидации / сервера — фокус на поле, где её исправлять. */
  const focusField = (id: string) => window.setTimeout(() => document.getElementById(id)?.focus(), 0);

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={title}
      subtitle={subtitle}
      size="md"
      initialFocusRef={firstFieldRef}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" form={formId} loading={submitting}>
            {isEditCar ? 'Сохранить' : isNewClient ? 'Создать' : 'Добавить авто'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-6">
        {isNewClient && (
          <section className="space-y-4" aria-labelledby={`${uid}-client`}>
            <h3 id={`${uid}-client`} className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Клиент
            </h3>
            <Field label="Имя клиента" htmlFor={`${uid}-name`} required error={nameError}>
              <Input
                ref={firstFieldRef}
                id={`${uid}-name`}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Иван Петров"
                autoComplete="name"
                invalid={!!nameError}
                disabled={!!createdClientId}
              />
            </Field>
            <Field
              label="Телефон"
              htmlFor={`${uid}-phone`}
              error={phoneError}
              hint={
                !phoneError && !phoneConflict ? 'По номеру клиента будут находить в Кассе и в СМС-рассылках' : undefined
              }
            >
              <PhoneInput
                id={`${uid}-phone`}
                value={phone}
                onChange={setPhone}
                placeholder="+7 (900) 000-00-00"
                autoComplete="tel"
                disabled={!!createdClientId}
                className="input"
                aria-invalid={phoneError ? true : undefined}
              />
              {phoneConflict && (
                <div
                  role="alert"
                  className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5"
                >
                  <UserRound className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
                  <p className="min-w-0 flex-1 text-sm text-warn-text">
                    Клиент с этим номером уже есть: <span className="font-semibold">{phoneConflict.name}</span>
                    {phoneConflict.phone ? ` · ${formatPhone(phoneConflict.phone)}` : ''}
                  </p>
                  <Button variant="secondary" size="sm" onClick={useExisting} loading={submitting}>
                    {carFilled ? 'Выбрать и добавить авто' : 'Выбрать его'}
                  </Button>
                </div>
              )}
            </Field>
          </section>
        )}

        <section className="space-y-4" aria-labelledby={`${uid}-car`}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 id={`${uid}-car`} className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Автомобиль
            </h3>
            {isNewClient && <span className="text-xs text-ink-3">необязательно</span>}
          </div>
          <Field label="Госномер" htmlFor={`${uid}-plate`} error={plateError}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                ref={isNewClient ? undefined : firstFieldRef}
                id={`${uid}-plate`}
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                onBlur={() => setPlate((v) => (v.trim() ? plateForSave(v) : v))}
                placeholder="А123ВС 77"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={noPlate}
                invalid={!!plateError}
                className="font-mono uppercase tracking-wider sm:max-w-[12rem]"
              />
              <Checkbox
                label="Без номера"
                checked={noPlate}
                onChange={(e) => {
                  setNoPlate(e.target.checked);
                  if (e.target.checked) setPlateError(null);
                }}
              />
            </div>
          </Field>
          <Field
            label="Марка и модель"
            htmlFor={`${uid}-make`}
            hint={vinEnabled ? 'Заполнится сама по VIN, если оставить пустым' : undefined}
          >
            <Input
              id={`${uid}-make`}
              value={makeModel}
              onChange={(e) => setMakeModel(e.target.value)}
              placeholder="Kia Rio"
              autoComplete="off"
            />
          </Field>
          {vinEnabled && (
            <VinInput
              label="VIN"
              id={`${uid}-vin`}
              value={vin}
              onChange={(v) => {
                setVin(v);
                if (vinError) setVinError(null);
              }}
              makeModel={makeModel}
              onMakeModel={setMakeModel}
              error={vinError}
            />
          )}
        </section>
      </form>
    </Drawer>
  );
}
