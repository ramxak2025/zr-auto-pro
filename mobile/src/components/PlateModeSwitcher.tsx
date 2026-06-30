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
}

export default function PlateModeSwitcher({ value, onChange }: Props) {
  const palette = useOptionalColors();
  const dark = palette.mode === 'dark';
  return (
    <View style={[styles.wrap, dark && { backgroundColor: palette.bg.muted }]}>
      <Segment
        active={value === 'ru'}
        label="RU"
        flag="🇷🇺"
        onPress={() => {
          if (value !== 'ru') {
            haptic('select');
            onChange('ru');
          }
        }}
      />
      <Segment
        active={value === 'foreign'}
        label="INT"
        icon="globe-outline"
        onPress={() => {
          if (value !== 'foreign') {
            haptic('select');
            onChange('foreign');
          }
        }}
      />
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
