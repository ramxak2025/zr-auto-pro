import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '../contexts/ThemeContext';
import { borderRadius, spacing } from '../theme';

export interface HubTabOption<Key extends string> {
  key: Key;
  label: string;
}

export default function HubTabs<Key extends string>({
  options,
  value,
  onChange,
}: {
  options: HubTabOption<Key>[];
  value: Key;
  onChange: (key: Key) => void;
}) {
  const palette = useColors();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
    >
      {options.map((option) => {
        const active = value === option.key;
        return (
          <TouchableOpacity
            key={option.key}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.key)}
            style={[styles.tab, active && { backgroundColor: palette.bg.card }]}
          >
            <Text style={[styles.label, { color: active ? palette.text.primary : palette.text.secondary }]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing[1],
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  tab: { flex: 1, minHeight: 40, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600' },
});
