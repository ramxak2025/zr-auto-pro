/**
 * ClientInstallmentSection — секция «Рассрочка» в карточке клиента
 * (ClientDetailScreen). Читает GET /installments/client/:id (сумма остатка +
 * планы + леджер платежей). Показывает общий остаток, список планов и быстрый
 * «Внести платёж» (переиспользует InstallmentPayModal). Self-hide: пока у
 * клиента нет ни одной рассрочки — секция не рендерится (нулевая стоимость).
 *
 * Запись (приём платежа) owner-class — гейт `canManage` здесь И на сервере.
 * Открытие модалки достаточно: InstallmentPayModal инвалидирует ['installments']
 * (включая этот ключ), поэтому остаток обновляется мгновенно без ручного onPaid.
 */
import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import SectionHeader from '../SectionHeader';
import AnimatedCard from '../AnimatedCard';
import { Text } from '../../platform/Typography';
import InstallmentPayModal from './InstallmentPayModal';
import { formatInstallmentMoney, dueLabel, statusChip, remainingColor } from './installmentUi';
import { installmentsApi } from '../../api/services';
import type { useColors } from '../../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../../theme';
import { haptic } from '../../platform/haptics';
import type { InstallmentClientLedger, InstallmentPlan } from '../../../../shared/types';

interface ClientInstallmentSectionProps {
  clientId: string;
  canManage: boolean;
  palette: ReturnType<typeof useColors>;
}

export default function ClientInstallmentSection({ clientId, canManage, palette }: ClientInstallmentSectionProps) {
  const [payPlan, setPayPlan] = useState<InstallmentPlan | null>(null);

  const { data: ledger } = useQuery<InstallmentClientLedger>({
    queryKey: ['installments', 'client', clientId],
    queryFn: async () => (await installmentsApi.clientLedger(clientId)).data,
    enabled: !!clientId,
  });

  const plans = ledger?.plans ?? [];
  // Self-hide entirely when the client has never had an installment plan.
  if (plans.length === 0) return null;

  const openPlans = plans.filter((p) => p.status === 'open');
  const totalRemaining = ledger?.totalRemaining ?? openPlans.reduce((s, p) => s + (p.remaining || 0), 0);
  const hasOutstanding = totalRemaining > 0;

  return (
    <>
      <SectionHeader title="Рассрочка" count={plans.length} />
      <AnimatedCard
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        index={2}
      >
        {/* Outstanding total header */}
        <View style={styles.balanceRow}>
          <View
            style={[
              styles.balanceIcon,
              {
                backgroundColor: hasOutstanding
                  ? softTint(colors.amber[600], palette.mode)
                  : softTint(colors.green[600], palette.mode),
              },
            ]}
          >
            <Ionicons
              name={hasOutstanding ? 'card' : 'checkmark-done'}
              size={18}
              color={
                hasOutstanding
                  ? palette.mode === 'dark'
                    ? colors.amber[200]
                    : colors.amber[600]
                  : palette.mode === 'dark'
                    ? colors.green[300]
                    : colors.green[600]
              }
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.balanceLabel, { color: palette.text.tertiary }]}>
              {hasOutstanding ? 'Остаток по рассрочке' : 'Рассрочка погашена'}
            </Text>
            <Text
              style={[styles.balanceValue, { color: hasOutstanding ? colors.amber[600] : colors.green[600] }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatInstallmentMoney(totalRemaining)}
            </Text>
          </View>
        </View>

        {/* Plan rows — open first (with «Внести платёж»), then closed. */}
        <View style={[styles.plansWrap, { borderTopColor: palette.border.subtle }]}>
          {plans.map((plan, i) => {
            const chip = statusChip(plan, palette.mode);
            const remColor = remainingColor(plan);
            const closed = plan.status === 'closed';
            const due = dueLabel(plan);
            return (
              <View
                key={plan.id}
                style={[
                  styles.planRow,
                  i < plans.length - 1 ? { borderBottomColor: palette.border.subtle } : { borderBottomWidth: 0 },
                ]}
              >
                <View style={styles.planTop}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.planTitle, { color: palette.text.primary }]} numberOfLines={1}>
                      {plan.checkNumber ? `Заказ-наряд №${plan.checkNumber}` : 'Рассрочка'}
                    </Text>
                    <View style={styles.planMetaRow}>
                      <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                        <Text style={[styles.chipText, { color: chip.text }]}>{chip.label}</Text>
                      </View>
                      {!closed && due ? (
                        <Text
                          style={[styles.due, { color: plan.overdue ? colors.red[600] : palette.text.tertiary }]}
                          numberOfLines={1}
                        >
                          {due}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.planAmountWrap}>
                    <Text style={[styles.planRemaining, { color: closed ? palette.text.tertiary : remColor }]}>
                      {closed ? 'Погашена' : formatInstallmentMoney(plan.remaining)}
                    </Text>
                    <Text style={[styles.planPaid, { color: palette.text.tertiary }]} numberOfLines={1}>
                      {formatInstallmentMoney(plan.paid)} из {formatInstallmentMoney(plan.total)}
                    </Text>
                  </View>
                </View>

                {canManage && !closed ? (
                  <TouchableOpacity
                    style={[styles.payBtn, { backgroundColor: softTint(colors.green[600], palette.mode) }]}
                    onPress={() => {
                      haptic('tap');
                      setPayPlan(plan);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={16}
                      color={palette.mode === 'dark' ? colors.green[300] : colors.green[600]}
                    />
                    <Text
                      style={[
                        styles.payBtnText,
                        { color: palette.mode === 'dark' ? colors.green[300] : colors.green[600] },
                      ]}
                    >
                      Внести платёж
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      </AnimatedCard>

      <InstallmentPayModal
        visible={payPlan !== null}
        plan={payPlan}
        onClose={() => setPayPlan(null)}
        onPaid={() => setPayPlan(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
  },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  balanceIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  balanceLabel: { fontSize: 12, fontWeight: fontWeight.medium },
  balanceValue: { fontSize: 22, fontWeight: fontWeight.bold, letterSpacing: -0.4, marginTop: 2 },

  plansWrap: { marginTop: spacing[3.5], borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing[1] },
  planRow: { paddingVertical: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth },
  planTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  planTitle: { fontSize: 14.5, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  planMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 4 },
  chip: { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: borderRadius.full },
  chipText: { fontSize: 11, fontWeight: fontWeight.bold, letterSpacing: 0.1 },
  due: { fontSize: 12, fontWeight: fontWeight.semibold, flexShrink: 1 },
  planAmountWrap: { alignItems: 'flex-end', maxWidth: 140, gap: 2 },
  planRemaining: { fontSize: fontSize.base, fontWeight: fontWeight.bold, letterSpacing: -0.3 },
  planPaid: { fontSize: 11.5, fontWeight: fontWeight.medium },

  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    marginTop: spacing[2.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  payBtnText: { fontSize: 13, fontWeight: fontWeight.semibold },
});
