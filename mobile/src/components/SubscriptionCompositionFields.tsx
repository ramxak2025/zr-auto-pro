import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useColors } from '../contexts/ThemeContext';
import { spacing, borderRadius, fontSize } from '../theme';
export default function SubscriptionCompositionFields({
  employees,
  points,
  onEmployees,
  onPoints,
  locked = false,
}: {
  employees: string;
  points: string;
  onEmployees: (raw: string) => void;
  onPoints: (raw: string) => void;
  locked?: boolean;
}) {
  const palette = useColors();
  return (
    <View style={styles.fields}>
      {[
        { label: 'Сотрудников для расчёта', value: employees, change: onEmployees },
        { label: 'Филиалов для расчёта', value: points, change: onPoints },
      ].map((field) => (
        <View key={field.label} style={styles.field}>
          <Text style={{ color: palette.text.secondary, fontSize: fontSize.sm }}>{field.label}</Text>
          <TextInput
            value={field.value}
            onChangeText={field.change}
            editable={!locked}
            keyboardType="number-pad"
            accessibilityLabel={field.label}
            style={[
              styles.input,
              { color: palette.text.primary, backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
            ]}
          />
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  fields: { flexDirection: 'row', gap: spacing[3], paddingVertical: spacing[2] },
  field: { flex: 1, gap: spacing[1] },
  input: { minHeight: 48, fontSize: 17, borderWidth: 1, borderRadius: borderRadius.md, paddingHorizontal: spacing[3] },
});
