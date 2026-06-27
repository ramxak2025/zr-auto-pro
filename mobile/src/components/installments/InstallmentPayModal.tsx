/**
 * InstallmentPayModal — «Внести платёж» по рассрочке. Гибкое частичное
 * погашение: сумма (быстрая подстановка «Весь остаток»), необязательный
 * комментарий и необязательный перенос даты следующего платежа. Пишет через
 * `installmentsApi.pay`; при успехе инвалидирует все ключи рассрочки и отдаёт
 * обновлённый план родителю. Переиспользуется карточкой клиента и экраном
 * деталей плана.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Modal from '../Modal';
import DateTimePickerModal from '../DateTimePickerModal';
import { Text } from '../../platform/Typography';
import { installmentsApi } from '../../api/services';
import { useColors } from '../../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../../theme';
import { haptic } from '../../platform/haptics';
import { formatInstallmentMoney, toYmd, formatYmdHuman, ymdToDate } from './installmentUi';
import type { InstallmentPlan } from '../../../../shared/types';

interface InstallmentPayModalProps {
  visible: boolean;
  plan: InstallmentPlan | null;
  onClose: () => void;
  onPaid: (updated: InstallmentPlan) => void;
}

function parseAmount(text: string): number {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export default function InstallmentPayModal({ visible, plan, onClose, onPaid }: InstallmentPayModalProps) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [amountText, setAmountText] = useState('');
  const [comment, setComment] = useState('');
  const [rescheduleOn, setRescheduleOn] = useState(false);
  const [nextDate, setNextDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Reset form each time a (new) plan opens. Default the reschedule date to the
  // plan's current next-payment date when present, else +30 days.
  useEffect(() => {
    if (visible && plan) {
      setAmountText('');
      setComment('');
      setRescheduleOn(false);
      const base = plan.nextPaymentDate ? ymdToDate(plan.nextPaymentDate) : new Date(Date.now() + 30 * 86400000);
      setNextDate(base);
    }
  }, [visible, plan]);

  const remaining = plan?.remaining ?? 0;
  const parsed = useMemo(() => parseAmount(amountText), [amountText]);
  const amountValid = Number.isFinite(parsed) && parsed > 0;

  const payMutation = useMutation({
    mutationFn: (vars: { planId: string; amount: number; comment?: string; nextPaymentDate?: string }) =>
      installmentsApi.pay(vars.planId, {
        amount: vars.amount,
        comment: vars.comment,
        nextPaymentDate: vars.nextPaymentDate,
      }),
    onSuccess: (res) => {
      // Prefix-invalidate every installment query (list / client / widget / detail).
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      haptic('success');
      onPaid(res.data);
      onClose();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось внести платёж. Попробуйте ещё раз.');
    },
  });

  const submit = () => {
    if (!plan || !amountValid || payMutation.isPending) return;
    payMutation.mutate({
      planId: plan.id,
      amount: parsed,
      comment: comment.trim() ? comment.trim() : undefined,
      nextPaymentDate: rescheduleOn ? toYmd(nextDate) : undefined,
    });
  };

  return (
    <>
      <Modal visible={visible} onClose={onClose} title="Внести платёж">
        {plan ? (
          <View style={{ gap: spacing[1] }}>
            <View style={[styles.remainBanner, { backgroundColor: palette.bg.muted }]}>
              <Text style={[styles.remainLabel, { color: palette.text.tertiary }]}>Остаток по рассрочке</Text>
              <Text style={[styles.remainValue, { color: palette.text.primary }]}>
                {formatInstallmentMoney(remaining)}
              </Text>
            </View>

            <View style={styles.amountHeaderRow}>
              <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Сумма платежа, ₽</Text>
              {remaining > 0 ? (
                <TouchableOpacity
                  onPress={() => {
                    haptic('tap');
                    setAmountText(String(Math.round(remaining)));
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.fillAll, { color: palette.accent.primary }]}>Весь остаток</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
              ]}
              value={amountText}
              onChangeText={setAmountText}
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
              keyboardType="decimal-pad"
              autoFocus
              returnKeyType="done"
            />

            <Text style={[styles.fieldLabel, { color: palette.text.secondary, marginTop: spacing[3] }]}>
              Комментарий (необязательно)
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
              ]}
              value={comment}
              onChangeText={setComment}
              placeholder="Например: внесли наличными"
              placeholderTextColor={palette.text.tertiary}
              returnKeyType="done"
            />

            {/* Optional reschedule of the next payment date */}
            <TouchableOpacity
              style={[styles.rescheduleToggle, { borderColor: palette.border.subtle }]}
              activeOpacity={0.8}
              onPress={() => {
                haptic('tap');
                setRescheduleOn((v) => !v);
              }}
            >
              <Ionicons
                name={rescheduleOn ? 'checkbox' : 'square-outline'}
                size={20}
                color={rescheduleOn ? palette.accent.primary : palette.text.tertiary}
              />
              <Text style={[styles.rescheduleText, { color: palette.text.secondary }]}>
                Передвинуть дату следующего платежа
              </Text>
            </TouchableOpacity>
            {rescheduleOn ? (
              <TouchableOpacity
                style={[styles.dateBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                activeOpacity={0.8}
                onPress={() => {
                  haptic('tap');
                  setShowDatePicker(true);
                }}
              >
                <Ionicons name="calendar-outline" size={17} color={palette.accent.primary} />
                <Text style={[styles.dateBtnText, { color: palette.text.primary }]}>
                  {formatYmdHuman(toYmd(nextDate))}
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[
                styles.submitBtn,
                { backgroundColor: colors.green[600] },
                (!amountValid || payMutation.isPending) && styles.submitDisabled,
              ]}
              onPress={submit}
              disabled={!amountValid || payMutation.isPending}
              activeOpacity={0.85}
            >
              {payMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.submitText}>Внести платёж</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </Modal>

      <DateTimePickerModal
        visible={showDatePicker}
        value={nextDate}
        mode="date"
        onConfirm={(d) => {
          setNextDate(d);
          setShowDatePicker(false);
        }}
        onCancel={() => setShowDatePicker(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  remainBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    marginBottom: spacing[2],
  },
  remainLabel: { fontSize: 13, fontWeight: fontWeight.medium },
  remainValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, letterSpacing: -0.3 },

  amountHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: 13, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  fillAll: { fontSize: 13, fontWeight: fontWeight.semibold },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: 16,
  },

  rescheduleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    marginTop: spacing[3.5],
    paddingVertical: spacing[1],
  },
  rescheduleText: { fontSize: 14, fontWeight: fontWeight.medium, flex: 1 },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    marginTop: spacing[2],
  },
  dateBtnText: { fontSize: 15, fontWeight: fontWeight.semibold },

  submitBtn: {
    marginTop: spacing[4],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
});
