/**
 * SettlementSheet — «Внести расчёт» с менеджером (только суперадмин). Баланс менеджера =
 * Σ доли владельца − Σ расчётов, поэтому:
 *   • «Передал владельцу» — сумма > 0, долг уменьшается;
 *   • «Корректировка» — сумма < 0, долг растёт на эту сумму, причина обязательна.
 * Знак «минус» на десятичной клавиатуре iOS недоступен, поэтому вводится всегда положительная
 * сумма, а знак задаёт переключатель. Баланс после операции считается локально — для подсказки.
 */
import React from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminManagersApi } from '../../api/services';
import DateTimePickerModal from '../../components/DateTimePickerModal';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { spacing } from '../../theme';
import { extractApiErrorMessage } from '../../utils/apiError';
import { toLocalISODate } from '../../utils/dates';
import type { CreateSettlementRequest } from '../../../../shared/api/types';
import { balanceColor, formatMoneyExact, invalidatePlatformQueries, parseAmount } from './adminShared';
import { formatIsoDay } from './LedgerFeed';
import { AdminSheet, SheetChips, SheetHint, SheetInput, SheetLabel, SheetSegmented } from './adminSheet';

type SettlementKind = 'paid' | 'adjust';

export interface SettlementTarget {
  id: string;
  fullName: string;
  /** Текущий баланс (> 0 — менеджер должен). */
  balance: number;
}

interface SettlementSheetProps {
  visible: boolean;
  manager: SettlementTarget | null;
  onClose: () => void;
  /** После успешной записи (кэши менеджеров уже сброшены). */
  onDone?: () => void;
}

export default function SettlementSheet({ visible, manager, onClose, onDone }: SettlementSheetProps) {
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const [kind, setKind] = React.useState<SettlementKind>('paid');
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState<Date>(() => new Date());
  const [note, setNote] = React.useState('');
  const [pickerOpen, setPickerOpen] = React.useState(false);

  // Чистая форма при каждом открытии; пока шторка открыта, ввод не трогаем.
  const wasVisible = React.useRef(false);
  React.useEffect(() => {
    if (visible && !wasVisible.current) {
      setKind('paid');
      setAmount('');
      setDate(new Date());
      setNote('');
      setPickerOpen(false);
    }
    wasVisible.current = visible;
  }, [visible]);

  const mutation = useMutation({
    mutationFn: async (req: CreateSettlementRequest) => (await adminManagersApi.addSettlement(manager!.id, req)).data,
    onSuccess: () => {
      haptic('success');
      invalidatePlatformQueries(queryClient);
      onClose();
      onDone?.();
    },
    onError: (err) => {
      haptic('error');
      Alert.alert('Не удалось записать расчёт', extractApiErrorMessage(err, 'Попробуйте ещё раз'));
    },
  });

  if (!manager) return null;

  const value = parseAmount(amount);
  const signed = value == null ? null : kind === 'paid' ? value : -value;
  const balanceAfter = signed == null ? null : Math.round((manager.balance - signed) * 100) / 100;
  const debt = manager.balance > 0.005 ? Math.round(manager.balance * 100) / 100 : 0;

  const submit = () => {
    if (value == null || signed == null) {
      haptic('error');
      Alert.alert('Укажите сумму', 'Введите сумму расчёта больше нуля.');
      return;
    }
    if (kind === 'adjust' && !note.trim()) {
      haptic('error');
      Alert.alert('Укажите причину', 'Для корректировки причина обязательна.');
      return;
    }
    mutation.mutate({
      amount: signed,
      settledOn: toLocalISODate(date),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <>
      <AdminSheet
        visible={visible}
        title="Внести расчёт"
        saveLabel="Записать"
        saving={mutation.isPending}
        onClose={onClose}
        onSave={submit}
      >
        <View style={[styles.recap, surface.cardCompact]}>
          <Text style={[styles.recapLabel, { color: palette.text.tertiary }]} numberOfLines={1}>
            Баланс · {manager.fullName}
          </Text>
          <Text style={[styles.recapValue, { color: balanceColor(manager.balance, palette) }]} numberOfLines={1}>
            {formatMoneyExact(manager.balance)}
          </Text>
        </View>

        <SheetLabel>Тип операции</SheetLabel>
        <SheetSegmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'paid', label: 'Передал владельцу', icon: 'cash-outline' },
            { value: 'adjust', label: 'Корректировка', icon: 'create-outline' },
          ]}
        />

        <SheetInput
          label="Сумма, ₽"
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/[^0-9.,]/g, ''))}
          placeholder="0"
          keyboardType="decimal-pad"
          big
        />
        {kind === 'paid' && debt > 0 ? (
          <SheetChips
            chips={[
              {
                label: `Весь долг · ${formatMoneyExact(debt)}`,
                active: value === debt,
                onPress: () => {
                  haptic('select');
                  setAmount(String(debt).replace('.', ','));
                },
              },
            ]}
          />
        ) : null}

        <SheetLabel>Дата расчёта</SheetLabel>
        <Pressable
          onPress={() => {
            haptic('tap');
            setPickerOpen(true);
          }}
          style={[styles.dateRow, surface.cardCompact]}
        >
          <Ionicons name="calendar-outline" size={18} color={palette.text.secondary} />
          <Text style={[styles.dateValue, { color: palette.text.primary }]}>{formatIsoDay(toLocalISODate(date))}</Text>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </Pressable>

        <SheetInput
          label={kind === 'adjust' ? 'Причина корректировки' : 'Комментарий'}
          value={note}
          onChangeText={setNote}
          placeholder={kind === 'adjust' ? 'Например: ошибочно записан расчёт' : 'Необязательно'}
          multiline
        />

        <SheetHint icon="wallet-outline">
          {balanceAfter == null
            ? kind === 'paid'
              ? 'Расчёт уменьшит долг менеджера владельцу.'
              : 'Корректировка увеличит долг менеджера на введённую сумму.'
            : balanceAfter < -0.005
              ? `Баланс станет ${formatMoneyExact(balanceAfter)}: владелец окажется должен менеджеру.`
              : `Баланс после ${kind === 'paid' ? 'расчёта' : 'корректировки'}: ${formatMoneyExact(balanceAfter)}.`}
        </SheetHint>
      </AdminSheet>

      {/* Пикер даты — соседняя модалка, не вложенная (тот же приём, что в продлении). */}
      <DateTimePickerModal
        visible={visible && pickerOpen}
        value={date}
        mode="date"
        onConfirm={(d) => {
          setDate(d);
          setPickerOpen(false);
        }}
        onCancel={() => setPickerOpen(false)}
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
  recapLabel: { flexShrink: 1, fontSize: 13, fontWeight: '500' },
  recapValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3.5],
  },
  dateValue: { flex: 1, fontSize: 16, fontWeight: '600' },
});
