/**
 * PlateModeSwitcher — RU 🇷🇺 / INT 🌐 segmented toggle.
 *
 * Pure controlled component. Sits above a <RussianPlateInput> and lets the
 * user explicitly choose how their license-plate input is interpreted:
 *
 *   - 'ru'      → Russian mask (А 123 АА | 77), Latin auto-converts to Cyrillic
 *   - 'foreign' → free-text uppercase, no Cyrillic conversion
 *
 * Why explicit instead of auto-detect: auto-detect on first character broke
 * for users who started with a digit (foreign-mode latched) and confused
 * users who didn't realize a switch had happened.
 */
import React from 'react';
import { Pressable, StyleSheet, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useOptionalColors } from '../contexts/ThemeContext';
import { colors, spacing, borderRadius, fontWeight } from '../theme';

export type PlateMode = 'ru' | 'foreign';

interface Props {
  value: PlateMode;
  onChange: (mode: PlateMode) => void;
  /**
   * Optional third segment «ТЕЛ» — явный поиск по телефону (Касса, Round 7 #8).
   * Both props must be provided together; when omitted the switcher renders
   * the classic two-segment RU/INT control byte-for-byte (Клиенты,
   * QuickClientCreateSheet, CarPlateField consumers are untouched).
   *
   * While `phoneActive` is true the RU/INT segments render inactive; tapping
   * either one re-selects the plate target (fires `onChange` even when the
   * underlying plate mode didn't change, so the parent can exit phone mode).
   */
  phoneActive?: boolean;
  onPhoneSelect?: () => void;
  /**
   * Optional fourth segment «VIN» (171, 2026-09-25) — поиск клиента по VIN в
   * Кассе. Рендерится ТОЛЬКО когда опция тенанта включена (родитель передаёт
   * `onVinSelect` только при `useVinEnabled()`); без пропа переключатель
   * байт-в-байт прежний трёхсегментный. Требует `onPhoneSelect` (Касса).
   *
   * Четыре сегмента на узких iPhone (SE/mini): режим `dense` — сегменты ещё
   * уже (minWidth 56, паддинг spacing[1.5], подпись 11pt), сумма ≈ 245pt,
   * поэтому в Кассе четырёхсегментный переключатель стоит на своей строке
   * ПОД подписью секции, а не рядом с ней (см. CheckCreateScreen).
   */
  vinActive?: boolean;
  onVinSelect?: () => void;
}

export default function PlateModeSwitcher({
  value,
  onChange,
  phoneActive = false,
  onPhoneSelect,
  vinActive = false,
  onVinSelect,
}: Props) {
  const palette = useOptionalColors();
  const dark = palette.mode === 'dark';
  // Три сегмента (Касса, RU|INT|ТЕЛ) на узких iPhone (SE/mini) не влезали в
  // строку с подписью секции и неаккуратно уезжали вправо: 3 × minWidth 64 +
  // отступы ≈ 210pt. В компактном режиме сегменты уже (minWidth 50, паддинг
  // меньше) и весь переключатель может ужиматься. Классические двухсегментные
  // потребители (Клиенты, QuickClientCreateSheet, CarPlateField) рендерятся
  // байт-в-байт как раньше.
  const compact = !!onPhoneSelect;
  const dense = !!onVinSelect;
  // Пока активен телефон или VIN, плашечные сегменты RU/INT неактивны; тап по
  // любому из них возвращает поиск по номеру (onChange уходит даже без смены
  // самого режима плашки — родитель выходит из phone/vin-режима).
  const plateInactive = phoneActive || vinActive;
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, dark && { backgroundColor: palette.bg.muted }]}>
      <Segment
        active={!plateInactive && value === 'ru'}
        label="RU"
        flag="🇷🇺"
        compact={compact}
        dense={dense}
        onPress={() => {
          if (value !== 'ru' || plateInactive) {
            haptic('select');
            onChange('ru');
          }
        }}
      />
      <Segment
        active={!plateInactive && value === 'foreign'}
        label="INT"
        icon="globe-outline"
        compact={compact}
        dense={dense}
        onPress={() => {
          if (value !== 'foreign' || plateInactive) {
            haptic('select');
            onChange('foreign');
          }
        }}
      />
      {onPhoneSelect && (
        <Segment
          active={phoneActive}
          label="ТЕЛ"
          icon="call-outline"
          compact={compact}
          dense={dense}
          onPress={() => {
            if (!phoneActive) {
              haptic('select');
              onPhoneSelect();
            }
          }}
        />
      )}
      {onVinSelect && (
        <Segment
          active={vinActive}
          label="VIN"
          icon="barcode-outline"
          compact={compact}
          dense={dense}
          onPress={() => {
            if (!vinActive) {
              haptic('select');
              onVinSelect();
            }
          }}
        />
      )}
    </View>
  );
}

interface SegmentProps {
  active: boolean;
  label: string;
  flag?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  compact?: boolean;
  dense?: boolean;
  onPress: () => void;
}

function Segment({ active, label, flag, icon, compact = false, dense = false, onPress }: SegmentProps) {
  const palette = useOptionalColors();
  const dark = palette.mode === 'dark';
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.segment,
        compact && styles.segmentCompact,
        dense && styles.segmentDense,
        active && styles.segmentActive,
        active && dark && { backgroundColor: palette.bg.card },
      ]}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      {flag ? (
        <Text style={[styles.flag, !active && { opacity: 0.55 }]}>{flag}</Text>
      ) : icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={
            active
              ? dark
                ? palette.accent.primaryText
                : colors.primary[700]
              : dark
                ? palette.text.tertiary
                : colors.gray[500]
          }
        />
      ) : null}
      <Text
        style={[
          styles.label,
          dense && styles.labelDense,
          active ? styles.labelActive : styles.labelInactive,
          dark && (active ? { color: palette.accent.primaryText } : { color: palette.text.tertiary }),
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.lg,
    padding: 3,
    alignSelf: 'flex-start',
    gap: 2,
  },
  // Трёхсегментный режим: контейнер может ужиматься внутри строки с подписью
  // (сегменты сожмутся раньше, чем переключатель уедет за экран).
  wrapCompact: {
    flexShrink: 1,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.md,
    minWidth: 64,
    justifyContent: 'center',
  },
  segmentCompact: {
    minWidth: 50,
    paddingHorizontal: spacing[2],
    gap: 4,
    flexShrink: 1,
  },
  // Четырёхсегментный режим (RU|INT|ТЕЛ|VIN, 171): ещё уже, чтобы четыре
  // сегмента (≈ 4 × 56 + отступы ≈ 245pt) влезали на iPhone SE/mini.
  segmentDense: {
    minWidth: 56,
    paddingHorizontal: spacing[1.5],
    gap: 3,
  },
  labelDense: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
  segmentActive: {
    backgroundColor: colors.white,
    ...Platform.select({
      ios: {
        shadowColor: colors.black,
        shadowOpacity: 0.08,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
      },
      android: { elevation: 1 },
    }),
  },
  flag: {
    fontSize: 13,
  },
  label: {
    fontSize: 12,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  labelActive: {
    color: colors.primary[700],
  },
  labelInactive: {
    color: colors.gray[500],
  },
});
