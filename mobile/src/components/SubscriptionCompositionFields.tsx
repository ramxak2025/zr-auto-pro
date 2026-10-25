import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '../contexts/ThemeContext';
import { spacing, borderRadius, fontSize } from '../theme';
export default function SubscriptionCompositionFields({
  employees,
  points,
  onEmployees,
  onPoints,
  locked = false,
  inputAccessoryViewID,
  employeePresets = false,
  minimumEmployees = 1,
}: {
  employees: string;
  points: string;
  onEmployees: (raw: string) => void;
  onPoints: (raw: string) => void;
  locked?: boolean;
  inputAccessoryViewID?: string;
  employeePresets?: boolean;
  minimumEmployees?: number;
}) {
  const palette = useColors();
  const fields = [
    { label: 'Сотрудников для расчёта', value: employees, change: onEmployees },
    { label: 'Филиалов для расчёта', value: points, change: onPoints },
  ];
  const input = (field: (typeof fields)[number], compact = false) => (
    <TextInput
      value={field.value}
      onChangeText={field.change}
      editable={!locked}
      keyboardType="number-pad"
      inputAccessoryViewID={inputAccessoryViewID}
      accessibilityLabel={field.label}
      style={[
        styles.input,
        compact && styles.compactInput,
        { color: palette.text.primary, backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
      ]}
    />
  );
  if (employeePresets)
    return (
      <View style={styles.team}>
        <View style={styles.compactRow}>
          <View style={styles.field}>
            <Text style={{ color: palette.text.primary, fontSize: 17, fontWeight: '600' }}>Сотрудники</Text>
            <Text style={{ color: palette.text.secondary, fontSize: fontSize.sm }}>Включая владельца</Text>
          </View>
          {input(fields[0], true)}
        </View>
        <View style={styles.presets}>
          {[1, 2, 3, 5, 10].map((count) => {
            const disabled = locked || count < minimumEmployees;
            const selected = employees === String(count);
            return (
              <TouchableOpacity
                key={count}
                disabled={disabled}
                onPress={() => onEmployees(String(count))}
                accessibilityRole="button"
                accessibilityLabel={`Сотрудников: ${count}`}
                accessibilityState={{ selected, disabled }}
                style={[
                  styles.preset,
                  {
                    backgroundColor: selected ? palette.accent.primarySoft : palette.bg.muted,
                    opacity: disabled ? 0.4 : 1,
                  },
                ]}
              >
                <Text
                  style={{
                    color: selected ? palette.accent.primaryText : palette.text.primary,
                    fontWeight: selected ? '600' : '400',
                  }}
                >
                  {count}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.compactRow}>
          <Text style={{ color: palette.text.secondary, fontSize: fontSize.sm, flex: 1 }}>Филиалы</Text>
          {input(fields[1], true)}
        </View>
      </View>
    );
  return (
    <View style={styles.fields}>
      {fields.map((field) => (
        <View key={field.label} style={styles.field}>
          <Text style={{ color: palette.text.secondary, fontSize: fontSize.sm }}>{field.label}</Text>
          {input(field)}
        </View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  fields: { flexDirection: 'row', gap: spacing[3], paddingVertical: spacing[2] },
  field: { flex: 1, gap: spacing[1] },
  input: { minHeight: 48, fontSize: 17, borderWidth: 1, borderRadius: borderRadius.md, paddingHorizontal: spacing[3] },
  team: { gap: spacing[2] },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  compactInput: { width: 88, textAlign: 'right', fontWeight: '600' },
  presets: { flexDirection: 'row', gap: spacing[1.5] },
  preset: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: borderRadius.md },
});
