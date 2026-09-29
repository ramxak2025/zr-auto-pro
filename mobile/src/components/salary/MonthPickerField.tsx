/**
 * MonthPickerField — строка «За какой месяц — Сентябрь 2026» с выбором прямо в форме.
 *
 * Тап раскрывает сетку месяцев (текущий + 12 назад) тут же, а не вторым RN-Modal:
 * формы выплаты и расхода сами живут в Modal, а вложенные модалы на iOS ведут себя
 * непредсказуемо (та же причина, что в CheckCreateScreen и ProductPickerModal).
 * Анимаций нет — Reduce Motion соблюдается сам собой.
 *
 * Общий для выплаты зарплаты (карточка сотрудника, быстрое «Выдать») и для формы
 * расхода: там месяц необязателен (`nullLabel` — «По дате оплаты») и бывает
 * только для чтения (`disabled` — расход-зеркало выплаты, месяц задаёт сама выплата).
 */
import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Keyboard, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { borderRadius, fontSize, fontWeight, spacing } from '../../theme';
import type { SemanticPalette } from '../../theme/palette';
import { monthKeyLabel, recentMonthOptions } from './salaryFormat';

export interface MonthPickerFieldProps {
  palette: SemanticPalette;
  /** 'YYYY-MM'; null — месяц не назначен (только вместе с `nullLabel`). */
  value: string | null;
  onChange: (key: string | null) => void;
  label?: string;
  /** Пункт «не назначен» (расход: «По дате оплаты»). Без него значение обязательно. */
  nullLabel?: string;
  /** Только чтение: значение и подсказка видны, список не раскрывается. */
  disabled?: boolean;
  /** Пояснение под полем. */
  hint?: string;
  style?: StyleProp<ViewStyle>;
}

function MonthChip({
  label,
  selected,
  wide = false,
  palette,
  onPress,
}: {
  label: string;
  selected: boolean;
  wide?: boolean;
  palette: SemanticPalette;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={[
        styles.chip,
        wide ? styles.chipWide : null,
        selected
          ? { backgroundColor: palette.accent.primarySoft, borderColor: palette.accent.primary }
          : { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: selected ? palette.accent.primaryText : palette.text.primary },
          selected ? styles.chipTextSelected : null,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {selected ? <Ionicons name="checkmark" size={14} color={palette.accent.primaryText} /> : null}
    </TouchableOpacity>
  );
}

export default function MonthPickerField({
  palette,
  value,
  onChange,
  label = 'За какой месяц',
  nullLabel,
  disabled = false,
  hint,
  style,
}: MonthPickerFieldProps) {
  const [open, setOpen] = useState(false);
  // Выбранный месяц старше окна в 13 месяцев (открыт давний месяц) всё равно остаётся в списке.
  const options = useMemo(() => recentMonthOptions(13, new Date(), [value]), [value]);
  const isOpen = open && !disabled;

  const select = (key: string | null) => {
    haptic('select');
    onChange(key);
    setOpen(false);
  };

  const toggle = () => {
    haptic('select');
    // Цифровая клавиатура поля суммы закрыла бы нижние месяцы сетки.
    if (!isOpen) Keyboard.dismiss();
    setOpen(!isOpen);
  };

  const valueText = value ? monthKeyLabel(value) : (nullLabel ?? '');

  const header = (
    <View style={styles.header}>
      <Ionicons name="calendar-outline" size={16} color={palette.text.tertiary} />
      <Text style={[styles.label, { color: palette.text.secondary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { color: palette.text.primary }]} numberOfLines={1}>
        {valueText}
      </Text>
      <Ionicons
        name={disabled ? 'lock-closed-outline' : isOpen ? 'chevron-up' : 'chevron-down'}
        size={14}
        color={palette.text.tertiary}
      />
    </View>
  );

  return (
    <View style={style}>
      <View style={[styles.box, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
        {disabled ? (
          header
        ) : (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${valueText}`}
            accessibilityState={{ expanded: isOpen }}
          >
            {header}
          </TouchableOpacity>
        )}
        {isOpen ? (
          <View style={[styles.grid, { borderTopColor: palette.border.subtle }]}>
            {nullLabel ? (
              <MonthChip
                label={nullLabel}
                selected={value === null}
                wide
                palette={palette}
                onPress={() => select(null)}
              />
            ) : null}
            {options.map((o) => (
              <MonthChip
                key={o.key}
                label={o.label}
                selected={o.key === value}
                palette={palette}
                onPress={() => select(o.key)}
              />
            ))}
          </View>
        ) : null}
      </View>
      {hint ? <Text style={[styles.hint, { color: palette.text.tertiary }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 44,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  value: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, textAlign: 'right' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing[1.5],
    padding: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    minHeight: 38,
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipWide: { width: '100%' },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  chipTextSelected: { fontWeight: fontWeight.semibold },
  hint: { fontSize: fontSize.xs, marginTop: spacing[1] },
});
