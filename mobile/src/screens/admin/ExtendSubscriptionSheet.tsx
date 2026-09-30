/**
 * ExtendSubscriptionSheet — ЕДИНАЯ форма продления подписки (карточка автосервиса
 * и «Истекают» на обзоре, суперадмин и менеджер). Быстрого «+30 дней» без формы
 * больше нет: он писал бесплатную строку без типа и не считал долю владельца.
 *
 *   • Суперадмин: платно (сумма + «до») / бесплатно («до»). У клиента менеджера
 *     при платном — переключатель «Оплату получил менеджер …» (creditManager):
 *     без него деньги считаются полученными владельцем и доля не начисляется.
 *   • Менеджер: платно — сумма обязательна и строка «Доля владельца: N ₽» (долг,
 *     который запишется на него); бесплатно — дни, не больше лимита из настроек
 *     платформы (`maxFreeDays`).
 *
 * Сервер — источник истины: доля в подсказке считается локально (до копейки), в
 * платёж пишется снимок с сервера.
 */
import React from 'react';
import { Alert, StyleSheet, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminManagersApi, managerApi, tenantsApi } from '../../api/services';
import DateTimePickerModal from '../../components/DateTimePickerModal';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing } from '../../theme';
import { extractApiErrorMessage } from '../../utils/apiError';
import type { PlatformManager, ManagerSummary, SubscriptionPeriodKind } from '../../../../shared/types';
import type { ExtendSubscriptionRequest } from '../../../../shared/api/types';
import {
  computeOwnerShare,
  formatFullDate,
  formatMoneyExact,
  formatPercent,
  invalidatePlatformQueries,
  isExpired,
  parseAmount,
  useAdminMode,
} from './adminShared';
import {
  AdminSheet,
  SheetChips,
  SheetHint,
  SheetInput,
  SheetLabel,
  SheetSegmented,
  SheetSwitchRow,
} from './adminSheet';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Пресеты «до»: прибавляют дни к живому концу подписки. */
const PAID_PRESETS: { label: string; days: number }[] = [
  { label: '+30 дней', days: 30 },
  { label: '+90 дней', days: 90 },
  { label: '+год', days: 365 },
];

/** Пресеты пробного доступа менеджера (дни), каждый режется лимитом платформы. */
const TRIAL_DAY_PRESETS = [7, 14, 30];

/**
 * Сервер якорит продление на max(текущий конец, сейчас) — повторяем это, чтобы пресеты
 * прибавляли дни к ЖИВОМУ концу подписки, а не к «сейчас».
 */
function anchorFrom(subscriptionEnd?: string | null): Date {
  const now = new Date();
  if (!subscriptionEnd) return now;
  const end = new Date(subscriptionEnd);
  return Number.isNaN(end.getTime()) || end < now ? now : end;
}

/** Конец локального дня (23:59:59) — естественный смысл «оплачено до …». */
function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

export interface ExtendTarget {
  id: string;
  name: string;
  subscriptionEnd?: string | null;
  monthlyPrice?: number | null;
  managerId?: string | null;
  managerName?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  tenant: ExtendTarget | null;
  /** Цена тарифа из кабинета — подставляется в сумму; иначе `tenant.monthlyPrice`. */
  planPrice?: number | null;
  /** Характер ТЕКУЩЕГО периода: если он бесплатный, суперадмину форма откроется на «Бесплатно». */
  currentKind?: SubscriptionPeriodKind | null;
  /** Вызывается после успешного продления (кэши уже сброшены). */
  onDone?: () => void;
}

export default function ExtendSubscriptionSheet({ visible, onClose, tenant, planPrice, currentKind, onDone }: Props) {
  const palette = useColors();
  const surface = useIosSurface();
  const mode = useAdminMode();
  const queryClient = useQueryClient();
  const tenantId = tenant?.id ?? '';
  const subscriptionEnd = tenant?.subscriptionEnd ?? null;

  const [type, setType] = React.useState<'paid' | 'free'>('paid');
  const [amount, setAmount] = React.useState('');
  const [until, setUntil] = React.useState<Date | null>(null);
  const [days, setDays] = React.useState('');
  const [creditManager, setCreditManager] = React.useState(false);
  const [datePickerOpen, setDatePickerOpen] = React.useState(false);

  // Свежая форма при КАЖДОМ открытии; пока шторка открыта, правки пользователя не сбрасываем.
  const wasVisible = React.useRef(false);
  React.useEffect(() => {
    if (visible && !wasVisible.current) {
      const price = planPrice ?? tenant?.monthlyPrice ?? 0;
      setType(mode === 'superadmin' && currentKind === 'free' ? 'free' : 'paid');
      setAmount(price > 0 ? String(Math.round(price * 100) / 100).replace('.', ',') : '');
      setUntil(null);
      setDays('');
      setCreditManager(false);
      setDatePickerOpen(false);
    }
    wasVisible.current = visible;
  }, [visible, mode, currentKind, planPrice, tenant?.monthlyPrice]);

  // Менеджер: его доля и лимит пробного — из сводки (она же кормит обзор, кэш общий).
  const { data: summary } = useQuery<ManagerSummary>({
    queryKey: ['manager', 'summary'],
    queryFn: async () => (await managerApi.summary()).data,
    enabled: visible && mode === 'manager',
    placeholderData: (prev) => prev,
  });

  // Суперадмин: процент менеджера клиента — из списка менеджеров.
  const hasManager = mode === 'superadmin' && !!tenant?.managerId;
  const { data: managers } = useQuery<PlatformManager[]>({
    queryKey: ['admin-managers', 'list'],
    queryFn: async () => (await adminManagersApi.list()).data,
    enabled: visible && hasManager,
    placeholderData: (prev) => prev,
  });
  const clientManager = managers?.find((m) => m.id === tenant?.managerId);

  const maxFree = Math.max(1, Math.floor(summary?.maxFreeDays ?? 30));
  const trialPresets = React.useMemo(
    () => Array.from(new Set(TRIAL_DAY_PRESETS.map((d) => Math.min(d, maxFree)))),
    [maxFree],
  );

  const mutation = useMutation({
    mutationFn: async (req: ExtendSubscriptionRequest) =>
      mode === 'manager'
        ? (await managerApi.extend(tenantId, req)).data
        : (await tenantsApi.extend(tenantId, req)).data,
    onSuccess: () => {
      haptic('success');
      invalidatePlatformQueries(queryClient, tenantId);
      onClose();
      onDone?.();
    },
    onError: (err) => {
      haptic('error');
      Alert.alert('Ошибка', extractApiErrorMessage(err, 'Не удалось продлить подписку'));
    },
  });

  const amountNum = parseAmount(amount) ?? Number.NaN;
  const paid = type === 'paid';
  const shareOn = paid && (mode === 'manager' || (hasManager && creditManager));
  const sharePercent = mode === 'manager' ? summary?.ownerSharePercent : clientManager?.ownerSharePercent;
  const shareAmount =
    shareOn && sharePercent != null && Number.isFinite(amountNum) && amountNum > 0
      ? computeOwnerShare(amountNum, sharePercent)
      : null;

  const applyPreset = (presetDays: number) => {
    haptic('select');
    setUntil(endOfDay(new Date(anchorFrom(subscriptionEnd).getTime() + presetDays * DAY_MS)));
  };

  const submit = () => {
    if (!tenant) return;
    if (paid) {
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        haptic('error');
        Alert.alert('Укажите сумму', 'Для платного продления введите сумму больше нуля.');
        return;
      }
    }
    // Пробный доступ менеджера задаётся днями (сервер не принимает `until`), остальное — датой.
    if (mode === 'manager' && !paid) {
      const n = Math.floor(Number(days));
      if (!Number.isFinite(n) || n < 1) {
        haptic('error');
        Alert.alert('Укажите срок', 'Введите, на сколько дней выдать пробный доступ.');
        return;
      }
      if (n > maxFree) {
        haptic('error');
        Alert.alert('Слишком много дней', `Пробный доступ — не больше ${maxFree} дн. за одно продление.`);
        return;
      }
      mutation.mutate({ type: 'free', days: n });
      return;
    }
    if (!until) {
      haptic('error');
      Alert.alert('Укажите дату', 'Выберите дату, до которой продлить подписку.');
      return;
    }
    const end = endOfDay(until);
    if (end.getTime() <= Date.now()) {
      haptic('error');
      Alert.alert('Неверная дата', 'Дата окончания должна быть в будущем.');
      return;
    }
    if (paid) {
      mutation.mutate({
        type: 'paid',
        amount: amountNum,
        until: end.toISOString(),
        ...(hasManager && creditManager ? { creditManager: true } : {}),
      });
    } else {
      mutation.mutate({ type: 'free', until: end.toISOString() });
    }
  };

  if (!tenant) return null;
  const expired = !!subscriptionEnd && isExpired(subscriptionEnd);
  const managerLabel = tenant.managerName ?? clientManager?.fullName ?? 'менеджер';

  return (
    <>
      <AdminSheet
        visible={visible}
        title="Продлить подписку"
        saveLabel="Продлить"
        saving={mutation.isPending}
        onClose={onClose}
        onSave={submit}
      >
        <View style={[styles.recap, surface.cardCompact]}>
          <Text style={[styles.recapLabel, { color: palette.text.tertiary }]}>Сейчас действует до</Text>
          <Text
            style={[styles.recapValue, { color: expired ? colors.red[600] : palette.text.primary }]}
            numberOfLines={1}
          >
            {formatFullDate(subscriptionEnd)}
          </Text>
        </View>

        <SheetLabel>Тип продления</SheetLabel>
        <SheetSegmented
          value={type}
          onChange={setType}
          options={[
            { value: 'paid', label: 'Платно', icon: 'card-outline' },
            { value: 'free', label: 'Бесплатно', icon: 'gift-outline' },
          ]}
        />

        {paid ? (
          <SheetInput
            label="Сумма, ₽"
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/[^0-9.,]/g, ''))}
            placeholder="0"
            keyboardType="decimal-pad"
            big
          />
        ) : null}

        {hasManager && paid ? (
          <SheetSwitchRow
            label={`Оплату получил менеджер ${managerLabel}${
              clientManager ? ` (доля ${formatPercent(clientManager.ownerSharePercent)})` : ''
            }`}
            value={creditManager}
            onValueChange={setCreditManager}
          />
        ) : null}

        {mode === 'manager' && !paid ? (
          <>
            <SheetLabel>Дней пробного доступа</SheetLabel>
            <SheetChips
              chips={trialPresets.map((d) => ({
                label: `${d} дн.`,
                active: days === String(d),
                onPress: () => {
                  haptic('select');
                  setDays(String(d));
                },
              }))}
            />
            <SheetInput
              value={days}
              onChangeText={(v) => setDays(v.replace(/[^0-9]/g, ''))}
              placeholder="Другое число дней"
              keyboardType="number-pad"
            />
          </>
        ) : (
          <>
            <SheetLabel>Продлить до</SheetLabel>
            <SheetChips chips={PAID_PRESETS.map((p) => ({ label: p.label, onPress: () => applyPreset(p.days) }))} />
            <Pressable
              onPress={() => {
                haptic('tap');
                setDatePickerOpen(true);
              }}
              style={[styles.dateRow, surface.cardCompact]}
            >
              <Ionicons name="calendar-outline" size={18} color={palette.text.secondary} />
              <Text style={[styles.dateValue, { color: until ? palette.text.primary : palette.text.tertiary }]}>
                {until ? formatFullDate(until.toISOString()) : 'Выбрать дату'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
            </Pressable>
          </>
        )}

        {shareOn && sharePercent != null ? (
          <SheetHint icon="wallet-outline" tint={colors.green[600]}>
            {shareAmount != null
              ? `Доля владельца: ${formatMoneyExact(shareAmount)} (${formatPercent(sharePercent)}) — запишется в ${
                  mode === 'manager' ? 'ваш долг владельцу' : `долг менеджера ${managerLabel}`
                }.`
              : `С оплаты ${formatPercent(sharePercent)} — доля владельца, она запишется в ${
                  mode === 'manager' ? 'ваш долг владельцу' : `долг менеджера ${managerLabel}`
                }.`}
          </SheetHint>
        ) : (
          <SheetHint
            icon={paid ? 'trending-up-outline' : 'information-circle-outline'}
            tint={paid ? colors.green[600] : undefined}
          >
            {paid
              ? 'Сумма попадёт в платную выручку от подписок.'
              : mode === 'manager'
                ? `Пробный доступ не считается оплатой и долга не создаёт. Не больше ${maxFree} дн. за одно продление.`
                : 'Бесплатное продление не учитывается как выручка.'}
          </SheetHint>
        )}
      </AdminSheet>

      {/* Пикер даты — соседняя модалка (проверенный паттерн), не вложенная. */}
      <DateTimePickerModal
        visible={visible && datePickerOpen}
        value={until ?? anchorFrom(subscriptionEnd)}
        mode="date"
        onConfirm={(d) => {
          setUntil(d);
          setDatePickerOpen(false);
        }}
        onCancel={() => setDatePickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  recap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginBottom: spacing[1],
  },
  recapLabel: { fontSize: 13, fontWeight: '500' },
  recapValue: { fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3.5],
    marginTop: spacing[2],
  },
  dateValue: { flex: 1, fontSize: 16, fontWeight: '600' },
});
