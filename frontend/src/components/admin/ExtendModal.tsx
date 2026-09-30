import { useId, useState } from 'react';
import { addDays, addYears, format, isPast, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Gift, Wallet } from 'lucide-react';

import type { ExtendSubscriptionRequest } from '../../api/services';
import type { SubscriptionPeriodKind } from '../../types';
import Modal from '../Modal';
import SubscriptionPeriodBadge from '../SubscriptionPeriodBadge';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { ToggleChip } from './adminUi';
import { formatRubExact, previewOwnerShare } from './MoneyExact';

// Быстрые пресеты считают дату от якоря (текущий срок, если он в будущем, иначе сегодня).
const EXTEND_PRESETS: { label: string; add: (d: Date) => Date }[] = [
  { label: '+30 дней', add: (d) => addDays(d, 30) },
  { label: '+90 дней', add: (d) => addDays(d, 90) },
  { label: '+год', add: (d) => addYears(d, 1) },
];

const FREE_DAY_PRESETS = [7, 14, 30];
const DEFAULT_MAX_FREE_DAYS = 30;

const digitsOnly = (v: string) => v.replace(/[^\d]/g, '');

type ExtendKind = 'paid' | 'free';

export interface ExtendModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** superadmin — как раньше (дата, без лимита); manager — бесплатно только днями ≤ maxFreeDays, доля владельца в подсказке. */
  mode: 'superadmin' | 'manager';
  /** Текущий subscriptionEnd автосервиса (ISO) — якорь для дат и подпись. */
  subscriptionEnd?: string | null;
  /** Цена тарифа — подставляется в сумму платежа. */
  planPrice?: number;
  currentPeriodKind?: SubscriptionPeriodKind | null;
  /** superadmin: менеджер автосервиса → галочка «Оплату получил менеджер». percent неизвестен, пока список менеджеров не загрузился. */
  manager?: { name: string; ownerSharePercent: number | null } | null;
  /** manager: максимум дней одного бесплатного продления (ManagerSummary.maxFreeDays). */
  maxFreeDays?: number;
  /** manager: моя ставка доли владельца, % — для подсказки «Из них доля владельца». */
  ownerSharePercent?: number;
  isPending: boolean;
  onSubmit: (request: ExtendSubscriptionRequest) => void;
}

/**
 * Продление подписки — платно / бесплатно. Общий для кабинета суперадмина и менеджера.
 * Состояние живёт здесь (футер модалки читает форму), поэтому при открытии оно сбрасывается
 * прямо в рендере — Modal монтирует содержимое только пока открыт.
 */
export default function ExtendModal({
  isOpen,
  onClose,
  mode,
  subscriptionEnd,
  planPrice,
  currentPeriodKind,
  manager,
  maxFreeDays,
  ownerSharePercent,
  isPending,
  onSubmit,
}: ExtendModalProps) {
  const uid = useId();
  const isManager = mode === 'manager';
  const maxDays = maxFreeDays && maxFreeDays > 0 ? maxFreeDays : DEFAULT_MAX_FREE_DAYS;

  const end = subscriptionEnd ? parseISO(subscriptionEnd) : null;
  const endActive = !!end && !isPast(end);
  const anchor = (): Date => (end && endActive ? end : new Date());

  const [kind, setKind] = useState<ExtendKind>('paid');
  const [amount, setAmount] = useState('');
  const [until, setUntil] = useState(''); // YYYY-MM-DD
  const [days, setDays] = useState('');
  const [creditManager, setCreditManager] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setKind('paid');
      setAmount(planPrice ? String(planPrice) : '');
      setUntil(format(addDays(anchor(), 30), 'yyyy-MM-dd'));
      setDays(String(Math.min(14, maxDays)));
      setCreditManager(false);
    }
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const untilValid = !!until && until > todayStr;
  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= maxDays;

  // Менеджер бесплатно выдаёт срок днями, суперадмин — датой.
  const freeByDays = isManager && kind === 'free';
  const canSubmit = kind === 'paid' ? untilValid && amountValid : freeByDays ? daysValid : untilValid;

  const sharePercent = isManager ? ownerSharePercent : (manager?.ownerSharePercent ?? null);
  const shareAmount =
    amountValid && sharePercent != null ? previewOwnerShare(Math.round(amountNum), sharePercent) : null;
  const paidAmount = amountValid ? Math.round(amountNum) : 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (kind === 'paid') {
      const request: ExtendSubscriptionRequest = { type: 'paid', amount: paidAmount, until };
      // Менеджерские платные продления несут долю всегда — сервер флаг там игнорирует.
      if (!isManager && manager && creditManager) request.creditManager = true;
      onSubmit(request);
    } else if (freeByDays) {
      onSubmit({ type: 'free', days: daysNum });
    } else {
      onSubmit({ type: 'free', until });
    }
  };

  const submitLabel =
    kind === 'paid' ? (amountValid ? `Продлить · ${formatRubExact(paidAmount)}` : 'Продлить') : 'Продлить бесплатно';

  const freePresets = FREE_DAY_PRESETS.filter((d) => d <= maxDays);
  const freeUntilPreview =
    freeByDays && daysValid ? format(addDays(anchor(), daysNum), 'd MMMM yyyy', { locale: ru }) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Продлить подписку"
      description={`Текущий срок: ${end ? format(end, 'd MMMM yyyy', { locale: ru }) : 'не указан'}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isPending}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {currentPeriodKind && <SubscriptionPeriodBadge kind={currentPeriodKind} until={subscriptionEnd} />}

        <Field
          label="Тип продления"
          hint={
            kind === 'paid'
              ? 'Платёж запишется в выручку по подпискам.'
              : isManager
                ? `Пробный доступ, не больше ${maxDays} дн. за одно продление. Не считается оплатой.`
                : 'Бесплатное продление не учитывается как выручка.'
          }
        >
          <SegmentedControl<ExtendKind>
            aria-label="Тип продления"
            fullWidth
            value={kind}
            onChange={setKind}
            options={[
              { value: 'paid', label: 'Платно', icon: Wallet },
              { value: 'free', label: 'Бесплатно', icon: Gift },
            ]}
          />
        </Field>

        {kind === 'paid' && (
          <Field
            label="Сумма платежа"
            htmlFor={`${uid}-ext-amount`}
            error={amount && !amountValid ? 'Введите сумму больше 0.' : undefined}
            hint={
              isManager && shareAmount != null && sharePercent != null ? (
                <>
                  Из них доля владельца:{' '}
                  <strong className="tabular-nums text-ink-2">{formatRubExact(shareAmount)}</strong> ({sharePercent} %)
                  · вам остаётся <span className="tabular-nums">{formatRubExact(paidAmount - shareAmount)}</span>
                </>
              ) : undefined
            }
          >
            <Input
              id={`${uid}-ext-amount`}
              inputMode="decimal"
              className="tabular-nums"
              value={amount}
              onChange={(e) => setAmount(digitsOnly(e.target.value))}
              placeholder="например, 2990"
              invalid={!!amount && !amountValid}
              rightSlot={<span className="text-xs">₽</span>}
            />
          </Field>
        )}

        {kind === 'paid' && !isManager && manager && (
          <Checkbox
            checked={creditManager}
            onChange={(e) => setCreditManager(e.target.checked)}
            label={
              manager.ownerSharePercent != null
                ? `Оплату получил менеджер ${manager.name} (доля владельца ${manager.ownerSharePercent} %)`
                : `Оплату получил менеджер ${manager.name}`
            }
            description={
              creditManager && shareAmount != null
                ? `Доля владельца ${formatRubExact(shareAmount)} запишется в долг менеджера.`
                : 'Без галочки деньги считаются полученными владельцем напрямую — долг менеджера не растёт.'
            }
          />
        )}

        {freeByDays ? (
          <>
            <Field
              label="Срок, дней"
              htmlFor={`${uid}-ext-days`}
              error={days && !daysValid ? `Введите число от 1 до ${maxDays}.` : undefined}
              hint={freeUntilPreview ? `Подписка будет действовать до ${freeUntilPreview}.` : undefined}
            >
              <Input
                id={`${uid}-ext-days`}
                inputMode="numeric"
                className="tabular-nums"
                value={days}
                onChange={(e) => setDays(digitsOnly(e.target.value))}
                invalid={!!days && !daysValid}
                rightSlot={<span className="text-xs">дн.</span>}
              />
            </Field>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Быстрый выбор срока">
              {freePresets.map((d) => (
                <ToggleChip key={d} active={days === String(d)} onClick={() => setDays(String(d))}>
                  {d} дн.
                </ToggleChip>
              ))}
            </div>
          </>
        ) : (
          <>
            <Field
              label="Быстрое продление"
              hint={`Считается от ${end && endActive ? 'текущего срока' : 'сегодня'} и подставляет дату ниже.`}
            >
              <div className="flex flex-wrap gap-2" role="group" aria-label="Быстрое продление">
                {EXTEND_PRESETS.map((preset) => {
                  const presetDate = format(preset.add(anchor()), 'yyyy-MM-dd');
                  return (
                    <ToggleChip
                      key={preset.label}
                      active={until === presetDate}
                      onClick={() => setUntil(format(preset.add(anchor()), 'yyyy-MM-dd'))}
                    >
                      {preset.label}
                    </ToggleChip>
                  );
                })}
              </div>
            </Field>

            <Field
              label="Действует до"
              htmlFor={`${uid}-ext-until`}
              error={until && !untilValid ? 'Дата должна быть в будущем.' : undefined}
            >
              <Input
                id={`${uid}-ext-until`}
                type="date"
                className="tabular-nums"
                value={until}
                min={todayStr}
                invalid={!!until && !untilValid}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
