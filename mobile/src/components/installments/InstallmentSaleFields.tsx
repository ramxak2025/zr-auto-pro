/**
 * InstallmentSaleFields — встроенный блок «Продажа в рассрочку» в кассе
 * (CheckCreateScreen). Показывается, когда выбран способ оплаты «Рассрочка».
 *
 * Новый чек: поля первого платежа (может быть 0) + дата следующего платежа.
 * Остаток (К оплате − первый платёж) уходит в долг по рассрочке — сам план
 * создаётся на сервере ВНУТРИ транзакции чека (клиент шлёт лишь метод + инфо
 * о первом платеже). Редактирование уже оформленного чека-рассрочки — read-only
 * баннер: платежами управляют в разделе «Рассрочка», а не здесь. Строки и
 * скидку при этом править МОЖНО (Round 13 #9) — сервер пересчитает план сам
 * (новый долг = новый итог − уже внесённые платежи), о чём баннер и говорит.
 *
 * Презентационный компонент: состояние (сумма, дата, открытие пикера) живёт у
 * родителя. Дата-пикер тоже рендерит родитель — здесь только кнопка-открывашка.
 */
import React from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import type { useColors } from '../../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../../theme';
import { formatInstallmentMoney } from './installmentUi';

interface InstallmentSaleFieldsProps {
  palette: ReturnType<typeof useColors>;
  /** «К оплате» итог чека. */
  total: number;
  /** Первый платёж (строка ввода). */
  firstPayment: string;
  onFirstPaymentChange: (text: string) => void;
  /** Остаток в рассрочку = total − первый платёж (≥ 0). */
  remaining: number;
  /** Человекочитаемая дата следующего платежа. */
  nextDateLabel: string;
  onOpenDatePicker: () => void;
  /** Режим редактирования уже сохранённого чека — read-only баннер. */
  readOnly?: boolean;
}

export default function InstallmentSaleFields({
  palette,
  total,
  firstPayment,
  onFirstPaymentChange,
  remaining,
  nextDateLabel,
  onOpenDatePicker,
  readOnly,
}: InstallmentSaleFieldsProps) {
  const amberFg = palette.mode === 'dark' ? colors.amber[200] : colors.amber[700];

  if (readOnly) {
    return (
      <View style={[styles.banner, { backgroundColor: softTint(colors.amber[600], palette.mode) }]}>
        <Ionicons name="card-outline" size={18} color={amberFg} />
        <Text style={[styles.bannerText, { color: amberFg }]}>
          Заказ-наряд оформлен в рассрочку. Платежи и график — в разделе «Рассрочка».
          {'\n'}Долг пересчитается автоматически: новый итог − уже внесённые платежи.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing[2.5] }}>
      <View style={[styles.banner, { backgroundColor: softTint(colors.amber[600], palette.mode) }]}>
        <Ionicons name="information-circle-outline" size={18} color={amberFg} />
        <Text style={[styles.bannerText, { color: amberFg }]}>
          Остаток уйдёт в долг по рассрочке. Клиент доплатит частями — отслеживайте в разделе «Рассрочка».
        </Text>
      </View>

      <View style={[styles.fieldsWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
        <View style={styles.fieldRow}>
          <View style={styles.fieldLabelRow}>
            <Ionicons name="cash-outline" size={16} color={colors.green[600]} />
            <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Первый платёж сейчас, ₽</Text>
          </View>
          <TextInput
            value={firstPayment}
            onChangeText={onFirstPaymentChange}
            style={[
              styles.fieldInput,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
            returnKeyType="done"
          />
        </View>

        <View style={[styles.fieldDivider, { backgroundColor: palette.border.subtle }]} />

        <View style={styles.fieldRow}>
          <View style={styles.fieldLabelRow}>
            <Ionicons name="card-outline" size={16} color={colors.amber[600]} />
            <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Остаток в рассрочку</Text>
          </View>
          <Text style={[styles.remainingValue, { color: remaining > 0 ? colors.amber[600] : colors.green[600] }]}>
            {formatInstallmentMoney(remaining)}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.dateBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        onPress={onOpenDatePicker}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Дата следующего платежа"
      >
        <Ionicons name="calendar-outline" size={17} color={palette.accent.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.dateHint, { color: palette.text.tertiary }]}>Следующий платёж</Text>
          <Text style={[styles.dateValue, { color: palette.text.primary }]} numberOfLines={1}>
            {nextDateLabel}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={palette.text.tertiary} />
      </TouchableOpacity>

      {/* Soft note: total recap so the owner sees the math at a glance. */}
      <Text style={[styles.totalNote, { color: palette.text.tertiary }]}>
        К оплате {formatInstallmentMoney(total)} · сейчас {formatInstallmentMoney(total - remaining)} · в рассрочку{' '}
        {formatInstallmentMoney(remaining)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  bannerText: { flex: 1, fontSize: 12.5, fontWeight: fontWeight.medium, lineHeight: 17 },

  fieldsWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[1],
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
  },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexShrink: 1 },
  fieldLabel: { fontSize: 14, fontWeight: fontWeight.medium },
  fieldInput: {
    minWidth: 110,
    textAlign: 'right',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    fontSize: 16,
    fontWeight: fontWeight.semibold,
  },
  fieldDivider: { height: StyleSheet.hairlineWidth },
  remainingValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, letterSpacing: -0.3 },

  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
  dateHint: { fontSize: 12, fontWeight: fontWeight.medium },
  dateValue: { fontSize: 15, fontWeight: fontWeight.semibold, marginTop: 1 },

  totalNote: { fontSize: 12, fontWeight: fontWeight.medium, textAlign: 'center', marginTop: spacing[0.5] },
});
