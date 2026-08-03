/**
 * RateByMonthSheet — смена ставки мастера «за месяц» + история ставок
 * (Round 14, миграция 150).
 *
 * Владелец выбирает месяц (прошлый / текущий / будущий) и новые проценты:
 *   • прошлый месяц — сервер пересчитает начисления ТОЛЬКО этого месяца
 *     новой ставкой (остальные месяцы не трогаются);
 *   • текущий — плюс обновится текущая ставка (новые чеки запекаются ею);
 *   • будущий — ставка зафиксируется и применится, когда месяц наступит.
 * Ниже — история ставок по месяцам (кто и когда менял).
 *
 * API: usersApi.setRate / usersApi.getRateHistory (гейт user_management).
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../api/services';
import Modal from '../Modal';
import { useColors } from '../../contexts/ThemeContext';
import { haptic } from '../../platform/haptics';
import { Text } from '../../platform/Typography';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../../theme';
import { addMonths, formatMonthKey, monthLabelFull, parseMonthKey } from '../salary/salaryFormat';
import type { UserRateHistoryEntry } from '../../../../shared/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  /** Текущие проценты из users — префилл полей. Из зарплатной карточки сюда
   *  приходят EFFECTIVE-проценты открытого месяца (getEmployeeMonth). */
  currentSalaryPercent: number;
  currentProductPercent: number;
  /**
   * Round 15 п.1 — вход из экрана «Зарплата»: месяц ЗАФИКСИРОВАН открытым в
   * пейджере карточки ('YYYY-MM'), переключатель месяца скрыт. Без пропа —
   * прежнее поведение (вход из Пользователей, свободный выбор месяца).
   */
  fixedMonth?: string;
}

export default function RateByMonthSheet({
  visible,
  onClose,
  userId,
  userName,
  currentSalaryPercent,
  currentProductPercent,
  fixedMonth,
}: Props) {
  const palette = useColors();
  const queryClient = useQueryClient();

  const [month, setMonth] = useState<Date>(() => parseMonthKey(fixedMonth));
  const [svcText, setSvcText] = useState(String(currentSalaryPercent));
  const [prodText, setProdText] = useState(String(currentProductPercent));

  // Каждое открытие — свежий старт от текущих значений; месяц — фиксированный
  // (вход из Зарплаты) либо текущий (вход из Пользователей).
  useEffect(() => {
    if (visible) {
      setMonth(parseMonthKey(fixedMonth));
      setSvcText(String(currentSalaryPercent));
      setProdText(String(currentProductPercent));
    }
  }, [visible, currentSalaryPercent, currentProductPercent, fixedMonth]);

  const monthKey = formatMonthKey(month);
  const currentKey = formatMonthKey(new Date());
  const isFuture = monthKey > currentKey;
  const isPast = monthKey < currentKey;

  const { data: history } = useQuery<UserRateHistoryEntry[]>({
    queryKey: ['user-rate-history', userId],
    queryFn: async () => (await usersApi.getRateHistory(userId)).data,
    enabled: visible,
  });

  const mutation = useMutation({
    mutationFn: (vars: { month: string; salaryPercent: number; productSalaryPercent: number }) =>
      usersApi.setRate(userId, vars),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: ['user-rate-history', userId] });
      // Сервер перепёк salary_amount И checks.profit месяца — устарели не
      // только зарплатные экраны, но и ВСЕ денежные отчёты (Round 15 п.1).
      queryClient.invalidateQueries({ queryKey: ['salary'] });
      queryClient.invalidateQueries({ queryKey: ['salary-my'] });
      queryClient.invalidateQueries({ queryKey: ['salary-employee-month'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['financial-report'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      queryClient.invalidateQueries({ queryKey: ['tag-analytics'] });
      Alert.alert(
        'Готово',
        isFuture
          ? `Ставка за ${monthLabelFull(month)} сохранена — применится, когда месяц наступит`
          : `Начисления и прибыль за ${monthLabelFull(month)} пересчитаны`,
      );
      onClose();
    },
    onError: (err: any) => {
      haptic('error');
      const msg = err?.response?.data?.message || 'Не удалось сохранить ставку';
      Alert.alert('Ошибка', String(Array.isArray(msg) ? msg.join('\n') : msg));
    },
  });

  const submit = () => {
    const svc = parseFloat(svcText.replace(',', '.'));
    const prod = parseFloat(prodText.replace(',', '.'));
    if (!Number.isFinite(svc) || svc < 0 || svc > 100 || !Number.isFinite(prod) || prod < 0 || prod > 100) {
      Alert.alert('Ошибка', 'Проценты — числа от 0 до 100');
      return;
    }
    mutation.mutate({ month: monthKey, salaryPercent: svc, productSalaryPercent: prod });
  };

  // Round 15 п.1 — предупреждение владельцу дословно про деньги: пересчёт
  // трогает начисления И ПРИБЫЛЬ ровно одного месяца.
  const warning = isPast
    ? `Пересчитает начисления И ПРИБЫЛЬ только за ${monthLabelFull(month)}. Другие месяцы не изменятся.`
    : isFuture
      ? `Ставка применится, когда наступит ${monthLabelFull(month)}. До этого действует текущая.`
      : `Изменит текущую ставку и пересчитает начисления и прибыль за ${monthLabelFull(month)}. Другие месяцы не изменятся.`;

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={fixedMonth ? `Процент за ${monthLabelFull(month)} — ${userName}` : `Ставка по месяцам — ${userName}`}
    >
      {fixedMonth ? null : (
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text.secondary }]}>Месяц</Text>
          <View style={[styles.monthRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
            <TouchableOpacity
              style={styles.monthBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => {
                haptic('select');
                setMonth((m) => addMonths(m, -1));
              }}
            >
              <Ionicons name="chevron-back" size={18} color={palette.text.secondary} />
            </TouchableOpacity>
            <Text style={[styles.monthLabel, { color: palette.text.primary }]}>{monthLabelFull(month)}</Text>
            <TouchableOpacity
              style={styles.monthBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => {
                haptic('select');
                setMonth((m) => addMonths(m, 1));
              }}
            >
              <Ionicons name="chevron-forward" size={18} color={palette.text.secondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: spacing[3] }}>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={[styles.label, { color: palette.text.secondary }]}>% от услуг</Text>
          <TextInput
            value={svcText}
            onChangeText={setSvcText}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={[styles.label, { color: palette.text.secondary }]}>% от товаров</Text>
          <TextInput
            value={prodText}
            onChangeText={setProdText}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
      </View>

      <View style={[styles.warnBox, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
        <Ionicons name="information-circle-outline" size={16} color={colors.amber[600]} />
        <Text style={[styles.warnText, { color: palette.text.secondary }]}>{warning}</Text>
      </View>

      <TouchableOpacity
        style={[styles.submit, { backgroundColor: palette.accent.primary }]}
        onPress={submit}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : (
          <Text style={styles.submitText}>Сохранить ставку</Text>
        )}
      </TouchableOpacity>

      {/* ── История ставок ──────────────────────────────────────────────── */}
      <Text style={[styles.historyTitle, { color: palette.text.secondary }]}>История ставок</Text>
      {(history ?? []).length === 0 ? (
        <Text style={[styles.historyEmpty, { color: palette.text.tertiary }]}>
          Ставка ещё не менялась — действует текущая ({currentSalaryPercent}% / {currentProductPercent}%)
        </Text>
      ) : (
        (history ?? []).map((h) => (
          <View key={h.id} style={[styles.historyRow, { borderColor: palette.border.subtle }]}>
            <Text style={[styles.historyMonth, { color: palette.text.primary }]}>
              {monthLabelFull(parseMonthKey(h.month))}
            </Text>
            <Text style={[styles.historyValue, { color: palette.text.secondary }]}>
              {h.salaryPercent ?? '—'}% услуги · {h.productSalaryPercent ?? '—'}% товары
            </Text>
            {h.creatorName ? (
              <Text style={[styles.historyBy, { color: palette.text.tertiary }]} numberOfLines={1}>
                {h.creatorName}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: spacing[4] },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
  },
  monthBtn: { padding: spacing[1.5] },
  monthLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[4],
  },
  warnText: { flex: 1, fontSize: fontSize.xs, lineHeight: 16 },
  submit: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[3],
    marginBottom: spacing[5],
  },
  submitText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
  historyTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing[2],
  },
  historyEmpty: { fontSize: fontSize.xs, marginBottom: spacing[2] },
  historyRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[2.5],
    gap: 2,
  },
  historyMonth: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },
  historyValue: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  historyBy: { fontSize: 11 },
});
