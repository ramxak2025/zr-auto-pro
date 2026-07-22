/**
 * InstallmentDetailScreen — детали одной рассрочки + гибкое погашение. Открыт
 * тапом по строке в InstallmentsScreen (план приходит параметром навигации для
 * мгновенного рендера). Свежие цифры и история платежей читаются из
 * `installmentsApi.clientLedger(clientId)` (план находится по id, платежи
 * фильтруются по planId).
 *
 * Действия (owner-class — director/admin/superadmin, как на сервере): «Внести
 * платёж» (частично, сколько угодно раз), «Перенести дату», «Погасить
 * полностью». На закрытой рассрочке действия скрыты.
 */
import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Share, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import SectionHeader from '../components/SectionHeader';
import AnimatedCard from '../components/AnimatedCard';
import DateTimePickerModal from '../components/DateTimePickerModal';
import InstallmentPayModal from '../components/installments/InstallmentPayModal';
import { Text } from '../platform/Typography';
import {
  formatInstallmentMoney,
  formatYmdHuman,
  dueLabel,
  statusChip,
  remainingColor,
  toYmd,
  ymdToDate,
  buildReminderText,
  telHref,
  whatsappHref,
} from '../components/installments/installmentUi';
import { installmentsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import { formatPhone } from '../../../shared/validation/phone';
import type { InstallmentPlan, InstallmentClientLedger, InstallmentReminderSettings } from '../../../shared/types';

function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatYmdHuman(toYmd(d))}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function InstallmentDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  const initialPlan: InstallmentPlan = route.params?.plan;
  const planId = initialPlan?.id;
  const clientId = initialPlan?.clientId;

  // Приём платежа / досрочное погашение / правка плана — debts_manage
  // (сервер: POST :planId/pay, payoff, PATCH → тот же ключ).
  const canManage = hasPermission('debts_manage');

  const [showPay, setShowPay] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Fresh plan + payment ledger for this client. Find this plan by id; until it
  // arrives, render from the nav-param plan (instant, no flicker).
  const { data: ledger } = useQuery<InstallmentClientLedger>({
    queryKey: ['installments', 'client', clientId],
    queryFn: async () => (await installmentsApi.clientLedger(clientId)).data,
    enabled: !!clientId,
  });

  // Reminder settings — only owner-class may read them (server-gated). When the
  // tenant runs reminders in MANUAL mode, we surface per-plan contact actions
  // («Скопировать» / «Открыть WhatsApp» / «Позвонить») below.
  const { data: reminderSettings } = useQuery<InstallmentReminderSettings>({
    queryKey: ['installments', 'reminder-settings'],
    queryFn: async () => (await installmentsApi.getReminderSettings()).data,
    enabled: canManage,
    staleTime: 5 * 60 * 1000,
  });

  const plan: InstallmentPlan = useMemo(() => {
    const fresh = ledger?.plans?.find((p) => p.id === planId);
    return fresh ?? initialPlan;
  }, [ledger, planId, initialPlan]);

  const payments = useMemo(() => (ledger?.payments ?? []).filter((p) => p.planId === planId), [ledger, planId]);

  const updateMutation = useMutation({
    mutationFn: (vars: { nextPaymentDate?: string; comment?: string }) => installmentsApi.update(planId, vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      haptic('success');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось перенести дату');
    },
  });

  const payoffMutation = useMutation({
    // Способ оплаты (119) пробрасывается на бэкенд, чтобы погашение легло в
    // кассу принявшего (нал/карта). Дефолта тут нет — выбор в самом алерте.
    mutationFn: (method: 'cash' | 'card') => installmentsApi.payoff(planId, { method }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      haptic('success');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось погасить рассрочку');
    },
  });

  const confirmPayoff = () => {
    haptic('tap');
    Alert.alert(
      'Погасить полностью?',
      `Остаток ${formatInstallmentMoney(plan.remaining)} будет погашен, рассрочка закроется. Как приняты деньги?`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Картой', style: 'default', onPress: () => payoffMutation.mutate('card') },
        { text: 'Наличными', style: 'default', onPress: () => payoffMutation.mutate('cash') },
      ],
    );
  };

  // ── Ручное напоминание (mode === 'manual') ────────────────────────────────
  // «Скопировать» — системный share-лист с готовым текстом (в проекте нет
  // expo-clipboard); «Открыть WhatsApp» — чат БЕЗ предзаполненного текста
  // (владелец вставит скопированное сам); «Позвонить» — системный набор.
  const manualReminders = reminderSettings?.mode === 'manual';
  const onCopyReminder = () => {
    haptic('tap');
    Share.share({ message: buildReminderText(reminderSettings?.template, plan) }).catch(() => {});
  };
  const onWhatsApp = () => {
    if (!plan.clientPhone) return;
    haptic('tap');
    Linking.openURL(whatsappHref(plan.clientPhone)).catch(() =>
      Alert.alert('WhatsApp', 'Не удалось открыть WhatsApp.'),
    );
  };
  const onCallClient = () => {
    if (!plan.clientPhone) return;
    haptic('tap');
    Linking.openURL(telHref(plan.clientPhone)).catch(() => Alert.alert('Звонок', 'Не удалось открыть телефон.'));
  };

  if (!initialPlan) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Рассрочка" onBack={() => navigation.goBack()} centerTitle />
      </View>
    );
  }

  const chip = statusChip(plan, palette.mode);
  const remColor = remainingColor(plan);
  const closed = plan.status === 'closed';
  const due = dueLabel(plan);
  const busy = payoffMutation.isPending || updateMutation.isPending;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={plan.checkNumber ? `Заказ-наряд №${plan.checkNumber}` : 'Рассрочка'}
        subtitle={plan.clientName || undefined}
        onBack={() => navigation.goBack()}
        centerTitle
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[6] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary card */}
        <AnimatedCard
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          index={0}
        >
          <View style={styles.summaryTop}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.summaryHint, { color: palette.text.tertiary }]}>
                {closed ? 'Погашено' : 'Остаток'}
              </Text>
              <Text style={[styles.summaryRemaining, { color: remColor }]} numberOfLines={1} adjustsFontSizeToFit>
                {formatInstallmentMoney(closed ? plan.total : plan.remaining)}
              </Text>
            </View>
            <View style={[styles.chip, { backgroundColor: chip.bg }]}>
              <Text style={[styles.chipText, { color: chip.text }]}>{chip.label}</Text>
            </View>
          </View>

          {/* paid / total progress */}
          <View style={[styles.track, { backgroundColor: palette.bg.muted }]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${plan.total > 0 ? Math.max(0, Math.min(1, plan.paid / plan.total)) * 100 : closed ? 100 : 0}%`,
                  backgroundColor: closed ? colors.green[600] : remColor,
                },
              ]}
            />
          </View>

          <View style={styles.statsRow}>
            <Stat label="Сумма" value={formatInstallmentMoney(plan.total)} palette={palette} />
            <Stat
              label="Внесено"
              value={formatInstallmentMoney(plan.paid)}
              palette={palette}
              valueColor={colors.green[600]}
            />
            <Stat
              label="Остаток"
              value={formatInstallmentMoney(plan.remaining)}
              palette={palette}
              valueColor={closed ? palette.text.secondary : remColor}
            />
          </View>

          {!closed && due ? (
            <View style={[styles.dueRow, { borderTopColor: palette.border.subtle }]}>
              <Ionicons
                name={plan.overdue ? 'alert-circle' : 'calendar-outline'}
                size={16}
                color={plan.overdue ? colors.red[600] : palette.text.secondary}
              />
              <Text style={[styles.dueText, { color: plan.overdue ? colors.red[600] : palette.text.secondary }]}>
                {due}
                {plan.nextPaymentDate ? ` · ${formatYmdHuman(plan.nextPaymentDate)}` : ''}
              </Text>
            </View>
          ) : null}

          {plan.clientPhone ? (
            <View style={[styles.metaLine, { borderTopColor: palette.border.subtle }]}>
              <Ionicons name="call-outline" size={15} color={palette.text.tertiary} />
              <Text style={[styles.metaText, { color: palette.text.secondary }]}>{formatPhone(plan.clientPhone)}</Text>
            </View>
          ) : null}
          {plan.comment ? (
            <View style={[styles.metaLine, { borderTopColor: palette.border.subtle }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={palette.text.tertiary} />
              <Text style={[styles.metaText, { color: palette.text.secondary }]}>{plan.comment}</Text>
            </View>
          ) : null}
        </AnimatedCard>

        {/* Actions — owner-class, hidden when closed. */}
        {canManage && !closed ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.green[600] }]}
              activeOpacity={0.85}
              onPress={() => {
                haptic('tap');
                setShowPay(true);
              }}
              disabled={busy}
            >
              <Ionicons name="add-circle-outline" size={19} color={colors.white} />
              <Text style={styles.primaryBtnText}>Внести платёж</Text>
            </TouchableOpacity>
            <View style={styles.secondaryRow}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                activeOpacity={0.8}
                onPress={() => {
                  haptic('tap');
                  setShowDatePicker(true);
                }}
                disabled={busy}
              >
                <Ionicons name="calendar-outline" size={17} color={palette.accent.primary} />
                <Text style={[styles.secondaryBtnText, { color: palette.text.primary }]}>Перенести дату</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: softTint(colors.green[600], palette.mode), borderColor: 'transparent' },
                ]}
                activeOpacity={0.8}
                onPress={confirmPayoff}
                disabled={busy}
              >
                {payoffMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.green[600]} />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-done"
                      size={17}
                      color={palette.mode === 'dark' ? colors.green[300] : colors.green[700]}
                    />
                    <Text
                      style={[
                        styles.secondaryBtnText,
                        { color: palette.mode === 'dark' ? colors.green[300] : colors.green[700] },
                      ]}
                    >
                      Погасить
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Ручное напоминание — только в manual-режиме, для открытой рассрочки. */}
        {manualReminders && canManage && !closed ? (
          <>
            <SectionHeader title="Напоминание клиенту" />
            <AnimatedCard
              style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              index={1}
            >
              <Text style={[styles.reminderHint, { color: palette.text.secondary }]}>
                Скопируйте готовый текст и отправьте клиенту в WhatsApp или позвоните.
              </Text>
              <View style={styles.reminderRow}>
                <TouchableOpacity
                  style={[
                    styles.reminderBtn,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  ]}
                  activeOpacity={0.8}
                  onPress={onCopyReminder}
                >
                  <Ionicons name="copy-outline" size={17} color={palette.accent.primary} />
                  <Text style={[styles.reminderBtnText, { color: palette.text.primary }]}>Скопировать</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.reminderBtn,
                    { backgroundColor: softTint(colors.green[600], palette.mode), borderColor: 'transparent' },
                  ]}
                  activeOpacity={0.8}
                  onPress={onWhatsApp}
                  disabled={!plan.clientPhone}
                >
                  <Ionicons
                    name="logo-whatsapp"
                    size={17}
                    color={plan.clientPhone ? '#25D366' : palette.text.tertiary}
                  />
                  <Text
                    style={[
                      styles.reminderBtnText,
                      { color: plan.clientPhone ? palette.text.primary : palette.text.tertiary },
                    ]}
                  >
                    WhatsApp
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.reminderBtn,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  ]}
                  activeOpacity={0.8}
                  onPress={onCallClient}
                  disabled={!plan.clientPhone}
                >
                  <Ionicons
                    name="call-outline"
                    size={17}
                    color={plan.clientPhone ? colors.green[600] : palette.text.tertiary}
                  />
                  <Text
                    style={[
                      styles.reminderBtnText,
                      { color: plan.clientPhone ? palette.text.primary : palette.text.tertiary },
                    ]}
                  >
                    Позвонить
                  </Text>
                </TouchableOpacity>
              </View>
            </AnimatedCard>
          </>
        ) : null}

        {/* Payment history */}
        <SectionHeader title="История платежей" count={payments.length || undefined} />
        <AnimatedCard
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          index={1}
        >
          {plan.downPayment > 0 ? (
            <View style={[styles.payRow, { borderBottomColor: palette.border.subtle }]}>
              <View style={[styles.payIcon, { backgroundColor: softTint(colors.blue[600], palette.mode) }]}>
                <Ionicons
                  name="wallet-outline"
                  size={15}
                  color={palette.mode === 'dark' ? colors.blue[300] : colors.blue[600]}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.payName, { color: palette.text.primary }]}>Первый взнос</Text>
                <Text style={[styles.payMeta, { color: palette.text.tertiary }]}>{formatDateTime(plan.createdAt)}</Text>
              </View>
              <Text style={[styles.payAmount, { color: colors.green[600] }]}>
                +{formatInstallmentMoney(plan.downPayment)}
              </Text>
            </View>
          ) : null}
          {payments.length > 0 ? (
            payments.map((p, i) => (
              <View
                key={p.id}
                style={[
                  styles.payRow,
                  i < payments.length - 1 ? { borderBottomColor: palette.border.subtle } : { borderBottomWidth: 0 },
                ]}
              >
                <View style={[styles.payIcon, { backgroundColor: softTint(colors.green[600], palette.mode) }]}>
                  <Ionicons
                    name="cash-outline"
                    size={15}
                    color={palette.mode === 'dark' ? colors.green[300] : colors.green[600]}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.payName, { color: palette.text.primary }]} numberOfLines={1}>
                    {p.comment || 'Платёж'}
                  </Text>
                  <Text style={[styles.payMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                    {[formatDateTime(p.paidAt), p.createdByName].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={[styles.payAmount, { color: colors.green[600] }]}>
                  +{formatInstallmentMoney(p.amount)}
                </Text>
              </View>
            ))
          ) : plan.downPayment > 0 ? null : (
            <Text style={[styles.emptyPay, { color: palette.text.tertiary }]}>Платежей пока не было</Text>
          )}
        </AnimatedCard>
      </ScrollView>

      <InstallmentPayModal visible={showPay} plan={plan} onClose={() => setShowPay(false)} onPaid={() => {}} />

      <DateTimePickerModal
        visible={showDatePicker}
        value={plan.nextPaymentDate ? ymdToDate(plan.nextPaymentDate) : new Date()}
        mode="date"
        onConfirm={(d) => {
          setShowDatePicker(false);
          updateMutation.mutate({ nextPaymentDate: toYmd(d) });
        }}
        onCancel={() => setShowDatePicker(false)}
      />
    </View>
  );
}

function Stat({
  label,
  value,
  palette,
  valueColor,
}: {
  label: string;
  value: string;
  palette: ReturnType<typeof useColors>;
  valueColor?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: palette.text.tertiary }]}>{label}</Text>
      <Text
        style={[styles.statValue, { color: valueColor ?? palette.text.primary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
    marginBottom: spacing[3],
  },

  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  summaryHint: { fontSize: 12.5, fontWeight: fontWeight.medium },
  summaryRemaining: { fontSize: 30, fontWeight: fontWeight.bold, letterSpacing: -0.8, marginTop: 2 },
  chip: { paddingHorizontal: spacing[2.5], paddingVertical: 4, borderRadius: borderRadius.full },
  chipText: { fontSize: 11.5, fontWeight: fontWeight.bold, letterSpacing: 0.1 },

  track: { height: 6, borderRadius: 3, marginTop: spacing[3.5], overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },

  statsRow: { flexDirection: 'row', marginTop: spacing[3.5], gap: spacing[2] },
  stat: { flex: 1, gap: 3 },
  statLabel: { fontSize: 11.5, fontWeight: fontWeight.medium },
  statValue: { fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: -0.3 },

  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3.5],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dueText: { fontSize: 13.5, fontWeight: fontWeight.semibold, flex: 1 },

  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metaText: { fontSize: 14, flex: 1 },

  actions: { marginBottom: spacing[4], gap: spacing[2.5] },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
  },
  primaryBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  secondaryRow: { flexDirection: 'row', gap: spacing[2.5] },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[3],
  },
  secondaryBtnText: { fontSize: 13.5, fontWeight: fontWeight.semibold },

  reminderHint: { fontSize: 13.5, lineHeight: 19, marginBottom: spacing[3] },
  reminderRow: { flexDirection: 'row', gap: spacing[2] },
  reminderBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1],
  },
  reminderBtnText: { fontSize: 12.5, fontWeight: fontWeight.semibold },

  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  payIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  payName: { fontSize: 14, fontWeight: fontWeight.semibold },
  payMeta: { fontSize: 12, marginTop: 2 },
  payAmount: { fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: -0.2 },
  emptyPay: { fontSize: 13, textAlign: 'center', paddingVertical: spacing[2] },
});
