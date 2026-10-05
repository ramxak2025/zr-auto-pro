import React, { useState } from 'react';
import { Keyboard, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { useColors } from '../contexts/ThemeContext';
import { borderRadius, fontSize, spacing } from '../theme';
import type { ScheduleHours } from './scheduleEditing';

/** These are wall-clock plan hours, not arrival instants. */
export default function ScheduleTimeFields({
  value,
  onChange,
  label,
  compact = false,
  disabled = false,
}: {
  value: ScheduleHours;
  onChange: (value: ScheduleHours) => void;
  label: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const palette = useColors();
  const [picker, setPicker] = useState<keyof ScheduleHours | null>(null);
  const raw = picker ? value[picker] : value.shiftStart;
  const [hour, minute] = raw.split(':').map(Number);
  const pickerValue = new Date(2000, 0, 1, hour || 0, minute || 0);
  return (
    <View style={[styles.fields, compact && { flex: 1 }]}>
      {(['shiftStart', 'shiftEnd'] as const).map((key) => {
        const title = key === 'shiftStart' ? 'Начало' : 'Конец';
        return (
          <View key={key} style={{ flex: 1 }}>
            {!compact && <Text style={[styles.label, { color: palette.text.secondary }]}>{title}</Text>}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${title.toLowerCase()} ${value[key]}`}
              disabled={disabled}
              onPress={() => {
                Keyboard.dismiss();
                setPicker(key);
              }}
              style={[styles.field, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            >
              <Text style={{ color: palette.text.primary, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] }}>
                {value[key]}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
      <DateTimePickerModal
        visible={picker !== null}
        value={pickerValue}
        mode="time"
        onCancel={() => setPicker(null)}
        onConfirm={(date) => {
          if (picker)
            onChange({
              shiftStart: value.shiftStart,
              shiftEnd: value.shiftEnd,
              [picker]: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
            });
          setPicker(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { flexDirection: 'row', gap: spacing[2] },
  label: { fontSize: fontSize.sm, marginBottom: spacing[2] },
  field: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[1],
  },
});
