import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ScheduleEntry } from '../../../shared/types';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { invalidateAttendanceQueries } from '../../../shared/utils/attendanceQueries';
import { scheduleApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { borderRadius, colors, fontSize, spacing } from '../theme';
import ScheduleTimeFields from './ScheduleTimeFields';
import { scheduleHoursPayload, validateScheduleHours } from './scheduleEditing';

export default function ScheduleDayHoursForm({
  userId,
  date,
  entry,
  onSaved,
  onCancel,
}: {
  userId: string;
  date: string;
  entry?: ScheduleEntry;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(() => ({
    shiftStart: entry?.shiftStart || '09:00',
    shiftEnd: entry?.shiftEnd || '18:00',
  }));
  const [validation, setValidation] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const payload = scheduleHoursPayload(hours);
      return entry?.id && !entry.id.startsWith('temp-') && !entry.id.startsWith('pending-')
        ? scheduleApi.update(entry.id, payload)
        : scheduleApi.create({ userId, date, ...payload });
    },
    onSuccess: () => {
      void invalidateAttendanceQueries(queryClient);
      onSaved();
    },
  });
  const error =
    validation ||
    (save.isError ? apiErrorMessage(save.error) || 'Не удалось сохранить время. Попробуйте ещё раз.' : null);
  return (
    <View>
      <Text style={[styles.hint, { color: palette.text.secondary }]}>
        План на {date.split('-').reverse().join('.')}. Отметка посещаемости сохраняется.
      </Text>
      <ScheduleTimeFields label={`План на ${date}`} value={hours} disabled={save.isPending} onChange={setHours} />
      {error && (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: palette.mode === 'dark' ? colors.red[300] : colors.red[600] }]}
        >
          {error}
        </Text>
      )}
      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={save.isPending}
          onPress={onCancel}
          style={[styles.button, { backgroundColor: palette.bg.muted }]}
        >
          <Text style={{ color: palette.text.primary, fontSize: fontSize.sm }}>Назад</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={save.isPending}
          style={[styles.button, { backgroundColor: palette.accent.primary }]}
          onPress={() => {
            const message = validateScheduleHours(hours);
            setValidation(message);
            if (!message) save.mutate();
          }}
        >
          {save.isPending ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveText}>Сохранить время</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing[4] },
  error: { fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing[3] },
  actions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[5] },
  button: { flex: 1, minHeight: 44, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: colors.white, fontSize: fontSize.sm, fontWeight: '600' },
});
