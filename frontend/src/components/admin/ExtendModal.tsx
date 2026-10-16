import { useId, useState } from 'react';
import { useSubscriptionRenewal } from './useSubscriptionRenewal';
import SubscriptionQuoteBreakdown from '../SubscriptionQuoteBreakdown';
import SubscriptionCompositionFields from '../SubscriptionCompositionFields';
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
import { parseDecimalInput, sanitizeDecimalInput } from './numberInput';

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
  tenantId: string;
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
  onSubmit: (request: ExtendSubscriptionRequest) => Promise<unknown>;
}

/**
 * Продление подписки — платно / бесплатно. Общий для кабинета суперадмина и менеджера.
 * Состояние живёт здесь (футер модалки читает форму), поэтому при открытии оно сбрасывается
 * прямо в рендере — Modal монтирует содержимое только пока открыт.
 */
export default function ExtendModal({
  tenantId,
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
  const renewal = useSubscriptionRenewal({ open: isOpen, tenantId, mode, legacyPrice: planPrice ?? 0, onSubmit });
  const { amount, changeAmount: setAmount } = renewal;
  const [until, setUntil] = useState(''); // YYYY-MM-DD
  const [days, setDays] = useState('');
  const [creditManager, setCreditManager] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setKind('paid');
      setUntil(format(addDays(anchor(), 30), 'yyyy-MM-dd'));
      setDays(String(Math.min(14, maxDays)));
      setCreditManager(false);
    }
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const untilValid = !!until && until > todayStr;
  const amountNum = parseDecimalInput(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= maxDays;

  // Менеджер бесплатно выдаёт срок днями, суперадмин — датой.
  const freeByDays = isManager && kind === 'free';
  const canSubmit =
    !isPending &&
    !renewal.sending &&
    (renewal.uncertain ||
      (kind === 'paid'
        ? amountValid && (renewal.period === 'custom' ? untilValid : renewal.quoteReady)
        : freeByDays
          ? daysValid
          : untilValid));

  const sharePercent = isManager ? ownerSharePercent : (manager?.ownerSharePercent ?? null);
  const paidAmount = amountValid ? Math.round(amountNum * 100) / 100 : 0;
  const shareAmount = amountValid && sharePercent != null ? previewOwnerShare(paidAmount, sharePercent) : null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (kind === 'paid') {
      const request: ExtendSubscriptionRequest = {
        type: 'paid',
        amount: paidAmount,
        ...(renewal.period === 'custom'
          ? { until }
          : {
              period: renewal.period,
              employees: renewal.employeesCount,
              points: renewal.pointsCount,
              quoteToken: renewal.quoteQuery.data?.quoteToken,
            }),
      };
      // Менеджерские платные продления несут долю всегда — сервер флаг там игнорирует.
      if (!isManager && manager && creditManager) request.creditManager = true;
      void renewal.send(request);
    } else if (freeByDays) {
      void renewal.send({ type: 'free', days: daysNum });
    } else {
      void renewal.send({ type: 'free', until });
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
      onClose={() => {
        if (renewal.canClose()) onClose();
      }}
      title="Продлить подписку"
      description={`Текущий срок: ${end ? format(end, 'd MMMM yyyy', { locale: ru }) : 'не указан'}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending || renewal.locked}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isPending || renewal.sending}>
            {renewal.uncertain ? 'Повторить тот же запрос' : submitLabel}
          </Button>
        </>
      }
    >
      {!!renewal.message && (
        <p role="alert" className="mb-4 text-sm text-ink-2">
          {renewal.message}
        </p>
      )}
      {renewal.changed && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void renewal.quoteQuery.refetch();
            }}
            loading={renewal.quoteQuery.isFetching}
          >
            Обновить расчёт
          </Button>
          <Button
            variant="secondary"
            disabled={
              !renewal.countsValid ||
              !renewal.quoteQuery.data ||
              renewal.quoteQuery.isError ||
              renewal.quoteQuery.isFetching
            }
            onClick={renewal.acknowledgeChange}
          >
            Расчёт проверен
          </Button>
        </div>
      )}
      <fieldset disabled={isPending || renewal.locked} className="space-y-4">
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
          <>
            <Field label="Период">
              <SegmentedControl
                aria-label="Период продления"
                value={renewal.period}
                onChange={renewal.setPeriod}
                options={[
                  { value: 'monthly', label: 'Месяц' },
                  { value: 'yearly', label: 'Год · 12 за 10' },
                  { value: 'custom', label: 'Своя дата' },
                ]}
              />
            </Field>
            {renewal.period !== 'custom' && (!renewal.initializingCounts || renewal.quoteQuery.isError) && (
              <SubscriptionCompositionFields
                employees={renewal.employees}
                points={renewal.points}
                minimumEmployees={renewal.minimumEmployees}
                minimumPoints={renewal.minimumPoints}
                onEmployeesChange={renewal.changeEmployees}
                onPointsChange={renewal.changePoints}
              />
            )}
            {!!renewal.amountHint && (
              <p role="status" className="text-sm text-ink-2">
                {renewal.amountHint}
              </p>
            )}
            {!!renewal.fallback && <p className="text-sm text-ink-2">{renewal.fallback}</p>}
            {renewal.period !== 'custom' &&
              (!renewal.countsValid ? (
                <p role="status" className="text-sm text-bad">
                  Проверьте количество сотрудников и филиалов.
                </p>
              ) : renewal.quoteQuery.isFetching ? (
                <p role="status" className="text-sm text-ink-3">
                  Загружаем расчёт…
                </p>
              ) : renewal.quoteQuery.isError ? (
                <div className="space-y-2">
                  <p className="text-sm text-ink-2">
                    Расчёт недоступен. Проверьте состав: для нескольких филиалов нужен MAX. Повторите загрузку или
                    выберите свою дату.
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void renewal.quoteQuery.refetch();
                    }}
                  >
                    Повторить расчёт
                  </Button>
                </div>
              ) : renewal.quoteQuery.data ? (
                <SubscriptionQuoteBreakdown preview={renewal.quoteQuery.data} />
              ) : null)}
          </>
        )}
        {kind === 'paid' && (
          <Field
            label="Фактически получено"
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
              onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
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
        ) : kind !== 'paid' || renewal.period === 'custom' ? (
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
        ) : null}
      </fieldset>
    </Modal>
  );
}
