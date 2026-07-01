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
}

export default function PlateModeSwitcher({ value, onChange, phoneActive = false, onPhoneSelect }: Props) {
  const palette = useOptionalColors();
  const dark = palette.mode === 'dark';
  return (
    <View style={[styles.wrap, dark && { backgroundColor: palette.bg.muted }]}>
      <Segment
        active={!phoneActive && value === 'ru'}
        label="RU"
        flag="🇷🇺"
        onPress={() => {
          if (value !== 'ru' || phoneActive) {
            haptic('select');
            onChange('ru');
          }
        }}
      />
      <Segment
        active={!phoneActive && value === 'foreign'}
        label="INT"
        icon="globe-outline"
        onPress={() => {
          if (value !== 'foreign' || phoneActive) {
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
          onPress={() => {
            if (!phoneActive) {
              haptic('select');
              onPhoneSelect();
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
  onPress: () => void;
}

function Segment({ active, label, flag, icon, onPress }: SegmentProps) {
  const palette = useOptionalColors();
  const dark = palette.mode === 'dark';
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segment, active && styles.segmentActive, active && dark && { backgroundColor: palette.bg.card }]}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
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
